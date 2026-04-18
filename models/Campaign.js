const mongoose = require('mongoose');

const CampaignSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:        { type: String, required: true },
  message:     { type: String, required: true },
  mediaUrl:    { type: String },
  mediaType:   { type: String, enum: ['image', 'document', 'video', null] },
  zone:        { type: String },
  category:    { type: String },
  leadIds:     [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lead' }],
  sessionId:   { type: String },
  status:      { type: String, enum: ['draft', 'running', 'paused', 'done', 'failed'], default: 'draft' },
  scheduledAt: { type: Date },
  startedAt:   { type: Date },
  completedAt: { type: Date },
  stats: {
    total:     { type: Number, default: 0 },
    sent:      { type: Number, default: 0 },
    delivered: { type: Number, default: 0 },
    read:      { type: Number, default: 0 },
    replied:   { type: Number, default: 0 },
    failed:    { type: Number, default: 0 },
    optedOut:  { type: Number, default: 0 }
  },
  rateLimit:   { type: Number, default: 20 }, // messages per minute
  createdAt:   { type: Date, default: Date.now }
});

module.exports = mongoose.model('Campaign', CampaignSchema);
