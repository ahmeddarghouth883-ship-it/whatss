/**
 * Shared batch size + cooldown between batches for:
 * - DirectSendJob (compose)
 * - Campaign sends
 * - Scheduled sends
 *
 * Env: DIRECT_SEND_BATCH (default 10), DIRECT_SEND_BREAK_MS (default 20 minutes).
 */

const BATCH_SIZE = Math.max(1, Math.min(100, Number(process.env.DIRECT_SEND_BATCH) || 10));
const BREAK_MS = Math.max(60_000, Number(process.env.DIRECT_SEND_BREAK_MS) || 20 * 60 * 1000);

module.exports = { BATCH_SIZE, BREAK_MS };
