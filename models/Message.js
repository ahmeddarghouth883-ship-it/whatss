const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign' },
  leadId:     { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  sessionId:  { type: String, required: true },
  phone:      { type: String, required: true },
  message:    { type: String, required: true },
  mediaUrl:   { type: String },
  status:     { type: String, enum: ['queued','sent','delivered','read','replied','failed','opted_out'], default: 'queued' },
  waMessageId:{ type: String },
  sentAt:     { type: Date },
  deliveredAt:{ type: Date },
  readAt:     { type: Date },
  repliedAt:  { type: Date },
  failReason: { type: String },
  createdAt:  { type: Date, default: Date.now }
});

MessageSchema.index({ userId: 1, campaignId: 1 });
MessageSchema.index({ userId: 1, phone: 1 });
MessageSchema.index({ waMessageId: 1 });

module.exports = mongoose.model('Message', MessageSchema);
