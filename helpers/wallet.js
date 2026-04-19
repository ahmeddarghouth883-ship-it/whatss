/**
 * helpers/wallet.js — single source of truth for credit movements.
 *
 * Design:
 *   - User.credits is the canonical balance.
 *   - Every mutation goes through `charge()` / `topup()` here.
 *   - Atomic: uses findOneAndUpdate with `{ credits: { $gte: cost } }` to prevent overdraft.
 *   - Idempotent: every Transaction has a unique sparse `reference`. A retry with
 *     the same reference returns the existing transaction instead of double-charging.
 *   - Audit-ready: every Transaction stores `balanceAfter` so the wallet can be
 *     replayed/reconciled from the transaction stream alone.
 */

const User = require('../models/User');
const Transaction = require('../models/Transaction');

const CREDIT_COSTS = {
  extraction: 1,    // 1 credit per saved lead
  message:    0.5,  // 0.5 credit per WhatsApp message sent
};

class InsufficientCreditsError extends Error {
  constructor(needed, have) {
    super('INSUFFICIENT_CREDITS');
    this.code     = 'INSUFFICIENT_CREDITS';
    this.status   = 402;
    this.needed   = needed;
    this.have     = have;
  }
}

function asObjectIdString(id) {
  return id && typeof id === 'object' && id.toString ? id.toString() : String(id);
}

/**
 * Atomically deduct `cost` credits from the user.
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {number} opts.cost              — must be > 0
 * @param {string} opts.source            — 'extraction' | 'message' | ...
 * @param {string} [opts.reference]       — unique idempotency key (e.g. `lead:<id>`)
 * @param {Object} [opts.metadata]
 * @param {string} [opts.description]
 *
 * @throws InsufficientCreditsError
 * @returns {Promise<{ ok: true, transaction, balance, idempotent? }>}
 */
async function charge({ userId, cost, source, reference, metadata, description }) {
  if (!userId) throw new Error('charge: userId required');
  if (!(cost > 0)) throw new Error('charge: cost must be > 0');
  if (!source) throw new Error('charge: source required');

  // 1. Idempotency check — same reference already charged? return that txn.
  if (reference) {
    const existing = await Transaction.findOne({ reference });
    if (existing) {
      const u = await User.findById(userId).select('credits');
      return { ok: true, transaction: existing, balance: u?.credits ?? null, idempotent: true };
    }
  }

  // 2. Atomic deduct (only if balance >= cost).
  const updated = await User.findOneAndUpdate(
    { _id: userId, credits: { $gte: cost } },
    { $inc: { credits: -cost } },
    { new: true, projection: { credits: 1 } }
  );

  if (!updated) {
    const u = await User.findById(userId).select('credits');
    throw new InsufficientCreditsError(cost, u?.credits ?? 0);
  }

  // 3. Write Transaction. If reference race collides, refund and re-fetch.
  try {
    const txn = await Transaction.create({
      userId,
      type:        'spend',
      source,
      amount:      0,
      credits:     -cost,
      balanceAfter: updated.credits,
      reference:   reference || undefined,
      metadata:    metadata || null,
      description: description || `${source} charge`,
      status:      'completed',
    });
    return { ok: true, transaction: txn, balance: updated.credits };
  } catch (err) {
    // Compensating refund on any post-deduct failure.
    await User.updateOne({ _id: userId }, { $inc: { credits: cost } }).catch(() => {});
    if (err && err.code === 11000 && reference) {
      const existing = await Transaction.findOne({ reference });
      if (existing) {
        const u = await User.findById(userId).select('credits');
        return { ok: true, transaction: existing, balance: u?.credits ?? null, idempotent: true };
      }
    }
    throw err;
  }
}

/**
 * Atomically add `credits` to the user.
 *
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {number} opts.credits           — must be > 0
 * @param {string} opts.source            — 'admin' | 'order' | 'signup_bonus' | 'refund'
 * @param {string} [opts.type]            — 'topup' (default) | 'bonus' | 'order' | 'refund'
 * @param {string} [opts.reference]
 * @param {Object} [opts.metadata]
 * @param {string} [opts.description]
 *
 * @returns {Promise<{ ok: true, transaction, balance, idempotent? }>}
 */
async function topup({ userId, credits, source, type, reference, metadata, description }) {
  if (!userId) throw new Error('topup: userId required');
  if (!(credits > 0)) throw new Error('topup: credits must be > 0');
  if (!source) throw new Error('topup: source required');

  // Idempotency check.
  if (reference) {
    const existing = await Transaction.findOne({ reference });
    if (existing) {
      const u = await User.findById(userId).select('credits');
      return { ok: true, transaction: existing, balance: u?.credits ?? null, idempotent: true };
    }
  }

  const updated = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { credits } },
    { new: true, projection: { credits: 1 } }
  );
  if (!updated) throw new Error('topup: user not found');

  try {
    const txn = await Transaction.create({
      userId,
      type:        type || 'topup',
      source,
      amount:      0,
      credits,
      balanceAfter: updated.credits,
      reference:   reference || undefined,
      metadata:    metadata || null,
      description: description || `${source} top-up`,
      status:      'completed',
    });
    return { ok: true, transaction: txn, balance: updated.credits };
  } catch (err) {
    await User.updateOne({ _id: userId }, { $inc: { credits: -credits } }).catch(() => {});
    if (err && err.code === 11000 && reference) {
      const existing = await Transaction.findOne({ reference });
      if (existing) {
        const u = await User.findById(userId).select('credits');
        return { ok: true, transaction: existing, balance: u?.credits ?? null, idempotent: true };
      }
    }
    throw err;
  }
}

/**
 * Read-only balance.
 */
async function getBalance(userId) {
  const u = await User.findById(userId).select('credits');
  return u ? Number(u.credits || 0) : 0;
}

/**
 * Throws InsufficientCreditsError if balance < cost. Use as a route preflight.
 */
async function ensureCredits(userId, cost) {
  const balance = await getBalance(userId);
  if (balance < cost) throw new InsufficientCreditsError(cost, balance);
  return balance;
}

module.exports = {
  CREDIT_COSTS,
  charge,
  topup,
  getBalance,
  ensureCredits,
  InsufficientCreditsError,
  asObjectIdString,
};
