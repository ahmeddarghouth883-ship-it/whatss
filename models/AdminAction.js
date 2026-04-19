const mongoose = require('mongoose');

const AdminActionSchema = new mongoose.Schema({
  adminId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action: {
    type: String,
    enum: [
      'order_approved',
      'order_rejected',
      'credits_topup',
      'credits_deduct',
      'user_suspended',
      'user_activated',
      'plan_changed',
      'role_changed',
    ],
    required: true,
  },
  targetUserId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  targetOrderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  before:        { type: mongoose.Schema.Types.Mixed, default: null },
  after:         { type: mongoose.Schema.Types.Mixed, default: null },
  reason:        { type: String, default: '' },
  createdAt:     { type: Date, default: Date.now },
});

AdminActionSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AdminAction', AdminActionSchema);
