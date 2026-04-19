/**
 * /api/inbox — conversation threads built from InboundMessage + outbound Message.
 *
 *   GET    /threads                    list threads (one per phone) with last message + unread count
 *   GET    /threads/:phone             full timeline for a contact (in + out, sorted)
 *   POST   /threads/:phone/read        mark all unread inbound for that phone as read
 *   POST   /threads/:phone/reply       send a WhatsApp reply (wallet-charged 0.5 cr)
 *   GET    /unread-count               badge counter
 */

const express = require('express');
const mongoose = require('mongoose');
const { authenticate }   = require('../helpers/auth');
const { messageLimiter } = require('../helpers/rateLimit');
const InboundMessage     = require('../models/InboundMessage');
const Message            = require('../models/Message');
const Lead               = require('../models/Lead');
const wallet             = require('../helpers/wallet');
const { sendMessage, getClient, getAllClients } = require('../helpers/whatsappManager');
const {
  canonicalPeerDigits,
  expandPeerQueryVariants,
  formatPeerDigitsLine,
} = require('../helpers/waIdentity');

const router = express.Router();
router.use(authenticate);

const COST = wallet.CREDIT_COSTS.message;

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function userObjectId(req) {
  return new mongoose.Types.ObjectId(String(req.userId));
}

function pickFirstReadySession() {
  const clients = getAllClients();
  for (const [sid] of clients) return sid;
  return null;
}

// ── GET /unread-count ──────────────────────────────────────────────────────
router.get('/unread-count', async (req, res) => {
  try {
    const count = await InboundMessage.countDocuments({ userId: req.userId, read: false });
    return res.json({ count });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /threads ───────────────────────────────────────────────────────────
router.get('/threads', async (req, res) => {
  try {
    const search   = String(req.query.search || '').trim();
    const onlyUnread = String(req.query.unread || '') === '1';
    const limit    = Math.max(1, Math.min(200, Number(req.query.limit) || 100));

    const matchInbound = { userId: userObjectId(req) };
    if (onlyUnread) matchInbound.read = false;
    if (search) {
      const rx = new RegExp(escapeRegex(search), 'i');
      matchInbound.$or = [{ fromPhone: rx }, { contactName: rx }, { body: rx }];
    }

    // Aggregate inbound per-phone
    const inboundAgg = await InboundMessage.aggregate([
      { $match: matchInbound },
      { $sort: { receivedAt: -1 } },
      {
        $group: {
          _id:        '$fromPhone',
          contactName:{ $first: '$contactName' },
          lastBody:   { $first: '$body' },
          lastAt:     { $first: '$receivedAt' },
          lastMediaType: { $first: '$mediaType' },
          unreadCount:{ $sum: { $cond: [{ $eq: ['$read', false] }, 1, 0] } },
          totalIn:    { $sum: 1 },
        },
      },
      { $limit: limit },
    ]);

    // Pull most recent outbound per phone for context (last sent line + lead link)
    const phones = inboundAgg.map((t) => t._id);
    const outboundByPhone = new Map();
    if (phones.length > 0) {
      const outboundAgg = await Message.aggregate([
        { $match: { userId: userObjectId(req), phone: { $in: phones } } },
        { $sort: { createdAt: -1 } },
        {
          $group: {
            _id: '$phone',
            lastBody:   { $first: '$message' },
            lastAt:     { $first: '$createdAt' },
            lastStatus: { $first: '$status' },
          },
        },
      ]);
      for (const r of outboundAgg) {
        outboundByPhone.set(r._id, r);
        outboundByPhone.set(canonicalPeerDigits(r._id), r);
      }
    }

    // Lead lookup for names
    const leadByPhone = new Map();
    if (phones.length > 0) {
      const canonicalForLead = [...new Set(phones.map((p) => canonicalPeerDigits(p)).filter(Boolean))];
    const leads = await Lead.find({
        userId: req.userId,
        phone: { $in: [...canonicalForLead, ...phones] },
      }).select('phone name _id').lean();
      for (const l of leads) {
        leadByPhone.set(l.phone, l);
        leadByPhone.set(canonicalPeerDigits(l.phone), l);
      }
    }

    const threads = inboundAgg.map((t) => {
      const peerKey = canonicalPeerDigits(t._id);
      const out = outboundByPhone.get(t._id) || outboundByPhone.get(peerKey);
      const lead = leadByPhone.get(t._id) || leadByPhone.get(peerKey);
      const lastFromOut = out && (!t.lastAt || (out.lastAt && out.lastAt > t.lastAt));
      return {
        phone:        peerKey || t._id,
        contactName:  lead?.name || t.contactName || '',
        displayPhone: formatPeerDigitsLine(peerKey),
        leadId:       lead?._id || null,
        leadName:     lead?.name || null,
        lastMessage:  lastFromOut
          ? (out.lastBody || (t.lastMediaType ? `[${t.lastMediaType}]` : ''))
          : (t.lastBody  || (t.lastMediaType ? `[${t.lastMediaType}]` : '')),
        lastAt:       lastFromOut ? out.lastAt : t.lastAt,
        lastDirection:lastFromOut ? 'out' : 'in',
        lastStatus:   lastFromOut ? out.lastStatus : 'received',
        unreadCount:  t.unreadCount || 0,
        totalIn:      t.totalIn || 0,
      };
    }).sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt));

    const totalUnread = await InboundMessage.countDocuments({ userId: req.userId, read: false });
    return res.json({ threads, totalUnread });
  } catch (err) {
    console.error('[inbox/threads]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /threads/:phone — full timeline ────────────────────────────────────
router.get('/threads/:phone', async (req, res) => {
  try {
    const phone = String(req.params.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone is required' });
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 200));

    const peerVariants = expandPeerQueryVariants(phone);
    const digitKey = canonicalPeerDigits(phone);

    const [inbound, outbound, lead] = await Promise.all([
      InboundMessage.find({ userId: req.userId, fromPhone: { $in: peerVariants } })
        .sort({ receivedAt: -1 }).limit(limit).lean(),
      Message.find({
        userId: req.userId,
        phone: { $in: [...new Set([digitKey, phone].filter(Boolean))] },
      })
        .sort({ createdAt: -1 }).limit(limit).lean(),
      Lead.findOne({
        userId: req.userId,
        phone: { $in: [...new Set([digitKey, phone].filter(Boolean))] },
      }).select('name _id email category').lean(),
    ]);

    const items = [
      ...inbound.map((m) => ({
        _id:        m._id,
        direction:  'in',
        body:       m.body,
        mediaUrl:   m.mediaUrl,
        mediaType:  m.mediaType,
        at:         m.receivedAt,
        read:       m.read,
        contactName:m.contactName,
      })),
      ...outbound.map((m) => ({
        _id:        m._id,
        direction:  'out',
        body:       m.message,
        mediaUrl:   m.mediaUrl,
        status:     m.status,
        at:         m.sentAt || m.createdAt,
        sessionId:  m.sessionId,
      })),
    ].sort((a, b) => new Date(a.at) - new Date(b.at));

    const contactName =
      lead?.name ||
      inbound.find((m) => m.contactName)?.contactName || '';

    return res.json({
      phone: digitKey || phone,
      contactName,
      displayPhone: formatPeerDigitsLine(digitKey || phone),
      lead,
      items,
    });
  } catch (err) {
    console.error('[inbox/thread]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /threads/:phone/read ──────────────────────────────────────────────
router.post('/threads/:phone/read', async (req, res) => {
  try {
    const phone = String(req.params.phone || '').trim();
    if (!phone) return res.status(400).json({ error: 'phone is required' });

    const peerVariants = expandPeerQueryVariants(phone);
    const r = await InboundMessage.updateMany(
      { userId: req.userId, fromPhone: { $in: peerVariants }, read: false },
      { $set: { read: true, readAt: new Date() } },
    );
    return res.json({ ok: true, updated: r.modifiedCount });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /threads/:phone/reply ─────────────────────────────────────────────
router.post('/threads/:phone/reply', messageLimiter, async (req, res) => {
  try {
    const phoneParam = String(req.params.phone || '').trim();
    const digitPhone   = canonicalPeerDigits(phoneParam) || phoneParam;
    const message   = String(req.body?.message || '').trim();
    const mediaUrl  = req.body?.mediaUrl ? String(req.body.mediaUrl) : null;
    let   sessionId = String(req.body?.sessionId || '').trim();

    if (!phoneParam) return res.status(400).json({ error: 'phone is required' });
    if (!message && !mediaUrl) return res.status(400).json({ error: 'message or mediaUrl is required' });

    if (!sessionId) sessionId = pickFirstReadySession();
    if (!sessionId || !getClient(sessionId)) {
      return res.status(409).json({ error: 'No connected WhatsApp session. Open Sessions and scan a QR.' });
    }

    // Preflight credit check
    try { await wallet.ensureCredits(req.userId, COST); }
    catch (err) {
      if (err?.code === 'INSUFFICIENT_CREDITS') {
        return res.status(402).json({
          error: 'INSUFFICIENT_CREDITS', needed: COST, have: err.have,
          message: 'Top up your wallet to send messages (0.5 credits per message).',
        });
      }
      throw err;
    }

    let waMessageId;
    try {
      waMessageId = await sendMessage(sessionId, digitPhone, message, mediaUrl);
    } catch (err) {
      await Message.create({
        userId: req.userId, sessionId, phone: digitPhone, message, mediaUrl,
        status: 'failed',
        failReason: String(err?.message || 'send failed').slice(0, 400),
      }).catch(() => {});
      return res.status(502).json({ error: 'Send failed', detail: String(err?.message || err) });
    }

    const msgDoc = await Message.create({
      userId: req.userId, sessionId, phone: digitPhone, message, mediaUrl,
      status: 'sent', waMessageId, sentAt: new Date(),
    });

    const reference = `msg:${waMessageId || msgDoc._id}`;
    await wallet.charge({
      userId:      req.userId,
      cost:        COST,
      source:      'message',
      reference,
      metadata:    { messageId: msgDoc._id, waMessageId, phone: digitPhone, sessionId, source: 'inbox' },
      description: `Inbox reply to ${digitPhone}`,
    }).catch((e) => console.warn('[inbox/reply] charge:', e.message));

    // Auto-mark inbound as read when the user replies
    await InboundMessage.updateMany(
      { userId: req.userId, fromPhone: { $in: expandPeerQueryVariants(phoneParam) }, read: false },
      { $set: { read: true, readAt: new Date() } },
    ).catch(() => {});

    return res.json({ ok: true, messageId: msgDoc._id, waMessageId });
  } catch (err) {
    console.error('[inbox/reply]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
