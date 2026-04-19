/**
 * /api/admin — admin-only dashboard endpoints.
 *
 *   GET  /api/admin/stats                        platform stats
 *   GET  /api/admin/users?limit=50               list users
 *   PUT  /api/admin/users/:id                    patch user (isActive, plan, role, name, ...)
 *   POST /api/admin/users/:id/topup              wallet top-up via wallet.topup() + AdminAction
 *   GET  /api/admin/transactions?limit=20        all transactions
 *   GET  /api/admin/orders?status=pending        list orders (pending by default)
 *   GET  /api/admin/orders/:id                   single order
 *   POST /api/admin/orders/:id/approve           approve → wallet.topup + plan switch + audit
 *   POST /api/admin/orders/:id/reject            reject with reason → audit
 *   GET  /api/admin/audit?limit=50               admin action audit log
 */

const express  = require('express');
const mongoose = require('mongoose');
const User        = require('../models/User');
const Lead        = require('../models/Lead');
const Message     = require('../models/Message');
const Transaction = require('../models/Transaction');
const Order       = require('../models/Order');
const AdminAction = require('../models/AdminAction');
const wallet      = require('../helpers/wallet');
const { authenticate, requireAdmin } = require('../helpers/auth');

const router = express.Router();

router.use(authenticate, requireAdmin);

// Auto-join admins to the `admins` socket room — useful when admin keeps the
// dashboard open and we want to push order:created events live.
router.use((req, _res, next) => {
  try {
    const io = req.app.get('io');
    if (io) {
      // Best-effort: emit a noop to ensure room exists for broadcasts.
      io.to('admins'); // touches the room
    }
  } catch (_) { /* ignore */ }
  next();
});

// ── stats ────────────────────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const [users, leads, messages, activeToday, pendingOrders] = await Promise.all([
      User.countDocuments({}),
      Lead.countDocuments({}),
      Message.countDocuments({}).catch(() => 0),
      User.countDocuments({ lastLogin: { $gte: since } }),
      Order.countDocuments({ status: 'pending' }),
    ]);
    return res.json({ users, leads, messages, activeToday, pendingOrders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── users ────────────────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    const users = await User.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('-password -emailVerificationToken -emailVerificationCode -passwordResetCode')
      .lean();
    return res.json({ users });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.put('/users/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });

    const allowed = ['isActive', 'plan', 'role', 'credits', 'name', 'company', 'phone'];
    const patch = {};
    for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
    if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

    const before = await User.findById(req.params.id).select('-password').lean();
    if (!before) return res.status(404).json({ error: 'User not found' });

    const after = await User.findByIdAndUpdate(req.params.id, patch, { new: true }).select('-password');

    // Audit row(s)
    const actions = [];
    if ('isActive' in patch && before.isActive !== patch.isActive) actions.push(patch.isActive ? 'user_activated' : 'user_suspended');
    if ('plan' in patch && before.plan !== patch.plan) actions.push('plan_changed');
    if ('role' in patch && before.role !== patch.role) actions.push('role_changed');
    for (const action of actions) {
      await AdminAction.create({
        adminId:      req.userId,
        action,
        targetUserId: req.params.id,
        before:       { isActive: before.isActive, plan: before.plan, role: before.role },
        after:        { isActive: after.isActive, plan: after.plan, role: after.role },
      });
    }

    return res.json({ user: after.toPublic ? after.toPublic() : after });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// Manual top-up by admin — uses wallet.topup() so balanceAfter is recorded.
router.post('/users/:id/topup', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid user id' });

    const credits     = Math.round(Number(req.body?.credits) || 0);
    const description = String(req.body?.description || 'Admin top-up');
    if (!credits) return res.status(400).json({ error: 'credits must be a non-zero number' });

    const user = await User.findById(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let result;
    if (credits > 0) {
      result = await wallet.topup({
        userId:      user._id,
        credits,
        source:      'admin',
        type:        'topup',
        reference:   `admin:${req.userId}:${user._id}:${Date.now()}`,
        description,
        metadata:    { adminId: req.userId },
      });
    } else {
      // Negative top-up = debit. Use charge() so we can't go below zero.
      result = await wallet.charge({
        userId:      user._id,
        cost:        Math.abs(credits),
        source:      'admin',
        reference:   `admin:${req.userId}:${user._id}:${Date.now()}`,
        description,
        metadata:    { adminId: req.userId, type: 'admin_deduct' },
      });
    }

    await AdminAction.create({
      adminId:      req.userId,
      action:       credits > 0 ? 'credits_topup' : 'credits_deduct',
      targetUserId: user._id,
      before:       { credits: user.credits },
      after:        { credits: result.balance },
      reason:       description,
    });

    const fresh = await User.findById(user._id);
    return res.json({ ok: true, user: fresh.toPublic(), transaction: result.transaction });
  } catch (err) {
    if (err?.code === 'INSUFFICIENT_CREDITS') {
      return res.status(409).json({ error: 'INSUFFICIENT_CREDITS', have: err.have, needed: err.needed });
    }
    console.error('[admin/topup]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── transactions ─────────────────────────────────────────────────────────────
router.get('/transactions', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 20));
    const transactions = await Transaction.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', 'name email')
      .lean();
    return res.json({ transactions });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── orders ───────────────────────────────────────────────────────────────────
router.get('/orders', async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    const limit  = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    const filter = status ? { status } : {};
    const orders = await Order.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('userId', 'name email credits plan')
      .populate('reviewedBy', 'name email')
      .lean();
    return res.json({ orders });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/orders/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const order = await Order.findById(req.params.id)
      .populate('userId', 'name email credits plan')
      .populate('reviewedBy', 'name email')
      .lean();
    if (!order) return res.status(404).json({ error: 'Order not found' });
    return res.json({ order });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/orders/:id/approve', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'pending') {
      return res.status(409).json({ error: `Order already ${order.status}` });
    }

    const user = await User.findById(order.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const beforeCredits = user.credits;
    const beforePlan    = user.plan;

    let txn = null;
    if (order.creditsToGrant > 0) {
      const result = await wallet.topup({
        userId:      user._id,
        credits:     order.creditsToGrant,
        source:      'order',
        type:        'order',
        reference:   `order:${order._id}`,                 // idempotent — re-approve never double-grants
        description: `Order ${order._id} (${order.planLabel || order.planCode}) approved`,
        metadata:    { orderId: order._id, planCode: order.planCode, adminId: req.userId },
      });
      txn = result.transaction;
    }

    // Move user onto the new plan tier (if recognized by the User schema enum).
    const planMap = { basic: 'starter', pro: 'pro', enterprise: 'agency', starter: 'starter', agency: 'agency' };
    const newPlan = planMap[order.planCode] || user.plan;
    if (newPlan && newPlan !== user.plan) user.plan = newPlan;
    await user.save();

    order.status         = 'approved';
    order.reviewedBy     = req.userId;
    order.reviewedAt     = new Date();
    order.transactionId  = txn ? txn._id : null;
    await order.save();

    await AdminAction.create({
      adminId:       req.userId,
      action:        'order_approved',
      targetUserId:  user._id,
      targetOrderId: order._id,
      before:        { credits: beforeCredits, plan: beforePlan, status: 'pending' },
      after:         { credits: user.credits, plan: user.plan, status: 'approved', creditsGranted: order.creditsToGrant },
    });

    // Notify the buying user.
    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${String(user._id)}`).emit('order:approved', {
          orderId:        order._id,
          planCode:       order.planCode,
          planLabel:      order.planLabel,
          creditsGranted: order.creditsToGrant,
          newBalance:     user.credits,
        });
      }
    } catch (_) { /* ignore */ }

    return res.json({ ok: true, order, user: user.toPublic ? user.toPublic() : user });
  } catch (err) {
    console.error('[admin/orders/approve]', err);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/orders/:id/reject', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const reason = String(req.body?.reason || '').trim();
    const order  = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status !== 'pending') {
      return res.status(409).json({ error: `Order already ${order.status}` });
    }

    order.status          = 'rejected';
    order.rejectionReason = reason || 'Rejected by admin';
    order.reviewedBy      = req.userId;
    order.reviewedAt      = new Date();
    await order.save();

    await AdminAction.create({
      adminId:       req.userId,
      action:        'order_rejected',
      targetUserId:  order.userId,
      targetOrderId: order._id,
      before:        { status: 'pending' },
      after:         { status: 'rejected' },
      reason:        order.rejectionReason,
    });

    try {
      const io = req.app.get('io');
      if (io) {
        io.to(`user:${String(order.userId)}`).emit('order:rejected', {
          orderId:  order._id,
          reason:   order.rejectionReason,
          planCode: order.planCode,
        });
      }
    } catch (_) { /* ignore */ }

    return res.json({ ok: true, order });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ── audit log ────────────────────────────────────────────────────────────────
router.get('/audit', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    const items = await AdminAction.find({})
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('adminId', 'name email')
      .populate('targetUserId', 'name email')
      .lean();
    return res.json({ items });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
