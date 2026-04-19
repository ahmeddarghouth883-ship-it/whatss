/**
 * Polls MongoDB every 30 seconds for ScheduledMessages that are due.
 * Fires each one using the same background loop as /api/messages/direct.
 */

const ScheduledMessage = require('../models/ScheduledMessage');
const Message          = require('../models/Message');
const wallet           = require('./wallet');
const { sendMessage, getClient } = require('./whatsappManager');

const COST = wallet.CREDIT_COSTS.message;

let io;

function userRoom(userId) {
  return `user:${String(userId)}`;
}

async function sendMediaBatch(sessionId, phone, text, mediaUrls) {
  if (!mediaUrls || mediaUrls.length === 0) {
    await sendMessage(sessionId, phone, text, null);
    return;
  }
  // First message carries the text + first file
  await sendMessage(sessionId, phone, text || '', mediaUrls[0]);
  // Subsequent files sent as follow-ups (no caption)
  for (let i = 1; i < mediaUrls.length; i++) {
    await sendMessage(sessionId, phone, '', mediaUrls[i]);
  }
}

async function fireScheduled(job) {
  if (!getClient(job.sessionId)) {
    await ScheduledMessage.updateOne({ _id: job._id }, {
      status: 'failed',
      error:  'WhatsApp session not connected',
      finishedAt: new Date(),
    });
    return;
  }

  await ScheduledMessage.updateOne({ _id: job._id }, { status: 'running', startedAt: new Date() });

  let sent = 0;
  let failed = 0;
  const room = userRoom(job.userId);

  for (const phone of job.phones) {
    try { await wallet.ensureCredits(job.userId, COST); }
    catch (_) {
      failed += job.phones.length - sent - failed;
      break;
    }

    try {
      await sendMediaBatch(job.sessionId, phone, job.message, job.mediaUrls);

      const msgDoc = await Message.create({
        userId:   job.userId,
        sessionId: job.sessionId,
        phone,
        message:  job.message || '',
        status:   'sent',
        sentAt:   new Date(),
      });

      await wallet.charge({
        userId:      job.userId,
        cost:        COST,
        source:      'message',
        reference:   `sched-msg:${job._id}:${phone}`,
        metadata:    { scheduledMessageId: job._id, messageId: msgDoc._id, phone },
        description: `Scheduled message to ${phone}`,
      }).catch(() => {});

      sent++;
    } catch (err) {
      failed++;
      await Message.create({
        userId: job.userId, sessionId: job.sessionId, phone,
        message: job.message || '', status: 'failed',
        failReason: String(err?.message || err).slice(0, 400),
      }).catch(() => {});
    }

    io?.to(room).emit('direct:progress', { sent, failed, total: job.phones.length, scheduled: true });
  }

  await ScheduledMessage.updateOne({ _id: job._id }, {
    status: failed > 0 && sent === 0 ? 'failed' : 'done',
    sent, failed, finishedAt: new Date(),
  });

  io?.to(room).emit('direct:done', { sent, failed, total: job.phones.length, scheduled: true });
}

async function checkScheduled() {
  try {
    const now  = new Date();
    const jobs = await ScheduledMessage.find({ status: 'pending', scheduledAt: { $lte: now } }).limit(20).lean();
    for (const job of jobs) {
      fireScheduled(job).catch(err => console.error('[scheduler] fire error:', err.message));
    }
  } catch (err) {
    console.warn('[scheduler] poll error:', err.message);
  }
}

function startScheduler(ioInstance) {
  io = ioInstance;
  setInterval(checkScheduled, 30_000);
  checkScheduled();
  console.log('[scheduler] Started — checking every 30s');
}

module.exports = { startScheduler };
