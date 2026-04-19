/**
 * geocode.js — server-side reverse geocoding via the Geocoding API
 * (same key as Places). Used to give scrape jobs a human zone name when
 * the frontend only sent "lat,lng".
 *
 * Cached in-memory by rounded (lat, lng, lang) so repeat lookups in the
 * same area don't re-bill.
 */

const cache = new Map(); // key -> { name, at }
const TTL_MS = 24 * 60 * 60 * 1000;

function cacheKey(lat, lng, lang) {
  return `${lat.toFixed(3)}|${lng.toFixed(3)}|${lang || 'en'}`;
}

function pickName(result) {
  if (!result) return null;
  const comps = result.address_components || [];
  const get = (...types) =>
    comps.find((c) => Array.isArray(c.types) && types.every((t) => c.types.includes(t)));

  const locality   = get('locality') || get('postal_town') || get('administrative_area_level_2');
  const adminArea  = get('administrative_area_level_1');
  const country    = get('country');

  const parts = [];
  if (locality?.long_name)  parts.push(locality.long_name);
  if (adminArea?.long_name && adminArea.long_name !== locality?.long_name) parts.push(adminArea.long_name);
  if (country?.long_name)   parts.push(country.long_name);
  return parts.length ? parts.join(', ') : (result.formatted_address || null);
}

async function reverseGeocode(lat, lng, lang = 'en', { onApiCall } = {}) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = process.env.GOOGLE_PLACES_API_KEY;
  if (!key) return null;

  const ck = cacheKey(lat, lng, lang);
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.name;

  const url =
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?latlng=${lat},${lng}&language=${encodeURIComponent(lang)}&key=${encodeURIComponent(key)}`;

  try {
    const res  = await fetch(url);
    try { onApiCall?.(); } catch (_) {}
    const data = await res.json();
    if (data?.status !== 'OK' || !Array.isArray(data.results) || !data.results.length) {
      return null;
    }
    const name = pickName(data.results[0]);
    if (name) cache.set(ck, { name, at: Date.now() });
    return name;
  } catch (e) {
    console.warn('[geocode]', e.message);
    return null;
  }
}

module.exports = { reverseGeocode };
