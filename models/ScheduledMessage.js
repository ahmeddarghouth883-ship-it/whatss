const mongoose = require('mongoose');

const ScheduledMessageSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId:  { type: String, required: true },
  phones:     [{ type: String }],
  message:    { type: String, default: '' },
  mediaUrls:  [{ type: String }],
  scheduledAt: { type: Date, required: true, index: true },
  status:     { type: String, enum: ['pending', 'running', 'done', 'failed', 'cancelled'], default: 'pending', index: true },
  sent:       { type: Number, default: 0 },
  failed:     { type: Number, default: 0 },
  error:      { type: String, default: '' },
  startedAt:  { type: Date },
  finishedAt: { type: Date },
  createdAt:  { type: Date, default: Date.now },
});

module.exports = mongoose.model('ScheduledMessage', ScheduledMessageSchema);
