/**
 * /api/messages — single-message send + history.
 *
 *   POST /api/messages/send             { sessionId, phone, message, mediaUrl? }
 *   GET  /api/messages?limit=50         list user messages
 *   GET  /api/messages/analytics        sent/delivered/read/replied/failed counts
 *
 * Billing: 0.5 credits per successful send. Charge happens AFTER WhatsApp
 * returns a messageId, so failed sends never cost credits. Idempotent on
 * `msg:<waMessageId>` so retries / acks never double-charge.
 */

const express  = require('express');
const mongoose = require('mongoose');
const { authenticate }   = require('../helpers/auth');
const { messageLimiter } = require('../helpers/rateLimit');
const Message            = require('../models/Message');
const Campaign           = require('../models/Campaign');
const ScheduledMessage   = require('../models/ScheduledMessage');
const DirectSendJob      = require('../models/DirectSendJob');
const { checkDirectJobs } = require('../helpers/directSendWorker');
const wallet             = require('../helpers/wallet');
const { sendMessage }    = require('../helpers/whatsappManager');
const { touchLeadLastContactedByPhone } = require('../helpers/leadContact');
const { canonicalPeerDigits, formatPeerDigitsLine } = require('../helpers/waIdentity');

const router = express.Router();

const COST = wallet.CREDIT_COSTS.message;

function userRoom(userId) {
  return `user:${String(userId)}`;
}

// Helper: send text + multiple media files to a single phone
async function sendMediaBatch(sessionId, phone, text, mediaUrls) {
  if (!mediaUrls || mediaUrls.length === 0) {
    await sendMessage(sessionId, phone, text, null);
    return;
  }
  await sendMessage(sessionId, phone, text || '', mediaUrls[0]);
  for (let i = 1; i < mediaUrls.length; i++) {
    await sendMessage(sessionId, phone, '', mediaUrls[i]);
  }
}

// ── GET /replies (legacy inbox) — now backed by InboundMessage so the body is real ──
router.get('/replies', authenticate, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 100));
    const InboundMessage = require('../models/InboundMessage');
    const [items, total] = await Promise.all([
      InboundMessage.find({ userId: req.userId })
        .sort({ receivedAt: -1 })
        .limit(limit)
        .lean(),
      InboundMessage.countDocuments({ userId: req.userId }),
    ]);
    // Shape to match the previous response the old UI expected
    const messages = items.map((m) => ({
      _id:        m._id,
      phone:
        formatPeerDigitsLine(canonicalPeerDigits(m.fromPhone)) ||
        canonicalPeerDigits(m.fromPhone) ||
        m.fromPhone,
      message:    m.body || (m.mediaType ? `[${m.mediaType}]` : ''),
      status:     'replied',
      repliedAt:  m.receivedAt,
      leadId:     null,
      campaignId: null,
      contactName: m.contactName || '',
    }));
    return res.json({ messages, total });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /campaign/:campaignId/stats (detail charts) ──────────────────────────
router.get('/campaign/:campaignId/stats', authenticate, async (req, res) => {
  try {
    const campaignId = req.params.campaignId;
    if (!mongoose.isValidObjectId(campaignId)) return res.status(400).json({ error: 'Invalid id' });

    const camp = await Campaign.findOne({ _id: campaignId, userId: req.userId }).lean();
    if (!camp) return res.status(404).json({ error: 'Not found' });

    const uid = new mongoose.Types.ObjectId(String(req.userId));
    const cid = new mongoose.Types.ObjectId(campaignId);

    const agg = await Message.aggregate([
      { $match: { userId: uid, campaignId: cid } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const by = Object.fromEntries(agg.map((r) => [r._id, r.count]));
    const sent = (by.sent || 0) + (by.delivered || 0) + (by.read || 0) + (by.replied || 0);
    const delivered = (by.delivered || 0) + (by.read || 0) + (by.replied || 0);
    const read = (by.read || 0) + (by.replied || 0);
    const replied = by.replied || 0;
    const failed = by.failed || 0;

    const stats = { sent, delivered, read, replied, failed };
    const deliveryRate = sent ? Math.round((delivered / sent) * 100) : 0;
    const readRate = sent ? Math.round((read / sent) * 100) : 0;
    const replyRate = sent ? Math.round((replied / sent) * 100) : 0;

    return res.json({
      stats,
      deliveryRate,
      readRate,
      replyRate,
      avgReadMinutes: null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /direct (compose page background send) ─────────────────────────────
router.post('/direct', authenticate, messageLimiter, async (req, res) => {
  try {
    const sessionId  = String(req.body?.sessionId || '').trim();
    const phones     = Array.isArray(req.body?.phones)
      ? [...new Set(req.body.phones.map((p) => String(p || '').trim()).filter(Boolean))]
      : [];
    const message    = String(req.body?.message || '').trim();
    // Accept both mediaUrl (single, legacy) and mediaUrls (array)
    const mediaUrls  = (() => {
      if (Array.isArray(req.body?.mediaUrls)) return req.body.mediaUrls.filter(Boolean);
      if (req.body?.mediaUrl) return [req.body.mediaUrl];
      return [];
    })();
    const scheduledAt = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;
    const useThrottle =
      req.body?.throttle !== false &&
      String(process.env.DIRECT_SEND_THROTTLE || '1') !== '0';

    if (!sessionId)          return res.status(400).json({ error: 'sessionId is required' });
    if (phones.length === 0) return res.status(400).json({ error: 'phones[] is required' });
    if (!message && mediaUrls.length === 0) return res.status(400).json({ error: 'message or at least one attachment is required' });
    if (scheduledAt && isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'scheduledAt is not a valid date' });
    if (scheduledAt && scheduledAt <= new Date()) return res.status(400).json({ error: 'scheduledAt must be in the future' });

    // If scheduled, store for later
    if (scheduledAt) {
      const sched = await ScheduledMessage.create({
        userId:      req.userId,
        sessionId,
        phones,
        message,
        mediaUrls,
        scheduledAt,
      });
      return res.json({ ok: true, scheduled: true, scheduledAt, jobId: sched._id, total: phones.length });
    }

    // Preflight credit check (at least 1 send)
    try {
      await wallet.ensureCredits(req.userId, COST);
    } catch (err) {
      if (err?.code === 'INSUFFICIENT_CREDITS') {
        return res.status(402).json({
          error: 'INSUFFICIENT_CREDITS', needed: COST, have: err.have,
          message: 'Top up your wallet to send messages (0.5 credits per message).',
        });
      }
      throw err;
    }

    // Background queue with 10 / 20min throttling (survives navigation; see directSendWorker)
    if (useThrottle) {
      const job = await DirectSendJob.create({
        userId: req.userId,
        sessionId,
        phones,
        message,
        mediaUrls,
        status: 'pending',
      });
      setImmediate(() => checkDirectJobs().catch(() => {}));
      return res.json({
        ok: true,
        queued: true,
        jobId: job._id,
        total: phones.length,
        throttled: true,
      });
    }

    const io   = req.app.get('io');
    const room = userRoom(req.userId);

    setImmediate(async () => {
      let sent = 0;
      let failed = 0;

      for (const phone of phones) {
        try {
          await wallet.ensureCredits(req.userId, COST);
        } catch (_) {
          failed += phones.length - sent - failed;
          io?.to(room).emit('direct:progress', { sent, failed, total: phones.length });
          io?.to(room).emit('direct:done', { sent, failed, total: phones.length, stopped: 'INSUFFICIENT_CREDITS' });
          return;
        }

        try {
          await sendMediaBatch(sessionId, phone, message, mediaUrls);

          const msgDoc = await Message.create({
            userId: req.userId, sessionId, phone, message,
            mediaUrl: mediaUrls[0] || null, status: 'sent', sentAt: new Date(),
          });

          await wallet.charge({
            userId: req.userId, cost: COST, source: 'message',
            reference: `msg:direct:${phone}:${Date.now()}`,
            metadata:  { messageId: msgDoc._id, phone, sessionId, mediaCount: mediaUrls.length },
            description: `Message sent to ${phone}`,
          }).catch(() => {});

          await touchLeadLastContactedByPhone(req.userId, phone);

          sent++;
        } catch (err) {
          failed++;
          await Message.create({
            userId: req.userId, sessionId, phone, message,
            mediaUrl: mediaUrls[0] || null, status: 'failed',
            failReason: String(err?.message || 'send failed').slice(0, 400),
          }).catch(() => {});
        }

        io?.to(room).emit('direct:progress', { sent, failed, total: phones.length });
      }

      io?.to(room).emit('direct:done', { sent, failed, total: phones.length });
    });

    return res.json({ ok: true, queued: true, total: phones.length });
  } catch (err) {
    console.error('[messages/direct]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /scheduled — list user's scheduled sends ────────────────────────────
router.get('/scheduled', authenticate, async (req, res) => {
  try {
    const jobs = await ScheduledMessage.find({ userId: req.userId })
      .sort({ scheduledAt: -1 }).limit(50).lean();
    return res.json({ jobs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── DELETE /scheduled/:id — cancel a pending scheduled send ─────────────────
router.delete('/scheduled/:id', authenticate, async (req, res) => {
  try {
    const job = await ScheduledMessage.findOne({ _id: req.params.id, userId: req.userId });
    if (!job) return res.status(404).json({ error: 'Scheduled message not found' });
    if (job.status !== 'pending') return res.status(400).json({ error: `Cannot cancel a job with status "${job.status}"` });
    await ScheduledMessage.updateOne({ _id: job._id }, { status: 'cancelled' });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── POST /send ──────────────────────────────────────────────────────────────
router.post('/send', authenticate, messageLimiter, async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '').trim();
    const phone     = String(req.body?.phone || '').trim();
    const message   = String(req.body?.message || '').trim();
    const mediaUrl  = req.body?.mediaUrl ? String(req.body.mediaUrl) : null;

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    if (!phone)     return res.status(400).json({ error: 'phone is required' });
    if (!message && !mediaUrl) return res.status(400).json({ error: 'message or mediaUrl is required' });

    // Preflight credit check.
    try {
      await wallet.ensureCredits(req.userId, COST);
    } catch (err) {
      if (err?.code === 'INSUFFICIENT_CREDITS') {
        return res.status(402).json({
          error:  'INSUFFICIENT_CREDITS',
          needed: COST,
          have:   err.have,
          message: 'Top up your wallet to send messages (0.5 credits per message).',
        });
      }
      throw err;
    }

    // Send first — only charge on actual success.
    let waMessageId;
    try {
      waMessageId = await sendMessage(sessionId, phone, message, mediaUrl);
    } catch (err) {
      // Persist as failed for visibility; no credit charge.
      await Message.create({
        userId:     req.userId,
        sessionId,
        phone,
        message,
        mediaUrl,
        status:     'failed',
        failReason: String(err?.message || 'send failed').slice(0, 400),
      });
      return res.status(502).json({ error: 'Send failed', detail: String(err?.message || err) });
    }

    // Persist message row.
    const msgDoc = await Message.create({
      userId:     req.userId,
      sessionId,
      phone,
      message,
      mediaUrl,
      status:     'sent',
      waMessageId,
      sentAt:     new Date(),
    });

    // Charge AFTER successful send — idempotent on the WA message id (or local id fallback).
    const reference = `msg:${waMessageId || msgDoc._id}`;
    let billing = null;
    try {
      const result = await wallet.charge({
        userId:      req.userId,
        cost:        COST,
        source:      'message',
        reference,
        metadata:    { messageId: msgDoc._id, waMessageId, phone, sessionId },
        description: `Message sent to ${phone}`,
      });
      billing = { balance: result.balance, charged: COST, idempotent: !!result.idempotent };
    } catch (err) {
      // Send succeeded but billing failed — leave message saved, surface warning.
      console.warn('[messages] post-send charge failed:', err?.message);
      billing = { error: err?.message || 'charge failed' };
    }

    await touchLeadLastContactedByPhone(req.userId, phone);

    return res.json({ ok: true, messageId: msgDoc._id, waMessageId, billing });
  } catch (err) {
    console.error('[messages/send]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET / — paginated history ──────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const items = await Message.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /analytics — campaign-style stat breakdown ────────────────────────
router.get('/analytics', authenticate, async (req, res) => {
  try {
    const agg = await Message.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(String(req.userId)) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    const byStatus = Object.fromEntries(agg.map((r) => [r._id, r.count]));
    const sent      = (byStatus.sent || 0) + (byStatus.delivered || 0) + (byStatus.read || 0) + (byStatus.replied || 0);
    const delivered = (byStatus.delivered || 0) + (byStatus.read || 0) + (byStatus.replied || 0);
    const read      = (byStatus.read || 0) + (byStatus.replied || 0);
    const replied   = byStatus.replied || 0;
    const failed    = byStatus.failed || 0;
    const replyRate = sent ? Math.round((replied / sent) * 100) : 0;

    return res.json({ sent, delivered, read, replied, failed, replyRate });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
