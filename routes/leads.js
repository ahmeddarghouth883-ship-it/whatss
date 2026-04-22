/**
 * /api/leads — manage extracted leads.
 *
 *   GET    /api/leads?page&limit&zone&category&verified&search   list (paginated)
 *   GET    /api/leads/export?...&token=JWT                        CSV (token query for <a download> compat)
 *   GET    /api/leads/:id                                         single lead
 *   PATCH  /api/leads/:id                                         update tags/notes/whatsappVerified
 *   DELETE /api/leads/:id                                         delete one
 *   POST   /api/leads/bulk-delete  { ids: [...] }                 delete many
 */

const express  = require('express');
const mongoose = require('mongoose');
const jwt      = require('jsonwebtoken');
const ExcelJS  = require('exceljs');
const Lead     = require('../models/Lead');
const { authenticate } = require('../helpers/auth');

const router = express.Router();

// Trim runaway website fetches: enrichment must never block other requests.
const ENRICH_TIMEOUT_MS = 8000;
const ENRICH_MAX_BYTES  = 750 * 1024;
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const SOCIAL_BLOCKLIST = /(?:facebook|fbcdn|wixpress|sentry|wix|godaddy|noreply|example)\.[a-z]{2,3}$/i;

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeRegex(s) {
  return String(s || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildFilter(req) {
  const filter = { userId: req.userId };
  if (req.query.zone)     filter.zone     = String(req.query.zone);
  if (req.query.category) filter.category = String(req.query.category);
  if (req.query.verified === 'true')  filter.whatsappVerified = true;
  if (req.query.verified === 'false') filter.whatsappVerified = { $ne: true };

  const search = String(req.query.search || '').trim();
  if (search) {
    const rx = new RegExp(escapeRegex(search), 'i');
    filter.$or = [
      { name: rx },
      { phone: rx },
      { address: rx },
      { website: rx },
    ];
  }
  return filter;
}

function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function leadsToCsv(rows) {
  const cols = ['name', 'phone', 'email', 'category', 'zone', 'city', 'address', 'website', 'websiteReachable', 'websiteHttpStatus', 'rating', 'reviews', 'whatsappVerified', 'createdAt'];
  const head = cols.join(',');
  const body = rows.map((r) => cols.map((c) => csvEscape(r[c])).join(',')).join('\n');
  return `${head}\n${body}\n`;
}

/**
 * authFlexible — accepts JWT either via Authorization header (default) or
 * via ?token=... query string. Needed for the CSV export which is opened
 * via `window.open(...)` in the frontend (no axios interceptor available).
 */
async function authFlexible(req, res, next) {
  if (req.headers.authorization) return authenticate(req, res, next);
  const token = String(req.query?.token || '');
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.userId;
    req.user = { _id: decoded.userId, role: 'user' };
    next();
  } catch (_) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * Best-effort website -> email scrape. Returns { email | null, source }.
 * No external libs: vanilla fetch + regex over the HTML body (capped).
 */
async function scrapeEmailFromWebsite(url) {
  try {
    const u = new URL(/^https?:/i.test(url) ? url : `https://${url}`);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), ENRICH_TIMEOUT_MS);
    const res = await fetch(u.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'Mozilla/5.0 WhispFlowEnricher/1.0' },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return { email: null, source: u.toString(), status: res.status };

    const reader = res.body?.getReader?.();
    if (!reader) {
      const txt = (await res.text()).slice(0, ENRICH_MAX_BYTES);
      return findEmail(txt, u.toString());
    }
    let bytes = 0;
    const chunks = [];
    while (bytes < ENRICH_MAX_BYTES) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      chunks.push(value);
    }
    const txt = Buffer.concat(chunks.map(Buffer.from)).toString('utf8');
    return findEmail(txt, u.toString());
  } catch (e) {
    return { email: null, source: url, error: e.name === 'AbortError' ? 'timeout' : e.message };
  }
}

function findEmail(html, source) {
  // Prefer mailto: links — they're explicit contact addresses.
  const mailto = html.match(/mailto:([^"'>?\s]+)/i);
  if (mailto && EMAIL_RE.test(mailto[1])) return cleanEmail(mailto[1], source);
  const m = html.match(EMAIL_RE);
  if (m) return cleanEmail(m[0], source);
  return { email: null, source };
}

function cleanEmail(raw, source) {
  const e = String(raw).trim().toLowerCase().replace(/^mailto:/, '').split('?')[0];
  const domain = e.split('@')[1] || '';
  if (SOCIAL_BLOCKLIST.test(domain)) return { email: null, source, skipped: 'social_or_cdn_domain' };
  return { email: e, source };
}

router.post('/:id/enrich', authenticate, async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
    const lead = await Lead.findOne({ _id: req.params.id, userId: req.userId });
    if (!lead) return res.status(404).json({ error: 'Lead not found' });
    if (!lead.website) return res.status(400).json({ error: 'Lead has no website to scrape' });

    const result = await scrapeEmailFromWebsite(lead.website);
    if (result.email) lead.email = result.email;
    lead.enrichedAt = new Date();
    await lead.save();

    return res.json({
      lead,
      enrichment: result,
    });
  } catch (err) {
    console.error('[leads/enrich]', err.message);
    res.status(500).json({ error: err.message });
  }
});

router.get('/export', authFlexible, async (req, res) => {
  try {
    const filter = buildFilter(req);
    const cursor = Lead.find(filter).sort({ createdAt: -1 }).limit(50000).lean();
    const rows   = await cursor;
    const csv    = leadsToCsv(rows);

    const fname = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    return res.send(csv);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const page  = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.max(1, Math.min(500, Number(req.query.limit) || 50));
    const filter = buildFilter(req);

    const [total, leads] = await Promise.all([
      Lead.countDocuments(filter),
      Lead.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ]);

    return res.json({ leads, total, page, limit, pages: Math.ceil(total / limit) });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/** Dashboard: total leads + WhatsApp-verified count (must be registered before /:id). */
router.get('/stats', authenticate, async (req, res) => {
  try {
    const userId = req.userId;
    const [total, verified] = await Promise.all([
      Lead.countDocuments({ userId }),
      Lead.countDocuments({ userId, whatsappVerified: true }),
    ]);
    return res.json({ total, verified });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const lead = await Lead.findOne({ _id: req.params.id, userId: req.userId }).lean();
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  return res.json({ lead });
});

router.patch('/:id', authenticate, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const allowed = ['name', 'tags', 'notes', 'whatsappVerified', 'optedOut'];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  if (patch.whatsappVerified) patch.whatsappCheckedAt = new Date();
  if (Object.keys(patch).length === 0) return res.status(400).json({ error: 'No valid fields to update' });

  const lead = await Lead.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    patch,
    { new: true }
  ).lean();
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  return res.json({ lead });
});

router.delete('/:id', authenticate, async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const r = await Lead.deleteOne({ _id: req.params.id, userId: req.userId });
  if (r.deletedCount === 0) return res.status(404).json({ error: 'Lead not found' });
  return res.json({ ok: true, deleted: r.deletedCount });
});

router.post('/bulk-delete', authenticate, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => mongoose.isValidObjectId(id)) : [];
  if (ids.length === 0) return res.status(400).json({ error: 'ids array is required' });
  const r = await Lead.deleteMany({ _id: { $in: ids }, userId: req.userId });
  return res.json({ ok: true, deleted: r.deletedCount });
});

const EXPORT_EXCEL_MAX = 5000;

router.post('/export-excel', authenticate, async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter((id) => mongoose.isValidObjectId(id)) : [];
    if (ids.length === 0) return res.status(400).json({ error: 'ids array is required' });
    if (ids.length > EXPORT_EXCEL_MAX) return res.status(400).json({ error: `Too many leads selected (max ${EXPORT_EXCEL_MAX})` });

    const rows = await Lead.find({ _id: { $in: ids }, userId: req.userId }).lean();
    const byId = new Map(rows.map((row) => [String(row._id), row]));
    const orderedRows = ids.map((id) => byId.get(String(id))).filter(Boolean);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Whispflow';
    const sheet = workbook.addWorksheet('Leads', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Phone', key: 'phone', width: 18 },
      { header: 'Phone formatted', key: 'phoneFormatted', width: 18 },
      { header: 'Email', key: 'email', width: 28 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Zone', key: 'zone', width: 16 },
      { header: 'City', key: 'city', width: 18 },
      { header: 'Address', key: 'address', width: 36 },
      { header: 'Website', key: 'website', width: 32 },
      { header: 'Website OK', key: 'websiteReachable', width: 12 },
      { header: 'Website HTTP', key: 'websiteHttpStatus', width: 12 },
      { header: 'Website checked', key: 'websiteCheckedAt', width: 20 },
      { header: 'Rating', key: 'rating', width: 10 },
      { header: 'Reviews', key: 'reviews', width: 10 },
      { header: 'WhatsApp verified', key: 'whatsappVerified', width: 18 },
      { header: 'WA checked at', key: 'whatsappCheckedAt', width: 20 },
      { header: 'Tags', key: 'tags', width: 24 },
      { header: 'Notes', key: 'notes', width: 36 },
      { header: 'Opted out', key: 'optedOut', width: 10 },
      { header: 'Last contacted', key: 'lastContacted', width: 20 },
      { header: 'Created', key: 'createdAt', width: 20 },
    ];
    sheet.getRow(1).font = { bold: true };

    for (const r of orderedRows) {
      sheet.addRow({
        name: r.name || '',
        phone: r.phone || '',
        phoneFormatted: r.phoneFormatted || '',
        email: r.email || '',
        category: r.category || '',
        zone: r.zone || '',
        city: r.city || '',
        address: r.address || '',
        website: r.website || '',
        websiteReachable:
          r.website && typeof r.websiteReachable === 'boolean'
            ? r.websiteReachable
              ? 'Yes'
              : 'No'
            : '',
        websiteHttpStatus: r.websiteHttpStatus != null ? r.websiteHttpStatus : '',
        websiteCheckedAt: r.websiteCheckedAt ? new Date(r.websiteCheckedAt) : '',
        rating: r.rating ?? '',
        reviews: r.reviews ?? '',
        whatsappVerified: r.whatsappVerified ? 'Yes' : 'No',
        whatsappCheckedAt: r.whatsappCheckedAt ? new Date(r.whatsappCheckedAt) : '',
        tags: Array.isArray(r.tags) ? r.tags.join(', ') : '',
        notes: r.notes || '',
        optedOut: r.optedOut ? 'Yes' : 'No',
        lastContacted: r.lastContacted ? new Date(r.lastContacted) : '',
        createdAt: r.createdAt ? new Date(r.createdAt) : '',
      });
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const fname = `leads-export-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    return res.send(Buffer.from(buffer));
  } catch (err) {
    console.error('[leads/export-excel]', err.message);
    return res.status(500).json({ error: err.message || 'Export failed' });
  }
});

module.exports = router;
