const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:        { type: String, enum: ['topup', 'spend', 'refund', 'bonus', 'order'], required: true },
  source:      { type: String, enum: ['extraction', 'message', 'order', 'admin', 'signup_bonus', 'refund', 'system'], default: 'system' },
  amount:      { type: Number, default: 0 },     // money amount (TND/USD), 0 for in-app credit moves
  credits:     { type: Number, default: 0 },     // signed: positive = topup, negative = spend
  balanceAfter:{ type: Number, default: null },  // wallet snapshot right after this txn
  description: { type: String, default: '' },
  reference:   { type: String, default: undefined, index: { unique: true, sparse: true } },
  metadata:    { type: mongoose.Schema.Types.Mixed, default: null },
  status:      { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
  createdAt:   { type: Date, default: Date.now },
});

TransactionSchema.index({ userId: 1, createdAt: -1 });
TransactionSchema.index({ userId: 1, source: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
