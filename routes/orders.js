/**
 * /api/orders — user-side order workflow.
 *
 *   POST /api/orders                  { planCode, paymentMethod, paymentReference?, notes? }
 *   GET  /api/orders                  list MY orders (newest first)
 *   GET  /api/orders/:id              get one (must own it)
 *   POST /api/orders/:id/cancel       cancel (only if still pending)
 *
 * Orders never grant credits directly. Credits only land in the wallet when an
 * admin approves the order (see routes/admin.js → POST /admin/orders/:id/approve).
 */

const express  = require('express');
const mongoose = require('mongoose');
const { authenticate } = require('../helpers/auth');
const { orderLimiter } = require('../helpers/rateLimit');
const Plan  = require('../models/Plan');
const Order = require('../models/Order');

const router = express.Router();

router.post('/', authenticate, orderLimiter, async (req, res) => {
  try {
    const planCode         = String(req.body?.planCode || '').trim().toLowerCase();
    const paymentMethod    = String(req.body?.paymentMethod || 'manual').trim();
    const paymentReference = String(req.body?.paymentReference || '').trim();
    const notes            = String(req.body?.notes || '').trim();

    if (!planCode) return res.status(400).json({ error: 'planCode is required' });

    const plan = await Plan.findOne({ code: planCode, active: true });
    if (!plan) return res.status(404).json({ error: 'Plan not found' });
    if (plan.code === 'free_trial') {
      return res.status(400).json({ error: 'Free trial cannot be purchased — granted automatically on signup.' });
    }

    const order = await Order.create({
      userId:           req.userId,
      planCode:         plan.code,
      planLabel:        plan.label,
      priceTnd:         plan.priceTnd,
      priceUsd:         plan.priceUsd,
      creditsToGrant:   plan.credits,
      status:           'pending',
      paymentMethod:    ['bank_transfer', 'd17', 'wise', 'cash', 'manual'].includes(paymentMethod) ? paymentMethod : 'manual',
      paymentReference,
      notes,
    });

    // Notify admins in real time.
    try {
      const io = req.app.get('io');
      if (io) {
        io.to('admins').emit('order:created', {
          orderId:   order._id,
          userId:    req.userId,
          planCode:  plan.code,
          planLabel: plan.label,
          priceTnd:  plan.priceTnd,
          createdAt: order.createdAt,
        });
      }
    } catch (e) {
      console.warn('[orders] socket emit failed:', e.message);
    }

    return res.status(201).json({ ok: true, order });
  } catch (err) {
    console.error('[orders] create:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, Number(req.query.limit) || 50));
    const orders = await Order.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();
    return res.json({ orders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const order = await Order.findOne({ _id: req.params.id, userId: req.userId }).lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });
    return res.json({ order });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/:id/cancel', authenticate, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const order = await Order.findOne({ _id: req.params.id, userId: req.userId });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'pending') {
      return res.status(409).json({ error: `Cannot cancel order with status ${order.status}` });
    }
    order.status = 'cancelled';
    await order.save();
    return res.json({ ok: true, order });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
