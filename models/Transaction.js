const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  userId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  type:        { type: String, enum: ['topup', 'spend', 'refund', 'bonus'], required: true },
  amount:      { type: Number, required: true },
  credits:     { type: Number, default: 0 },
  description: { type: String },
  reference:   { type: String },
  status:      { type: String, enum: ['pending', 'completed', 'failed'], default: 'completed' },
  createdAt:   { type: Date, default: Date.now }
});

TransactionSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
