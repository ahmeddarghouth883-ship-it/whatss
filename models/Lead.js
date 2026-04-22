const mongoose = require('mongoose');

const LeadSchema = new mongoose.Schema({
  userId:           { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:             { type: String, trim: true },
  phone:            { type: String, required: true },
  phoneFormatted:   { type: String },
  category:         { type: String },
  address:          { type: String },
  city:             { type: String },
  zone:             { type: String },
  rating:           { type: Number },
  reviews:          { type: Number },
  website:          { type: String },
  /** Set during extraction: HTTP probe succeeded (server responded). */
  websiteReachable: { type: Boolean },
  websiteHttpStatus:{ type: Number },
  websiteCheckedAt: { type: Date },
  email:            { type: String, lowercase: true, trim: true },
  enrichedAt:       { type: Date },
  whatsappVerified: { type: Boolean, default: false },
  whatsappCheckedAt:{ type: Date },
  tags:             [{ type: String }],
  notes:            { type: String },
  scrapeJobId:      { type: String },
  optedOut:         { type: Boolean, default: false },
  lastContacted:    { type: Date },
  createdAt:        { type: Date, default: Date.now }
});

// One phone per user
LeadSchema.index({ userId: 1, phone: 1 }, { unique: true });
LeadSchema.index({ userId: 1, zone: 1 });
LeadSchema.index({ userId: 1, category: 1 });
LeadSchema.index({ userId: 1, whatsappVerified: 1 });

module.exports = mongoose.model('Lead', LeadSchema);
