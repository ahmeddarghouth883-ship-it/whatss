const mongoose = require('mongoose');

const WASessionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sessionId: { type: String, required: true, unique: true },
  phone:     { type: String },
  name:      { type: String },
  status:    { type: String, enum: ['connecting','qr','ready','disconnected','banned'], default: 'connecting' },
  qrCode:    { type: String },
  sentToday: { type: Number, default: 0 },
  sentTotal: { type: Number, default: 0 },
  dailyLimit:{ type: Number, default: 300 },
  isActive:  { type: Boolean, default: true },
  lastSeen:  { type: Date },
  createdAt: { type: Date, default: Date.now }
});

WASessionSchema.index({ userId: 1 });

module.exports = mongoose.model('WASession', WASessionSchema);
