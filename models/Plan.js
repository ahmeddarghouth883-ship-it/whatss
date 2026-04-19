const mongoose = require('mongoose');

const PlanSchema = new mongoose.Schema({
  code:      { type: String, required: true, unique: true, lowercase: true, trim: true },
  label:     { type: String, required: true },
  blurb:     { type: String, default: '' },
  priceUsd:  { type: Number, default: 0 },
  priceTnd:  { type: Number, default: 0 },
  credits:   { type: Number, default: 0 },
  isCustom:  { type: Boolean, default: false },
  oneTime:   { type: Boolean, default: false },
  features:  { type: [String], default: [] },
  active:    { type: Boolean, default: true },
  sortOrder: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});

PlanSchema.pre('save', function (next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('Plan', PlanSchema);
