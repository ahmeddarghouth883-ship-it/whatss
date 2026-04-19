/**
 * /api/whatsapp — WA session listing + on-demand number validation.
 *
 * Uses the existing helpers/whatsappManager.js (whatsapp-web.js client pool).
 *   GET  /api/whatsapp/sessions             list this user's sessions
 *   POST /api/whatsapp/sessions             body { sessionId? } → start a new session, emits wa:qr
 *   POST /api/whatsapp/verify-numbers       body { sessionId, leadIds: [] } → mark whatsappVerified
 *
 * QR scan / message-sending logic in whatsappManager itself is untouched.
 */

const crypto    = require('crypto');
const express   = require('express');
const mongoose  = require('mongoose');
const Lead      = require('../models/Lead');
const WASession = require('../models/WASession');
const { authenticate } = require('../helpers/auth');
const wa = require('../helpers/whatsappManager');

const router = express.Router();
router.use(authenticate);

router.get('/sessions', async (req, res) => {
  const sessions = await WASession.find({ userId: req.userId }).sort({ createdAt: -1 }).lean();
  res.json({ sessions });
});

router.post('/sessions', async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || `wa_${crypto.randomBytes(4).toString('hex')}`);
    const io = req.app.get('io');

    let session = await WASession.findOne({ sessionId });
    if (!session) {
      session = await WASession.create({
        userId: req.userId, sessionId, status: 'connecting', isActive: true,
      });
    }
    if (String(session.userId) !== String(req.userId)) {
      return res.status(403).json({ error: 'Session belongs to another user' });
    }

    // Fire-and-forget: createClient emits wa:qr / wa:ready socket events.
    setImmediate(() => {
      wa.createClient(sessionId, String(req.userId), io)
        .catch((e) => console.error('[whatsapp/sessions] createClient:', e.message));
    });

    res.status(202).json({ session });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify-numbers', async (req, res) => {
  try {
    const sessionId = String(req.body?.sessionId || '');
    const leadIds = Array.isArray(req.body?.leadIds) ? req.body.leadIds.filter(mongoose.isValidObjectId) : [];
    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    if (leadIds.length === 0) return res.status(400).json({ error: 'leadIds[] is required' });

    if (!wa.getClient(sessionId)) {
      return res.status(409).json({ error: 'Session not connected. Open Sessions and scan the QR first.' });
    }

    const leads = await Lead.find({ _id: { $in: leadIds }, userId: req.userId }).select('_id phone');
    let verified = 0; let notRegistered = 0; const failures = [];

    for (const lead of leads) {
      try {
        const ok = await wa.checkWhatsApp(sessionId, lead.phone);
        await Lead.updateOne(
          { _id: lead._id, userId: req.userId },
          { $set: { whatsappVerified: !!ok, whatsappCheckedAt: new Date() } }
        );
        if (ok) verified++; else notRegistered++;
      } catch (e) {
        failures.push({ leadId: String(lead._id), error: e.message });
      }
    }

    res.json({ checked: leads.length, verified, notRegistered, failures });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/sessions/:sessionId', async (req, res) => {
  try {
    const session = await WASession.findOne({ sessionId: req.params.sessionId, userId: req.userId });
    if (!session) return res.status(404).json({ error: 'Session not found' });
    await wa.destroySession(req.params.sessionId).catch(() => {});
    await WASession.deleteOne({ _id: session._id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
