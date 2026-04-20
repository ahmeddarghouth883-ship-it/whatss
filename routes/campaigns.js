/**
 * /api/campaigns — WhatsApp bulk sends to filtered leads.
 */

const express   = require('express');
const mongoose  = require('mongoose');
const { authenticate } = require('../helpers/auth');
const Campaign  = require('../models/Campaign');
const Lead      = require('../models/Lead');
const Message   = require('../models/Message');
const wallet    = require('../helpers/wallet');
const { sendMessage } = require('../helpers/whatsappManager');
const { touchLeadLastContactedByLeadId } = require('../helpers/leadContact');
const { BATCH_SIZE, BREAK_MS } = require('../helpers/sendBatchConfig');

const router = express.Router();

const running = new Set();

function personalize(template, lead) {
  const t = String(template || '');
  const name = lead.name || '';
  const city = lead.city || '';
  return t
    .replace(/\{\{name\}\}/gi, name)
    .replace(/\{\{city\}\}/gi, city)
    .replace(/\{\{business\}\}/gi, name)
    .replace(/\{\{category\}\}/gi, lead.category || '');
}

/** Collect lead id strings from various client shapes (array, comma-string, legacy object). */
function normalizeLeadIdList(raw) {
  if (raw == null) return [];
  if (Array.isArray(raw)) {
    return raw.map((id) => String(id || '').trim()).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  }
  if (typeof raw === 'object') {
    return Object.values(raw).map((id) => String(id || '').trim()).filter(Boolean);
  }
  return [];
}

function roomForUser(userId) {
  return `user:${String(userId)}`;
}

async function processCampaign(campaignId, io) {
  const id = String(campaignId);
  if (running.has(id)) return;
  running.add(id);

  const COST = wallet.CREDIT_COSTS.message;

  try {
    let campaign = await Campaign.findById(campaignId);
    if (!campaign) return;

    const userId = campaign.userId;
    const leadsRaw = await Lead.find({
      _id: { $in: campaign.leadIds },
      userId: campaign.userId,
    }).lean();
    const orderIdx = new Map(campaign.leadIds.map((id, i) => [String(id), i]));
    const leads = leadsRaw.sort(
      (a, b) => (orderIdx.get(String(a._id)) ?? 0) - (orderIdx.get(String(b._id)) ?? 0)
    );

    let idx = 0;
    outer: while (idx < leads.length) {
      campaign = await Campaign.findById(campaignId);
      if (!campaign || campaign.status === 'paused') break;
      if (campaign.status !== 'running') break;

      const chunkEnd = Math.min(idx + BATCH_SIZE, leads.length);

      for (let i = idx; i < chunkEnd; i++) {
        campaign = await Campaign.findById(campaignId);
        if (!campaign || campaign.status === 'paused') break outer;
        if (campaign.status !== 'running') break outer;

        const lead = leads[i];
        const text = personalize(campaign.message, lead);

        try {
          await wallet.ensureCredits(userId, COST);
        } catch (e) {
          if (e?.code === 'INSUFFICIENT_CREDITS') {
            campaign.status = 'paused';
            await campaign.save();
            io.to(roomForUser(userId)).emit('campaign:error', { campaignId: id, error: 'INSUFFICIENT_CREDITS' });
            break outer;
          }
          throw e;
        }

        let waMessageId;
        try {
          waMessageId = await sendMessage(
            campaign.sessionId,
            lead.phone,
            text,
            campaign.mediaUrl || null
          );
        } catch (err) {
          await Message.create({
            userId:     campaign.userId,
            campaignId: campaign._id,
            leadId:     lead._id,
            sessionId:  campaign.sessionId,
            phone:      lead.phone,
            message:    text,
            mediaUrl:   campaign.mediaUrl,
            status:     'failed',
            failReason: String(err?.message || err).slice(0, 400),
          });
          campaign.stats.failed = (campaign.stats.failed || 0) + 1;
          await campaign.save();
          continue;
        }

        const msgDoc = await Message.create({
          userId:     campaign.userId,
          campaignId: campaign._id,
          leadId:     lead._id,
          sessionId:  campaign.sessionId,
          phone:      lead.phone,
          message:    text,
          mediaUrl:   campaign.mediaUrl,
          status:     'sent',
          waMessageId,
          sentAt:     new Date(),
        });

        const reference = `msg:${waMessageId || msgDoc._id}`;
        try {
          await wallet.charge({
            userId:      campaign.userId,
            cost:        COST,
            source:      'message',
            reference,
            metadata:    { campaignId: campaign._id, messageId: msgDoc._id, phone: lead.phone },
            description: `Campaign message to ${lead.phone}`,
          });
        } catch (e) {
          console.warn('[campaigns] charge failed:', e?.message);
        }

        await touchLeadLastContactedByLeadId(campaign.userId, lead._id);

        campaign.stats.sent = (campaign.stats.sent || 0) + 1;
        campaign.stats.total = leads.length;
        await campaign.save();
        io.to(roomForUser(userId)).emit('campaign:progress', { campaignId: id, sent: campaign.stats.sent });
      }

      idx = chunkEnd;
      if (idx >= leads.length) break;

      campaign = await Campaign.findById(campaignId);
      if (!campaign || campaign.status === 'paused') break;
      if (campaign.status !== 'running') break;

      await new Promise((r) => setTimeout(r, BREAK_MS));
    }

    campaign = await Campaign.findById(campaignId);
    if (campaign && campaign.status === 'running') {
      campaign.status = 'done';
      campaign.completedAt = new Date();
      await campaign.save();
      io.to(roomForUser(userId)).emit('campaign:done', { campaignId: id });
    }
  } catch (err) {
    console.error('[campaigns/process]', err);
  } finally {
    running.delete(id);
  }
}

router.get('/', authenticate, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(200)
      .lean();
    return res.json({ campaigns });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/', authenticate, async (req, res) => {
  try {
    const name     = String(req.body?.name || '').trim();
    const message  = String(req.body?.message || '').trim();
    const sessionId = String(req.body?.sessionId || '').trim();
    const zone     = String(req.body?.zone || '').trim();
    const category = String(req.body?.category || '').trim();
    const mediaUrl = req.body?.mediaUrl ? String(req.body.mediaUrl) : undefined;
    const rateLimit = Math.max(1, Math.min(120, Number(req.body?.rateLimit) || 20));
    const scheduledAt = req.body?.scheduledAt ? new Date(req.body.scheduledAt) : null;

    if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });
    if (!message) return res.status(400).json({ error: 'message is required' });

    let leadIds;

    const audience = String(req.body?.audience || '').trim().toLowerCase();
    const wantsLeadSelection =
      audience === 'selected' || audience === 'selection' || req.body?.fromLeadsSelection === true;

    const mergedRaw = [
      ...normalizeLeadIdList(req.body?.leadIds),
      ...normalizeLeadIdList(req.body?.selectedLeadIds),
      ...normalizeLeadIdList(req.body?.lead_ids),
    ];
    const requestedUnique = [...new Set(mergedRaw)].filter((id) => mongoose.isValidObjectId(id));

    async function resolveExplicitLeadIds(requested) {
      if (!requested.length) return [];
      const oidList = requested.map((id) => new mongoose.Types.ObjectId(id));
      const found = await Lead.find({
        userId: req.userId,
        _id: { $in: oidList },
      })
        .select('_id')
        .lean();
      const allowed = new Set(found.map((l) => String(l._id)));
      return requested.filter((id) => allowed.has(id)).map((id) => new mongoose.Types.ObjectId(id));
    }

    if (wantsLeadSelection) {
      if (!requestedUnique.length) {
        return res.status(400).json({
          error:
            'No valid lead IDs were sent. Select contacts on Leads again and retry (send leadIds / selectedLeadIds).',
        });
      }
      leadIds = await resolveExplicitLeadIds(requestedUnique);
      if (!leadIds.length) {
        return res.status(400).json({ error: 'None of the given leads belong to your account' });
      }
    } else if (requestedUnique.length > 0) {
      leadIds = await resolveExplicitLeadIds(requestedUnique);
      if (!leadIds.length) {
        return res.status(400).json({ error: 'None of the given leads belong to your account' });
      }
    } else {
      const filter = { userId: req.userId };
      if (zone) filter.zone = zone;
      if (category) filter.category = category;

      const leadDocs = await Lead.find(filter).sort({ createdAt: -1 }).limit(5000).select('_id').lean();
      leadIds = leadDocs.map((l) => l._id);
    }

    const campaign = await Campaign.create({
      userId:      req.userId,
      name:        name || `Campaign ${new Date().toISOString().slice(0, 16)}`,
      message,
      mediaUrl,
      zone:        zone || undefined,
      category:    category || undefined,
      leadIds,
      sessionId,
      status:      'draft',
      scheduledAt: scheduledAt || undefined,
      rateLimit,
      stats:       { total: leadIds.length, sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, optedOut: 0 },
    });

    return res.json({ campaign, leadCount: leadIds.length });
  } catch (err) {
    console.error('[campaigns/create]', err);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });

    const messages = await Message.find({ userId: req.userId, campaignId: campaign._id })
      .sort({ createdAt: -1 })
      .limit(500)
      .lean();

    return res.json({ campaign, messages });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:id/send', authenticate, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (!campaign.leadIds?.length) return res.status(400).json({ error: 'No leads in this campaign' });

    campaign.status = 'running';
    campaign.startedAt = campaign.startedAt || new Date();
    await campaign.save();

    const io = req.app.get('io');
    setImmediate(() => processCampaign(campaign._id, io));

    return res.json({ ok: true, started: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:id/pause', authenticate, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const campaign = await Campaign.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { status: 'paused' },
      { new: true }
    ).lean();
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    return res.json({ ok: true, campaign });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', authenticate, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status === 'running') {
      campaign.status = 'paused';
      await campaign.save();
    }
    await Message.deleteMany({ userId: req.userId, campaignId: campaign._id });
    await Campaign.deleteOne({ _id: campaign._id });
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
