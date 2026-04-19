/**
 * Saved extraction preset — a one-click {industry + zone} the user can
 * relaunch later. The Lead schema's data isn't touched.
 */

const mongoose = require('mongoose');

const PresetSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name:       { type: String, required: true, trim: true },
  industry:   { type: String, required: true, trim: true },
  lat:        { type: Number, required: true },
  lng:        { type: Number, required: true },
  radius:     { type: Number, required: true, min: 100, max: 50000 },
  zone:       { type: String },
  maxResults: { type: Number, default: 200, min: 10, max: 500 },
  lastUsedAt: { type: Date },
  createdAt:  { type: Date, default: Date.now },
});

PresetSchema.index({ userId: 1, name: 1 }, { unique: true });

module.exports = mongoose.model('Preset', PresetSchema);
