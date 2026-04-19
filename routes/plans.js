/**
 * /api/plans — public catalog of subscription plans.
 *   GET /api/plans          list active plans (sorted)
 *   GET /api/plans/:code    single plan by code
 */

const express = require('express');
const Plan    = require('../models/Plan');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const plans = await Plan.find({ active: true })
      .sort({ sortOrder: 1, priceTnd: 1 })
      .lean();
    return res.json({ plans });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:code', async (req, res) => {
  try {
    const code = String(req.params.code || '').toLowerCase();
    const plan = await Plan.findOne({ code, active: true }).lean();
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    return res.json({ plan });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
