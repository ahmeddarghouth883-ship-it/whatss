/**
 * /api/presets — saved extraction templates.
 *   GET    /api/presets           list user's presets
 *   POST   /api/presets           create one
 *   PUT    /api/presets/:id       update
 *   DELETE /api/presets/:id       delete
 *   POST   /api/presets/:id/use   bump lastUsedAt and return preset
 */

const express  = require('express');
const mongoose = require('mongoose');
const Preset   = require('../models/Preset');
const { authenticate } = require('../helpers/auth');

const router = express.Router();
router.use(authenticate);

router.get('/', async (req, res) => {
  const presets = await Preset.find({ userId: req.userId })
    .sort({ lastUsedAt: -1, createdAt: -1 })
    .lean();
  res.json({ presets });
});

router.post('/', async (req, res) => {
  try {
    const name     = String(req.body?.name || '').trim();
    const industry = String(req.body?.industry || '').trim();
    const lat      = Number(req.body?.lat);
    const lng      = Number(req.body?.lng);
    const radius   = Math.max(100, Math.min(50000, Number(req.body?.radius) || 2500));
    const zone     = String(req.body?.zone || '').trim();
    const maxResults = Math.max(10, Math.min(500, Number(req.body?.maxResults) || 200));

    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!industry) return res.status(400).json({ error: 'industry is required' });
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const preset = await Preset.create({
      userId: req.userId, name, industry, lat, lng, radius, zone, maxResults,
    });
    res.status(201).json({ preset });
  } catch (err) {
    if (err?.code === 11000) return res.status(409).json({ error: 'A preset with this name already exists' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const allowed = ['name', 'industry', 'lat', 'lng', 'radius', 'zone', 'maxResults'];
  const patch = {};
  for (const k of allowed) if (k in req.body) patch[k] = req.body[k];
  const preset = await Preset.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId }, patch, { new: true }
  );
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json({ preset });
});

router.delete('/:id', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const r = await Preset.deleteOne({ _id: req.params.id, userId: req.userId });
  if (r.deletedCount === 0) return res.status(404).json({ error: 'Preset not found' });
  res.json({ ok: true });
});

router.post('/:id/use', async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid id' });
  const preset = await Preset.findOneAndUpdate(
    { _id: req.params.id, userId: req.userId },
    { lastUsedAt: new Date() },
    { new: true }
  );
  if (!preset) return res.status(404).json({ error: 'Preset not found' });
  res.json({ preset });
});

module.exports = router;
