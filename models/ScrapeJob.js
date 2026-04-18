const mongoose = require('mongoose');

const ScrapePlanTimelineEntrySchema = new mongoose.Schema({
  event: { type: String, required: true },
  at: { type: Date, default: Date.now },
  planIndex: { type: Number },
  attempt: { type: Number },
  zone: { type: String },
  category: { type: String },
  planCount: { type: Number },
  planMaxResults: { type: Number },
  added: { type: Number },
  totalFound: { type: Number },
  durationMs: { type: Number },
  leadsPerMin: { type: Number },
  yield: { type: Number },
  queueDelayMs: { type: Number },
  speedMode: { type: String },
  retryBackoffMs: { type: Number },
  errorCode: { type: String },
  errorMessage: { type: String },
  reason: { type: String }
}, { _id: false });

const ScrapeJobSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  jobId:     { type: String, required: true, unique: true },
  zone:      { type: String, required: true },
  category:  { type: String, required: true },
  speedMode: { type: String, enum: ['fast', 'balanced', 'deep'], default: 'fast' },
  maxResults:{ type: Number, default: 200 },
  target:    { type: Number, default: 200 },
  status:    { type: String, enum: ['pending','running','done','failed','cancel_requested','cancelled'], default: 'pending' },
  found:     { type: Number, default: 0 },
  saved:     { type: Number, default: 0 },
  dupes:     { type: Number, default: 0 },
  plansAttempted: { type: Number, default: 0 },
  retriesUsed: { type: Number, default: 0 },
  failedPlans: { type: Number, default: 0 },
  timedOutPlans: { type: Number, default: 0 },
  queueDelayMs: { type: Number, default: 0 },
  processingMs: { type: Number, default: 0 },
  stopReason:{ type: String, default: '' },
  errorCode: { type: String, default: '' },
  sourceBreakdown: {
    type: Map,
    of: Number,
    default: {}
  },
  planTimeline: {
    type: [ScrapePlanTimelineEntrySchema],
    default: []
  },
  error:     { type: String },
  startedAt: { type: Date },
  doneAt:    { type: Date },
  queuedAt:  { type: Date },
  createdAt: { type: Date, default: Date.now }
});

ScrapeJobSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model('ScrapeJob', ScrapeJobSchema);
