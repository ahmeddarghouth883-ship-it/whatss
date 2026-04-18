const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode    = require('qrcode');
const path      = require('path');
const fs        = require('fs');
const WASession = require('../models/WASession');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// In-memory map of active WA clients: sessionId -> Client instance
const clients = new Map();

/**
 * Convert user-provided phone to WhatsApp jid digits.
 * Accepts formats like +336..., 00336..., 336..., spaces/dashes.
 */
function toWaJid(phone) {
  if (!phone) throw new Error('Phone number is required');
  let normalized = String(phone).trim();
  if (normalized.startsWith('00')) normalized = `+${normalized.slice(2)}`;
  const digits = normalized.replace(/\D/g, '');
  if (digits.length < 7) throw new Error(`Invalid phone number: ${phone}`);
  return `${digits}@c.us`;
}

/**
 * Create or restore a WhatsApp client for a given sessionId.
 * Emits Socket.IO events: wa:qr, wa:ready, wa:disconnected
 */
async function createClient(sessionId, userId, io) {
  if (clients.has(sessionId)) return clients.get(sessionId);

  const client = new Client({
    authStrategy: new LocalAuth({ 
      clientId: sessionId, 
      dataPath: process.env.NODE_ENV === 'production' ? '/app/data/.wwebjs_auth' : './.wwebjs_auth' 
    }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    }
  });

  const emit = (event, data) => {
    if (io) io.to(userId).emit(event, { sessionId, ...data });
  };

  client.on('qr', async (qr) => {
    const qrDataUrl = await qrcode.toDataURL(qr);
    emit('wa:qr', { qr: qrDataUrl });
    await WASession.findOneAndUpdate(
      { sessionId },
      { status: 'qr', qrCode: qrDataUrl },
      { upsert: true }
    );
  });

  client.on('ready', async () => {
    const info = client.info;
    emit('wa:ready', { phone: info?.wid?.user, name: info?.pushname });
    await WASession.findOneAndUpdate(
      { sessionId },
      {
        status: 'ready',
        phone: info?.wid?.user,
        name: info?.pushname,
        qrCode: null,
        lastSeen: new Date()
      },
      { upsert: true }
    );
    console.log(`✅ WA session ready: ${sessionId}`);
  });

  client.on('disconnected', async (reason) => {
    emit('wa:disconnected', { reason });
    await WASession.findOneAndUpdate({ sessionId }, { status: 'disconnected' });
    clients.delete(sessionId);
    console.log(`❌ WA session disconnected: ${sessionId} — ${reason}`);
  });

  client.on('message', async (msg) => {
    // Track incoming replies
    const Message = require('../models/Message');
    const Lead    = require('../models/Lead');

    const phone = msg.from.replace('@c.us', '');
    emit('wa:reply', { phone, body: msg.body, timestamp: msg.timestamp });

    // Mark message as replied
    await Message.findOneAndUpdate(
      { userId, phone, status: { $in: ['sent', 'delivered', 'read'] } },
      { status: 'replied', repliedAt: new Date() },
      { sort: { sentAt: -1 } }
    );

    // Update lead lastContacted
    await Lead.findOneAndUpdate({ userId, phone }, { lastContacted: new Date() });
  });

  client.on('message_ack', async (msg, ack) => {
    // ack: 1=sent, 2=delivered, 3=read
    const Message = require('../models/Message');
    const statusMap = { 1: 'sent', 2: 'delivered', 3: 'read' };
    const newStatus = statusMap[ack];
    if (!newStatus) return;

    const updateFields = { status: newStatus };
    if (ack === 2) updateFields.deliveredAt = new Date();
    if (ack === 3) updateFields.readAt       = new Date();

    await Message.findOneAndUpdate({ waMessageId: msg.id._serialized }, updateFields);
  });

  clients.set(sessionId, client);
  await client.initialize();
  return client;
}

/**
 * Send a text (or media) message via a specific session.
 *
 * mediaSource can be:
 *   - a full URL   (https://...)  → fetched via fromUrl()
 *   - a /uploads/  path           → read from disk via fromFilePath() (faster, no HTTP)
 *   - null / undefined            → text-only message
 */
async function sendMessage(sessionId, phone, text, mediaSource = null) {
  const client = clients.get(sessionId);
  if (!client) throw new Error(`Session ${sessionId} not connected`);

  const chatId = phone.includes('@c.us') ? phone : toWaJid(phone);

  try {
    const chat = await client.getChatById(chatId);
    await client.sendPresenceAvailable();
    await chat.sendStateTyping();
    // Simulate natural human typing speed (min 1.5s, max 4s based on message length)
    const typingTime = Math.min(4000, Math.max(1500, text ? text.length * 45 : 1500));
    await new Promise(r => setTimeout(r, typingTime));
    await chat.clearState();
  } catch (e) {
    // Ignore setting presence errors if chat hasn't loaded fully
  }

  if (mediaSource) {
    let media;

    if (mediaSource.startsWith('/uploads/')) {
      // Local upload — resolve to absolute path and read from disk
      const filename = path.basename(mediaSource);
      const filePath = path.join(UPLOAD_DIR, filename);
      if (!fs.existsSync(filePath)) throw new Error(`Uploaded file not found: ${filename}`);
      media = MessageMedia.fromFilePath(filePath);
    } else {
      // External URL
      media = await MessageMedia.fromUrl(mediaSource, { unsafeMime: true });
    }

    const msg = await client.sendMessage(chatId, media, { caption: text });
    return msg.id._serialized;
  }

  const msg = await client.sendMessage(chatId, text);
  return msg.id._serialized;
}

/**
 * Check if a phone number is registered on WhatsApp.
 */
async function checkWhatsApp(sessionId, phone) {
  const client = clients.get(sessionId);
  if (!client) throw new Error(`Session ${sessionId} not connected`);
  const chatId = toWaJid(phone);
  const result = await client.isRegisteredUser(chatId);
  return result;
}

/**
 * Disconnect and destroy a session.
 */
async function destroySession(sessionId) {
  const client = clients.get(sessionId);
  if (client) {
    await client.destroy();
    clients.delete(sessionId);
  }
  await WASession.findOneAndUpdate({ sessionId }, { status: 'disconnected' });
}

function getClient(sessionId) {
  return clients.get(sessionId);
}

function getAllClients() {
  return clients;
}

module.exports = {
  createClient,
  sendMessage,
  checkWhatsApp,
  destroySession,
  getClient,
  getAllClients
};
