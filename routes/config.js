/**
 * /api/config — serves runtime config to the frontend.
 * Currently exposes the Google Maps JS API key so the frontend map picker
 * can boot without duplicating the key in a Vite env file.
 *
 * The key is read from process.env (populated from env/logs at boot).
 */

const express = require('express');

const router = express.Router();

router.get('/maps-key', (req, res) => {
  const key = process.env.GOOGLE_PLACES_API_KEY || '';
  if (!key) return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured' });
  res.set('Cache-Control', 'public, max-age=300');
  return res.json({ key });
});

module.exports = router;
