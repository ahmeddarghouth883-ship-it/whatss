const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode    = require('qrcode');
const path      = require('path');
const fs        = require('fs');
const WASession = require('../models/WASession');
const { resolveInboundSender, canonicalPeerDigits } = require('./waIdentity');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads');

// In-memory map of active WA clients: sessionId -> Client instance
const clients = new Map();

function ensureAuthDir(dataPath) {
  try {
    if (dataPath && !fs.existsSync(dataPath)) {
      fs.mkdirSync(dataPath, { recursive: true });
    }
  } catch (e) {
    console.warn('[whatsapp] could not create auth dir:', dataPath, e.message);
  }
}

/**
 * Puppeteer launch options for whatsapp-web.js.
 * On Linux servers/Docker, bundled Chrome often fails with missing .so libs — install
 * Chromium + deps (see Dockerfile) and set PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium.
 */
function buildPuppeteerOptions() {
  const execPath = String(
    process.env.PUPPETEER_EXECUTABLE_PATH ||
      process.env.CHROMIUM_PATH ||
      process.env.CHROME_PATH ||
      ''
  ).trim();

  const args = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
  ];

  const extra = String(process.env.PUPPETEER_EXTRA_ARGS || '').trim();
  if (extra) {
    for (const a of extra.split(/\s+/)) {
      if (a) args.push(a);
    }
  }

  const opts = { headless: true, args };

  if (execPath) {
    if (!fs.existsSync(execPath)) {
      console.warn(`[whatsapp] PUPPETEER_EXECUTABLE_PATH not found on disk: ${execPath}`);
    }
    opts.executablePath = execPath;
  }

  return opts;
}

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

  const authRel =
    process.env.WWEBJS_AUTH_PATH ||
    (process.env.NODE_ENV === 'production' ? '/app/data/.wwebjs_auth' : './.wwebjs_auth');
  const authAbs = path.isAbsolute(authRel) ? authRel : path.join(__dirname, '..', authRel);
  ensureAuthDir(authAbs);

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: sessionId,
      dataPath: authAbs,
    }),
    puppeteer: buildPuppeteerOptions()
  });

  const emit = (event, data) => {
    if (!io) return;
    const payload = { sessionId, ...data };
    const uid = String(userId);
    io.to(uid).emit(event, payload);
    io.to(`user:${uid}`).emit(event, payload);
  };

  client.on('auth_failure', async (msg) => {
    const message = String(msg || 'WhatsApp authentication failed');
    emit('wa:error', { message });
    await WASession.findOneAndUpdate({ sessionId }, { status: 'disconnected', qrCode: null });
    try {
      await clients.get(sessionId)?.destroy?.();
    } catch (_) {}
    clients.delete(sessionId);
  });

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
    const Message        = require('../models/Message');
    const InboundMessage = require('../models/InboundMessage');
    const Lead           = require('../models/Lead');

    // Ignore status broadcasts and group messages — those aren't 1:1 replies
    if (!msg || !msg.from || msg.from === 'status@broadcast') return;
    if (String(msg.from).endsWith('@g.us')) return;

    const body = msg.body || '';

    let phone = '';
    let contactName = '';
    try {
      const resolved = await resolveInboundSender(msg);
      phone = resolved.threadPhone;
      contactName = resolved.contactName || '';
    } catch (e) {
      console.warn('[wa/message] resolveInboundSender:', e.message);
      phone = canonicalPeerDigits(msg.from) || 'unknown';
    }

    let mediaUrl = null;
    let mediaType = null;
    if (msg.hasMedia) {
      // Only record the type — don't download bytes here to keep the handler fast
      mediaType = String(msg.type || 'document').toLowerCase();
    }

    // Persist the inbound message so the Inbox UI can render conversation threads.
    // Unique (userId, waMessageId) index makes redeliveries safe.
    try {
      await InboundMessage.create({
        userId,
        sessionId,
        fromPhone:   phone,
        contactName,
        body,
        mediaUrl,
        mediaType,
        waMessageId: msg.id?._serialized || msg.id?.id || null,
        receivedAt:  new Date((msg.timestamp || Date.now() / 1000) * 1000),
      });
    } catch (e) {
      if (e?.code !== 11000) console.warn('[wa/message] InboundMessage.create:', e.message);
    }

    emit('wa:reply', { phone, body, contactName, mediaType, timestamp: msg.timestamp });

    // Mark the most recent outbound message as replied
    await Message.findOneAndUpdate(
      { userId, phone, status: { $in: ['sent', 'delivered', 'read'] } },
      { status: 'replied', repliedAt: new Date() },
      { sort: { sentAt: -1 } }
    ).catch(() => {});

    // Update lead lastContacted
    await Lead.findOneAndUpdate({ userId, phone }, { lastContacted: new Date() }).catch(() => {});
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
  try {
    await client.initialize();
  } catch (err) {
    const message = err?.message || String(err);
    console.error('[whatsapp] initialize failed:', sessionId, message);
    emit('wa:error', { message: `WhatsApp could not start (${message}). On a server, ensure Chromium/Puppeteer deps and a writable auth folder.` });
    clients.delete(sessionId);
    try {
      await client.destroy?.();
    } catch (_) {}
    await WASession.findOneAndUpdate(
      { sessionId },
      { status: 'disconnected', qrCode: null }
    ).catch(() => {});
  }
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
