/**
 * usage.js — increment per-user/day Places API call counters used by the
 * UI cost meter. Fire-and-forget: failures must never block scraping.
 *
 *   trackPlacesCall(userId, n)   -> +n calls, +n * $0.032
 *   trackGeocodeCall(userId, n)  -> +n calls, +n * $0.005
 *   getUsageToday(userId)        -> { places, geocoding, totalCalls, totalCostUsd }
 */

const ApiUsage = require('../models/ApiUsage');

const COST = {
  places:    0.032, // Places API (New) Text Search Pro SKU
  geocoding: 0.005, // Geocoding API
  maps_js:   0,     // unmetered for our purposes
};

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

async function track(userId, service, n = 1) {
  if (!userId || !n) return;
  const day = todayUtc();
  const cost = (COST[service] || 0) * n;
  try {
    await ApiUsage.updateOne(
      { userId, day, service },
      { $inc: { calls: n, costUsd: cost }, $set: { updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (e) {
    // If duplicate key from a race, retry once.
    if (e?.code === 11000) {
      try {
        await ApiUsage.updateOne(
          { userId, day, service },
          { $inc: { calls: n, costUsd: cost }, $set: { updatedAt: new Date() } }
        );
      } catch (_) {}
    } else {
      console.warn('[usage] track failed:', e.message);
    }
  }
}

const trackPlacesCall   = (uid, n = 1) => track(uid, 'places', n);
const trackGeocodeCall  = (uid, n = 1) => track(uid, 'geocoding', n);

async function getUsageToday(userId) {
  if (!userId) return emptyUsage();
  const day = todayUtc();
  const rows = await ApiUsage.find({ userId, day }).lean();
  const out = emptyUsage();
  for (const r of rows) {
    if (r.service === 'places')    { out.places.calls += r.calls;    out.places.costUsd += r.costUsd; }
    if (r.service === 'geocoding') { out.geocoding.calls += r.calls; out.geocoding.costUsd += r.costUsd; }
    out.totalCalls   += r.calls;
    out.totalCostUsd += r.costUsd;
  }
  out.totalCostUsd = Math.round(out.totalCostUsd * 100) / 100;
  out.places.costUsd = Math.round(out.places.costUsd * 100) / 100;
  out.geocoding.costUsd = Math.round(out.geocoding.costUsd * 100) / 100;
  return out;
}

function emptyUsage() {
  return {
    day: todayUtc(),
    places:    { calls: 0, costUsd: 0 },
    geocoding: { calls: 0, costUsd: 0 },
    totalCalls: 0,
    totalCostUsd: 0,
  };
}

module.exports = { trackPlacesCall, trackGeocodeCall, getUsageToday, emptyUsage };
