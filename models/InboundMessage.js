const mongoose = require('mongoose');

const InboundMessageSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  sessionId:   { type: String, required: true },
  fromPhone:   { type: String, required: true, index: true },
  contactName: { type: String, default: '' },
  body:        { type: String, default: '' },
  mediaUrl:    { type: String, default: null },
  mediaType:   { type: String, default: null }, // image | video | document | audio | null
  waMessageId: { type: String, default: null, index: true },
  receivedAt:  { type: Date, default: Date.now, index: true },
  read:        { type: Boolean, default: false, index: true },
  readAt:      { type: Date, default: null },
  repliedTo:   { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
});

InboundMessageSchema.index({ userId: 1, fromPhone: 1, receivedAt: -1 });
InboundMessageSchema.index({ userId: 1, read: 1 });
// Avoid duplicate inserts if WhatsApp redelivers
InboundMessageSchema.index({ userId: 1, waMessageId: 1 }, { unique: true, sparse: true });

module.exports = mongoose.model('InboundMessage', InboundMessageSchema);
