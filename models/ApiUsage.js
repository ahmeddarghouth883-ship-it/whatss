/**
 * Daily Places API call counter, one document per (user, day).
 * Aggregated for the cost meter shown in the header + admin dashboard.
 */

const mongoose = require('mongoose');

const ApiUsageSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  day:       { type: String, required: true }, // YYYY-MM-DD UTC
  service:   { type: String, default: 'places' }, // places | geocoding | maps_js
  calls:     { type: Number, default: 0 },
  costUsd:   { type: Number, default: 0 },
  updatedAt: { type: Date, default: Date.now },
});

ApiUsageSchema.index({ userId: 1, day: 1, service: 1 }, { unique: true });

module.exports = mongoose.model('ApiUsage', ApiUsageSchema);
