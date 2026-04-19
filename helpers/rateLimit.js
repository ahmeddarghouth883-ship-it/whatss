/**
 * helpers/rateLimit.js — per-user rate-limit middleware for billable endpoints.
 *
 * Keys requests by `req.userId` when authenticated, otherwise by IP. Uses
 * the in-memory store from express-rate-limit (good enough for a single
 * Node process; swap for a Redis store when horizontally scaling).
 */

const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

function userKey(req, res) {
  if (req.userId) return `u:${String(req.userId)}`;
  return `ip:${ipKeyGenerator(req, res)}`;
}

const scrapeLimiter = rateLimit({
  windowMs:        5 * 60 * 1000,   // 5 minutes
  max:             10,              // 10 jobs / window / user
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    userKey,
  message: {
    error: 'Too many extraction jobs. Please wait a few minutes and try again.',
    code:  'RATE_LIMITED',
  },
});

const messageLimiter = rateLimit({
  windowMs:        60 * 1000,       // 1 minute
  max:             60,              // 60 sends / minute / user
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    userKey,
  message: {
    error: 'Too many messages sent. Slow down to protect your WhatsApp account.',
    code:  'RATE_LIMITED',
  },
});

const orderLimiter = rateLimit({
  windowMs:        60 * 60 * 1000,  // 1 hour
  max:             20,              // 20 order submits / hour / user
  standardHeaders: true,
  legacyHeaders:   false,
  keyGenerator:    userKey,
  message: {
    error: 'Too many purchase requests. Please wait before submitting another.',
    code:  'RATE_LIMITED',
  },
});

module.exports = { scrapeLimiter, messageLimiter, orderLimiter };
