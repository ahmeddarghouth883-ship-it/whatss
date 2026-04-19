const mongoose = require('mongoose');

/**
 * Background compose (/messages/direct) with throttling:
 * BATCH_SIZE messages, then BREAK_MS pause, repeat until all phones are done.
 */
const DirectSendJobSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId:   { type: String, required: true },
  phones:      [{ type: String }],
  message:     { type: String, default: '' },
  mediaUrls:   [{ type: String }],
  cursor:      { type: Number, default: 0 },
  sent:        { type: Number, default: 0 },
  failed:      { type: Number, default: 0 },
  status:      {
    type: String,
    enum: ['pending', 'running', 'cooling', 'done', 'failed', 'cancelled'],
    default: 'pending',
    index: true,
  },
  nextRunAt:   { type: Date, index: true },
  error:       { type: String, default: '' },
  startedAt:   { type: Date },
  finishedAt:  { type: Date },
  createdAt:   { type: Date, default: Date.now },
});

DirectSendJobSchema.index({ userId: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('DirectSendJob', DirectSendJobSchema);
