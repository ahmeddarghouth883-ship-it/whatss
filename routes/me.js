/**
 * /api/me — anything scoped to the currently authenticated user.
 *   GET  /api/me/usage                      today's Places + Geocoding usage and est. $
 *   GET  /api/me/wallet                     { credits, plan, planLabel, recent: [tx], pending: [order] }
 *   GET  /api/me/transactions?limit=50      paginated wallet history
 *   GET  /api/me/transactions/daily?days=14 daily aggregate (extraction + message credit usage)
 */

const express  = require('express');
const mongoose = require('mongoose');
const { authenticate } = require('../helpers/auth');
const { getUsageToday } = require('../helpers/usage');
const Transaction = require('../models/Transaction');
const Order       = require('../models/Order');
const Plan        = require('../models/Plan');
const User        = require('../models/User');

const router = express.Router();
router.use(authenticate);

router.get('/usage', async (req, res) => {
  try {
    const usage = await getUsageToday(req.userId);
    res.json(usage);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/wallet', async (req, res) => {
  try {
    const [user, recent, pending] = await Promise.all([
      User.findById(req.userId).select('credits plan').lean(),
      Transaction.find({ userId: req.userId }).sort({ createdAt: -1 }).limit(10).lean(),
      Order.find({ userId: req.userId, status: 'pending' }).sort({ createdAt: -1 }).lean(),
    ]);

    let plan = null;
    if (user?.plan) {
      // Best-effort match: app User.plan enum is free/starter/pro/agency,
      // Plan.code is free_trial/basic/pro/enterprise. Map both.
      const planMap = { free: 'free_trial', starter: 'basic', pro: 'pro', agency: 'enterprise' };
      const code = planMap[user.plan] || user.plan;
      plan = await Plan.findOne({ code }).lean();
    }

    res.json({
      credits:   user?.credits ?? 0,
      planCode:  user?.plan ?? null,
      plan,
      recent,
      pending,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/transactions', async (req, res) => {
  try {
    const limit  = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    const source = req.query.source ? String(req.query.source) : null;
    const filter = { userId: req.userId };
    if (source) filter.source = source;
    const items = await Transaction.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/transactions/daily', async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, Number(req.query.days) || 14));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const userId = new mongoose.Types.ObjectId(String(req.userId));

    const rows = await Transaction.aggregate([
      { $match: { userId, createdAt: { $gte: since } } },
      {
        $group: {
          _id: {
            day:    { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
            source: '$source',
          },
          credits: { $sum: '$credits' },
          count:   { $sum: 1 },
        },
      },
      { $sort: { '_id.day': 1 } },
    ]);

    // Reshape: [{ day, extraction, message, topup, total }]
    const map = new Map();
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - (days - 1 - i) * 24 * 60 * 60 * 1000);
      const key = d.toISOString().slice(0, 10);
      map.set(key, { day: key, extraction: 0, message: 0, topup: 0, other: 0 });
    }
    for (const r of rows) {
      const day = r._id.day;
      const slot = map.get(day) || { day, extraction: 0, message: 0, topup: 0, other: 0 };
      // credits is signed: spend < 0, topup > 0. We want absolute usage values.
      const abs = Math.abs(r.credits);
      if (r._id.source === 'extraction') slot.extraction += abs;
      else if (r._id.source === 'message') slot.message += abs;
      else if (r._id.source === 'order' || r._id.source === 'admin' || r._id.source === 'signup_bonus') {
        if (r.credits > 0) slot.topup += r.credits;
      } else slot.other += abs;
      map.set(day, slot);
    }

    res.json({ days, series: Array.from(map.values()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
