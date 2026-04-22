/**
 * /api/scrape — Google Places (New) scrape flow.
 *
 *   POST /api/scrape/zone         { industry, lat, lng, radius, zone? }  -> starts a job
 *   GET  /api/scrape/jobs                                                -> list user jobs
 *   GET  /api/scrape/jobs/:id?includeTimeline=1&timelineLimit=60        -> detail + timeline
 *   POST /api/scrape/jobs/:id/cancel                                     -> abort a running job
 *   GET  /api/scrape/zones                                               -> distinct zones
 *   GET  /api/scrape/categories                                          -> distinct categories
 *
 * Progress is emitted to the user's socket room (`user:<userId>`) with the
 * same event names the existing frontend already listens for.
 */

const crypto  = require('crypto');
const express = require('express');
const { authenticate } = require('../helpers/auth');
const ScrapeJob = require('../models/ScrapeJob');
const Lead      = require('../models/Lead');
const { searchLeads, phoneKey, normalizePhone } = require('../helpers/placesService');
const { tileCircle, estimateCost } = require('../helpers/placesTiles');
const { reverseGeocode } = require('../helpers/geocode');
const { trackPlacesCall, trackGeocodeCall } = require('../helpers/usage');
const { expandIndustry } = require('../helpers/subcategories');
const { attachWebsiteAvailability } = require('../helpers/websiteAvailability');
const wallet = require('../helpers/wallet');
const { scrapeLimiter } = require('../helpers/rateLimit');

const HARD_TARGET_CAP = 500;
const CREDITS_PER_LEAD = wallet.CREDIT_COSTS.extraction;

const router = express.Router();

// Per-process registry of running jobs so we can cancel them.
const runningJobs = new Map();  // jobId -> { controller, userId }

function newJobId() {
  return `job_${Date.now().toString(36)}_${crypto.randomBytes(4).toString('hex')}`;
}

function emitUser(io, userId, event, payload) {
  if (!io) return;
  try {
    io.to(`user:${String(userId)}`).emit(event, payload);
  } catch (e) {
    console.warn('[scrape] emit failed:', e.message);
  }
}

function stableHash(input) {
  let h = 2166136261;
  const s = String(input || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

function buildTileQueryPlan(queries, tileCount, seed) {
  const list = Array.from(new Set((queries || []).filter(Boolean)));
  if (list.length === 0 || tileCount <= 0) return [];

  // Deterministic rotation so jobs spread query priorities predictably.
  const offset = stableHash(seed) % list.length;
  const rotated = list.slice(offset).concat(list.slice(0, offset));
  const chunkSize = Math.max(1, Math.ceil(rotated.length / tileCount));

  return Array.from({ length: tileCount }, (_, idx) => {
    const start = idx * chunkSize;
    const end = start + chunkSize;
    const chunk = rotated.slice(start, end);
    if (chunk.length > 0) return chunk;
    // More tiles than queries -> cycle so each tile still runs something.
    return [rotated[idx % rotated.length]];
  });
}

async function pushTimeline(jobId, entry) {
  try {
    await ScrapeJob.updateOne(
      { jobId },
      { $push: { planTimeline: { at: new Date(), ...entry } } }
    );
  } catch (e) {
    console.warn('[scrape] timeline push failed:', e.message);
  }
}

// ── Worker ───────────────────────────────────────────────────────────────────

async function runScrapeJob({ io, job }) {
  const controller = new AbortController();
  runningJobs.set(job.jobId, { controller, userId: String(job.userId) });

  const userId = String(job.userId);
  const start  = Date.now();

  try {
    await ScrapeJob.updateOne(
      { jobId: job.jobId },
      { $set: { status: 'running', startedAt: new Date() } }
    );
    emitUser(io, userId, 'scrape:started', {
      jobId: job.jobId, zone: job.zone, category: job.category,
    });
    const target = Math.max(10, Math.min(HARD_TARGET_CAP, Number(job.maxResults) || 60));
    const tiles  = tileCircle(job.lat, job.lng, job.radius, target);

    // Sub-categories: if the user picked a broad industry like "restaurants",
    // we'll loop a small list inside each tile to break the 60-cap further.
    const queries = expandIndustry(job.category);
    const tileQueryPlan = buildTileQueryPlan(queries, tiles.length, job.jobId);

    await pushTimeline(job.jobId, {
      event: 'job_started',
      zone: job.zone,
      category: job.category,
      planCount: tiles.length,
      planMaxResults: target,
      queryCount: queries.length,
    });

    // ── Tile loop (1..7 sub-circles) × sub-category loop ───────────────────
    const seenPhones  = new Set();
    const collected   = [];
    let totalFound    = 0;

    outer:
    for (let i = 0; i < tiles.length; i++) {
      if (controller.signal.aborted) break;
      if (collected.length >= target) break;

      const tile = tiles[i];
      const tileStart = Date.now();
      const plannedQueries = tileQueryPlan[i] || queries;
      const queriesRun = new Set();
      let tileRawCount = 0;
      let tileWithPhoneCount = 0;
      let tileDedupedCount = 0;
      let tileAddedFromShard = 0;
      let tileAddedFromFallback = 0;
      let fallbackUsed = false;

      await pushTimeline(job.jobId, {
        event: 'plan_started',
        planIndex: i + 1,
        planCount: tiles.length,
        zone: job.zone,
        category: job.category,
        queryCount: plannedQueries.length,
      });

      let added = 0;
      for (const q of plannedQueries) {
        if (controller.signal.aborted) break outer;
        if (collected.length >= target) break;
        try {
          const { leads: tileLeads, totalFound: tileTotal, raw } = await searchLeads({
            industry:     q,
            lat:          tile.lat,
            lng:          tile.lng,
            radius:       tile.radius,
            zone:         job.zone,
            scrapeJobId:  job.jobId,
            signal:       controller.signal,
            regionCode:   job.regionCode || undefined,
            languageCode: job.languageCode || undefined,
            requirePhone: true,
            onApiCall:    () => trackPlacesCall(job.userId, 1),
          });
          queriesRun.add(q);
          totalFound += tileTotal;
          tileRawCount += tileTotal;
          tileWithPhoneCount += (Array.isArray(raw)
            ? raw.reduce((n, p) => n + (normalizePhone(p?.internationalPhoneNumber || p?.nationalPhoneNumber) ? 1 : 0), 0)
            : 0);
          tileDedupedCount += tileLeads.length;

          for (const lead of tileLeads) {
            const k = phoneKey(lead.phone);
            if (!k || seenPhones.has(k)) continue;
            seenPhones.add(k);
            collected.push(lead);
            added++;
            tileAddedFromShard++;
            if (collected.length >= target) break;
          }
        } catch (tErr) {
          if (controller.signal.aborted) break outer;
          await pushTimeline(job.jobId, {
            event: 'plan_failed',
            planIndex: i + 1,
            errorMessage: String(tErr?.message || '').slice(0, 300),
          });
          // continue to next sub-category / tile
        }
      }

      // Fallback pass: if sharded queries underperform badly, run missing queries.
      const minExpectedPerTile = Math.max(2, Math.round(target / Math.max(tiles.length, 1) * 0.25));
      if (!controller.signal.aborted && collected.length < target && tileAddedFromShard < minExpectedPerTile) {
        const fallbackQueries = queries.filter((q) => !queriesRun.has(q));
        for (const q of fallbackQueries) {
          if (controller.signal.aborted) break outer;
          if (collected.length >= target) break;
          try {
            const { leads: tileLeads, totalFound: tileTotal, raw } = await searchLeads({
              industry:     q,
              lat:          tile.lat,
              lng:          tile.lng,
              radius:       tile.radius,
              zone:         job.zone,
              scrapeJobId:  job.jobId,
              signal:       controller.signal,
              regionCode:   job.regionCode || undefined,
              languageCode: job.languageCode || undefined,
              requirePhone: true,
              onApiCall:    () => trackPlacesCall(job.userId, 1),
            });
            fallbackUsed = true;
            queriesRun.add(q);
            totalFound += tileTotal;
            tileRawCount += tileTotal;
            tileWithPhoneCount += (Array.isArray(raw)
              ? raw.reduce((n, p) => n + (normalizePhone(p?.internationalPhoneNumber || p?.nationalPhoneNumber) ? 1 : 0), 0)
              : 0);
            tileDedupedCount += tileLeads.length;

            for (const lead of tileLeads) {
              const k = phoneKey(lead.phone);
              if (!k || seenPhones.has(k)) continue;
              seenPhones.add(k);
              collected.push(lead);
              added++;
              tileAddedFromFallback++;
              if (collected.length >= target) break;
            }
          } catch (tErr) {
            if (controller.signal.aborted) break outer;
            await pushTimeline(job.jobId, {
              event: 'plan_failed',
              planIndex: i + 1,
              errorMessage: String(tErr?.message || '').slice(0, 300),
            });
          }
        }
      }

      emitUser(io, userId, 'scrape:found', { jobId: job.jobId, count: collected.length });
      ScrapeJob.updateOne({ jobId: job.jobId }, { $set: { found: collected.length } }).catch(() => {});

      await pushTimeline(job.jobId, {
        event: 'plan_completed',
        planIndex: i + 1,
        planCount: tiles.length,
        added,
        rawCount: tileRawCount,
        withPhoneCount: tileWithPhoneCount,
        dedupedCount: tileDedupedCount,
        uniqueRate: tileRawCount > 0 ? Number((added / tileRawCount).toFixed(4)) : 0,
        shardAdded: tileAddedFromShard,
        fallbackAdded: tileAddedFromFallback,
        fallbackUsed,
        queryCount: queriesRun.size,
        totalFound: collected.length,
        durationMs: Date.now() - tileStart,
      });
    }

    if (controller.signal.aborted) {
      await ScrapeJob.updateOne(
        { jobId: job.jobId },
        { $set: { status: 'cancelled', doneAt: new Date(), stopReason: 'user_cancelled', found: collected.length } }
      );
      emitUser(io, userId, 'scrape:cancelled', { jobId: job.jobId, total: collected.length });
      await pushTimeline(job.jobId, { event: 'job_cancelled', reason: 'user_cancelled' });
      return;
    }

    const leads = await attachWebsiteAvailability(collected, { signal: controller.signal });
    emitUser(io, userId, 'scrape:saving', { jobId: job.jobId, total: leads.length });
    await ScrapeJob.updateOne(
      { jobId: job.jobId },
      { $set: { found: collected.length, target: leads.length } }
    );

    // ── Dedup + insert + per-lead credit charge ─────────────────────────────
    let saved      = 0;
    let dupes      = 0;
    let charged    = 0;
    let outOfCredits = false;

    for (const lead of leads) {
      let leadDoc;
      try {
        const leadPayload = {
          userId:      job.userId,
          name:        lead.name || 'Unknown',
          phone:       lead.phone,
          category:    lead.category || job.category,
          address:     lead.address,
          city:        lead.city,
          zone:        lead.zone || job.zone,
          rating:      lead.rating,
          reviews:     lead.reviews,
          website:     lead.website,
          scrapeJobId: job.jobId,
        };
        if (lead.website && lead.websiteCheckedAt != null) {
          leadPayload.websiteReachable = lead.websiteReachable;
          if (lead.websiteHttpStatus != null) leadPayload.websiteHttpStatus = lead.websiteHttpStatus;
          leadPayload.websiteCheckedAt = lead.websiteCheckedAt;
        }
        leadDoc = await Lead.create(leadPayload);
      } catch (err) {
        if (err?.code === 11000) { dupes++; continue; }
        console.warn('[scrape] lead insert error:', err.message);
        continue;
      }

      // Charge 1 credit per inserted lead — idempotent on lead._id.
      try {
        await wallet.charge({
          userId:      job.userId,
          cost:        CREDITS_PER_LEAD,
          source:      'extraction',
          reference:   `lead:${leadDoc._id}`,
          metadata:    { scrapeJobId: job.jobId, leadId: leadDoc._id, zone: job.zone, category: job.category },
          description: `Lead extracted in ${job.zone}`,
        });
        charged++;
      } catch (err) {
        if (err?.code === 'INSUFFICIENT_CREDITS') {
          // Roll back the lead we just inserted (we can't charge for it).
          await Lead.deleteOne({ _id: leadDoc._id }).catch(() => {});
          outOfCredits = true;
          await pushTimeline(job.jobId, {
            event: 'job_stopped_no_credits',
            errorMessage: 'INSUFFICIENT_CREDITS',
            added: saved,
          });
          break;
        }
        console.warn('[scrape] charge error:', err.message);
      }

      saved++;
      emitUser(io, userId, 'scrape:progress', {
        jobId: job.jobId, saved, total: leads.length,
      });
    }

    if (outOfCredits) {
      await ScrapeJob.updateOne(
        { jobId: job.jobId },
        {
          $set: {
            status:        'cancelled',
            stopReason:    'out_of_credits',
            saved, dupes,
            found:         collected.length,
            target:        leads.length,
            doneAt:        new Date(),
            processingMs:  Date.now() - start,
          },
        }
      );
      emitUser(io, userId, 'scrape:cancelled', {
        jobId: job.jobId, reason: 'out_of_credits', saved,
      });
      return;
    }

    const durationMs = Date.now() - start;
    await ScrapeJob.updateOne(
      { jobId: job.jobId },
      {
        $set: {
          status: 'done',
          saved, dupes,
          found: collected.length,
          target: leads.length,
          plansAttempted: tiles.length,
          doneAt: new Date(),
          processingMs: durationMs,
        },
      }
    );
    emitUser(io, userId, 'scrape:done', {
      jobId: job.jobId, saved, dupes, total: leads.length,
    });
    await pushTimeline(job.jobId, {
      event: 'job_finished', reason: 'done', added: saved, durationMs,
    });
  } catch (err) {
    const aborted = controller.signal.aborted || /aborted/i.test(String(err?.message));
    if (aborted) {
      await ScrapeJob.updateOne(
        { jobId: job.jobId },
        { $set: { status: 'cancelled', doneAt: new Date(), stopReason: 'user_cancelled' } }
      );
      emitUser(io, userId, 'scrape:cancelled', { jobId: job.jobId });
      await pushTimeline(job.jobId, { event: 'job_cancelled', reason: 'user_cancelled' });
      return;
    }

    console.error('[scrape] job failed:', err);
    const message = String(err?.message || 'Unknown error').slice(0, 400);
    await ScrapeJob.updateOne(
      { jobId: job.jobId },
      { $set: { status: 'failed', error: message, errorCode: err.status ? `HTTP_${err.status}` : 'SCRAPE_FAILURE', doneAt: new Date() } }
    );
    emitUser(io, userId, 'scrape:error', { jobId: job.jobId, message });
    await pushTimeline(job.jobId, { event: 'job_failed', errorMessage: message });
  } finally {
    runningJobs.delete(job.jobId);
  }
}

// ── Routes ──────────────────────────────────────────────────────────────────

router.post('/zone', authenticate, scrapeLimiter, async (req, res) => {
  try {
    const industry   = String(req.body?.industry || req.body?.category || '').trim();
    const lat        = Number(req.body?.lat);
    const lng        = Number(req.body?.lng);
    const radius     = Math.max(100, Math.min(50000, Number(req.body?.radius) || 2500));
    const maxResults = Math.max(10, Math.min(HARD_TARGET_CAP, Number(req.body?.maxResults) || 60));
    let   zone       = String(req.body?.zone || '').trim();

    if (!industry) return res.status(400).json({ error: 'industry is required' });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng are required numbers' });
    }
    if (!process.env.GOOGLE_PLACES_API_KEY) {
      return res.status(500).json({ error: 'Server missing GOOGLE_PLACES_API_KEY' });
    }

    // Preflight credit check — block if user can't afford even half of the target.
    // We only require enough for ~25% of the target up front; mid-job we stop
    // gracefully if credits run out so already-saved leads stay charged.
    const minCreditsNeeded = Math.max(CREDITS_PER_LEAD, Math.floor(maxResults * 0.25));
    try {
      await wallet.ensureCredits(req.userId, minCreditsNeeded);
    } catch (err) {
      if (err?.code === 'INSUFFICIENT_CREDITS') {
        return res.status(402).json({
          error:  'INSUFFICIENT_CREDITS',
          needed: minCreditsNeeded,
          have:   err.have,
          message: `You need at least ${minCreditsNeeded} credits to start an extraction (1 credit per lead). Top up your wallet to continue.`,
        });
      }
      throw err;
    }

    // Auto-name if the client only sent "lat,lng" or nothing.
    const looksRaw = !zone || /^\s*-?\d+\.\d+,\s*-?\d+\.\d+\s*$/.test(zone);
    if (looksRaw) {
      const named = await reverseGeocode(lat, lng, 'en', {
        onApiCall: () => trackGeocodeCall(req.userId, 1),
      });
      if (named) zone = named;
    }
    if (!zone) zone = `${lat.toFixed(3)},${lng.toFixed(3)}`;

    const jobId = newJobId();
    const job = await ScrapeJob.create({
      userId:    req.userId,
      jobId,
      zone,
      category:  industry,
      lat, lng, radius,
      speedMode: 'fast',
      maxResults,
      target:    maxResults,
      status:    'pending',
      queuedAt:  new Date(),
    });

    const io = req.app.get('io');
    // Fire-and-forget; the client learns status via sockets + polling.
    setImmediate(() => runScrapeJob({ io, job }).catch((e) => {
      console.error('[scrape] unhandled worker error:', e);
    }));

    return res.status(202).json({
      jobId, zone, category: industry, target: maxResults,
      tiles: tileCircle(lat, lng, radius, maxResults).length,
      subCategories: expandIndustry(industry),
      estimatedCostUsd: estimateCost(maxResults),
    });
  } catch (err) {
    console.error('[scrape/zone]', err);
    return res.status(500).json({ error: err.message || 'Failed to start scrape' });
  }
});

/**
 * GET /api/scrape/preview — duplicate-detection.
 *   ?industry=&lat=&lng=&radius=
 * Returns how many leads we already have for the same category in/near
 * this zone, so the UI can warn before wasting API budget.
 */
router.get('/preview', authenticate, async (req, res) => {
  try {
    const industry = String(req.query.industry || req.query.category || '').trim();
    const lat      = Number(req.query.lat);
    const lng      = Number(req.query.lng);
    const radius   = Math.max(100, Math.min(50000, Number(req.query.radius) || 2500));

    if (!industry || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'industry, lat and lng are required' });
    }

    const named = await reverseGeocode(lat, lng, 'en', {
      onApiCall: () => trackGeocodeCall(req.userId, 1),
    });

    // Two heuristics: same category in same named zone, OR same category
    // in any zone the user already extracted recently (last 30 days).
    const [byZone, totalCategory] = await Promise.all([
      named ? Lead.countDocuments({ userId: req.userId, category: industry, zone: named }) : Promise.resolve(0),
      Lead.countDocuments({ userId: req.userId, category: industry }),
    ]);

    return res.json({
      zone: named || `${lat.toFixed(3)},${lng.toFixed(3)}`,
      industry,
      radius,
      existingInZone: byZone,
      existingInCategory: totalCategory,
      subCategories: expandIndustry(industry),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/jobs', authenticate, async (req, res) => {
  try {
    const jobs = await ScrapeJob.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('-planTimeline')
      .lean();
    return res.json({ jobs });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/jobs/:id', authenticate, async (req, res) => {
  try {
    const includeTimeline = ['1', 'true', 'yes'].includes(String(req.query.includeTimeline || '').toLowerCase());
    const timelineLimit   = Math.max(1, Math.min(500, Number(req.query.timelineLimit) || 60));

    const job = await ScrapeJob.findOne({ userId: req.userId, jobId: req.params.id }).lean();
    if (!job) return res.status(404).json({ error: 'Job not found' });

    let timelineMeta = { included: false, totalEvents: 0, returnedEvents: 0 };
    if (includeTimeline) {
      const total = Array.isArray(job.planTimeline) ? job.planTimeline.length : 0;
      const returned = Math.min(total, timelineLimit);
      job.planTimeline = (job.planTimeline || []).slice(-timelineLimit);
      timelineMeta = { included: true, totalEvents: total, returnedEvents: returned };
    } else {
      delete job.planTimeline;
    }

    return res.json({ job, timeline: timelineMeta });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.post('/jobs/:id/cancel', authenticate, async (req, res) => {
  try {
    const job = await ScrapeJob.findOne({ userId: req.userId, jobId: req.params.id });
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (['done', 'failed', 'cancelled'].includes(job.status)) {
      return res.json({ ok: true, status: job.status });
    }

    await ScrapeJob.updateOne({ _id: job._id }, { $set: { status: 'cancel_requested' } });

    const entry = runningJobs.get(job.jobId);
    if (entry?.controller) entry.controller.abort();

    return res.json({ ok: true, status: 'cancel_requested' });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/zones', authenticate, async (req, res) => {
  try {
    const zones = await Lead.distinct('zone', { userId: req.userId });
    return res.json({ zones: zones.filter(Boolean).sort() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/categories', authenticate, async (req, res) => {
  try {
    const categories = await Lead.distinct('category', { userId: req.userId });
    return res.json({ categories: categories.filter(Boolean).sort() });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
