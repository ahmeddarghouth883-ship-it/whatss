const mongoose = require('mongoose');

const OrderSchema = new mongoose.Schema({
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  planCode:         { type: String, required: true, lowercase: true },
  planLabel:        { type: String },
  priceTnd:         { type: Number, default: 0 },
  priceUsd:         { type: Number, default: 0 },
  creditsToGrant:   { type: Number, default: 0 },
  status:           { type: String, enum: ['pending', 'approved', 'rejected', 'cancelled'], default: 'pending', index: true },
  paymentMethod:    { type: String, enum: ['bank_transfer', 'd17', 'wise', 'cash', 'manual'], default: 'manual' },
  paymentReference: { type: String, default: '' },
  notes:            { type: String, default: '' },
  reviewedBy:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt:       { type: Date, default: null },
  rejectionReason:  { type: String, default: '' },
  transactionId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
  createdAt:        { type: Date, default: Date.now },
  updatedAt:        { type: Date, default: Date.now },
});

OrderSchema.index({ userId: 1, createdAt: -1 });
OrderSchema.index({ status: 1, createdAt: -1 });

OrderSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Order', OrderSchema);
