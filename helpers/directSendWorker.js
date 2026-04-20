/**
 * Processes DirectSendJob queue: BATCH_SIZE sends, BREAK_MS cooldown, repeat.
 * Survives tab close — state lives in MongoDB; scheduler polls every 30s.
 */

const Message = require('../models/Message');
const DirectSendJob = require('../models/DirectSendJob');
const wallet = require('./wallet');
const { touchLeadLastContactedByPhone } = require('./leadContact');
const { sendMessage, getClient } = require('./whatsappManager');
const { BATCH_SIZE, BREAK_MS } = require('./sendBatchConfig');

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
  await sendMessage(sessionId, phone, text || '', mediaUrls[0]);
  for (let i = 1; i < mediaUrls.length; i++) {
    await sendMessage(sessionId, phone, '', mediaUrls[i]);
  }
}

function emitProgress(userId, payload) {
  const room = userRoom(userId);
  io?.to(room).emit('direct:progress', payload);
  const uid = String(userId);
  io?.to(uid).emit('direct:progress', payload);
}

function emitCooling(userId, payload) {
  const room = userRoom(userId);
  io?.to(room).emit('direct:cooling', payload);
  io?.to(String(userId)).emit('direct:cooling', payload);
}

function emitDone(userId, payload) {
  const room = userRoom(userId);
  io?.to(room).emit('direct:done', payload);
  io?.to(String(userId)).emit('direct:done', payload);
}

/**
 * Run one chunk (up to BATCH_SIZE phones) for a job, then cool or finish.
 */
async function runJobChunk(job) {
  const jid = job._id;

  if (!getClient(job.sessionId)) {
    await DirectSendJob.updateOne(
      { _id: jid },
      { status: 'failed', error: 'WhatsApp session not connected', finishedAt: new Date() }
    );
    emitDone(job.userId, {
      sent: job.sent,
      failed: job.failed,
      total: job.phones.length,
      stopped: 'NO_SESSION',
    });
    return;
  }

  await DirectSendJob.updateOne({ _id: jid }, { status: 'running', startedAt: job.startedAt || new Date() });

  const phones = job.phones || [];
  const start = Math.min(job.cursor || 0, phones.length);
  const end = Math.min(start + BATCH_SIZE, phones.length);

  let sent = job.sent || 0;
  let failed = job.failed || 0;

  for (let i = start; i < end; i++) {
    const phone = phones[i];
    try {
      await wallet.ensureCredits(job.userId, COST);
    } catch (_) {
      failed += phones.length - sent - failed;
      await DirectSendJob.updateOne(
        { _id: jid },
        {
          status: 'failed',
          sent,
          failed,
          cursor: i,
          error: 'INSUFFICIENT_CREDITS',
          finishedAt: new Date(),
        }
      );
      emitDone(job.userId, {
        sent,
        failed,
        total: phones.length,
        stopped: 'INSUFFICIENT_CREDITS',
      });
      return;
    }

    try {
      await sendMediaBatch(job.sessionId, phone, job.message, job.mediaUrls || []);

      const msgDoc = await Message.create({
        userId: job.userId,
        sessionId: job.sessionId,
        phone,
        message: job.message || '',
        mediaUrl: (job.mediaUrls && job.mediaUrls[0]) || null,
        status: 'sent',
        sentAt: new Date(),
      });

      await wallet.charge({
        userId: job.userId,
        cost: COST,
        source: 'message',
        reference: `direct-job:${jid}:${phone}:${Date.now()}`,
        metadata: { directJobId: jid, messageId: msgDoc._id, phone, sessionId: job.sessionId },
        description: `Message sent to ${phone}`,
      }).catch(() => {});

      await touchLeadLastContactedByPhone(job.userId, phone);

      sent++;
    } catch (err) {
      failed++;
      await Message.create({
        userId: job.userId,
        sessionId: job.sessionId,
        phone,
        message: job.message || '',
        mediaUrl: (job.mediaUrls && job.mediaUrls[0]) || null,
        status: 'failed',
        failReason: String(err?.message || 'send failed').slice(0, 400),
      }).catch(() => {});
    }

    emitProgress(job.userId, { sent, failed, total: phones.length, throttled: true });
  }

  const newCursor = end;

  if (newCursor >= phones.length) {
    await DirectSendJob.updateOne(
      { _id: jid },
      {
        status: 'done',
        cursor: newCursor,
        sent,
        failed,
        finishedAt: new Date(),
      }
    );
    emitDone(job.userId, { sent, failed, total: phones.length, throttled: true });
    return;
  }

  const nextRunAt = new Date(Date.now() + BREAK_MS);
  await DirectSendJob.updateOne(
    { _id: jid },
    {
      status: 'cooling',
      cursor: newCursor,
      sent,
      failed,
      nextRunAt,
    }
  );

  emitCooling(job.userId, {
    sent,
    failed,
    total: phones.length,
    nextResumeAt: nextRunAt.toISOString(),
    breakMinutes: Math.round(BREAK_MS / 60000),
    batchSize: BATCH_SIZE,
  });

  emitProgress(job.userId, {
    sent,
    failed,
    total: phones.length,
    cooling: true,
    nextResumeAt: nextRunAt.toISOString(),
    throttled: true,
  });
}

async function claimNextJob() {
  const now = new Date();

  // One active chunk at a time — do not start another job while a chunk is sending
  if (await DirectSendJob.exists({ status: 'running' })) return null;

  // Resume a cooled job whose break has ended (before starting any new pending job)
  let job = await DirectSendJob.findOneAndUpdate(
    { status: 'cooling', nextRunAt: { $lte: now } },
    { $set: { status: 'running' } },
    { sort: { nextRunAt: 1 }, new: true }
  );

  // Do not dequeue pending while another job is still in its cooldown window
  if (!job && !(await DirectSendJob.exists({ status: 'cooling' }))) {
    job = await DirectSendJob.findOneAndUpdate(
      { status: 'pending' },
      { $set: { status: 'running', startedAt: new Date() } },
      { sort: { createdAt: 1 }, new: true }
    );
  }

  return job;
}

async function recoverStaleRunning() {
  const cutoff = new Date(Date.now() - 8 * 60 * 1000);
  await DirectSendJob.updateMany(
    { status: 'running', startedAt: { $lt: cutoff } },
    { $set: { status: 'pending' } }
  ).catch(() => {});
}

async function checkDirectJobs() {
  try {
    await recoverStaleRunning();

    const claimed = await claimNextJob();
    if (!claimed) return;

    const fresh = await DirectSendJob.findById(claimed._id).lean();
    if (!fresh || fresh.status === 'cancelled' || fresh.status === 'done') return;

    await runJobChunk(fresh);
  } catch (err) {
    console.warn('[directSendWorker]', err.message);
  }
}

function startDirectSendWorker(ioInstance) {
  io = ioInstance;
  console.log(
    `[directSendWorker] batch=${BATCH_SIZE}, break=${Math.round(BREAK_MS / 60000)}min`
  );
}

module.exports = { startDirectSendWorker, checkDirectJobs, BATCH_SIZE, BREAK_MS };
