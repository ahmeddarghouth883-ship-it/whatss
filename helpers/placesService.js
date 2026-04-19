/**
 * placesService.js — Google Places API (New) Text Search wrapper.
 *
 * Replaces the Playwright-based Google Maps scraper. Uses
 * POST https://places.googleapis.com/v1/places:searchText with a circular
 * `locationRestriction` and paginates up to 3 pages (60 results, API hard cap).
 *
 * Requires: GOOGLE_PLACES_API_KEY in process.env.
 */

const PLACES_URL = 'https://places.googleapis.com/v1/places:searchText';

const FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.addressComponents',
  'places.internationalPhoneNumber',
  'places.nationalPhoneNumber',
  'places.websiteUri',
  'places.rating',
  'places.userRatingCount',
  'places.location',
  'places.primaryType',
  'places.primaryTypeDisplayName',
  'nextPageToken',
].join(',');

const PAGE_SIZE      = 20;   // API max per page
const MAX_PAGES      = 3;    // 3 x 20 = 60 results cap
const NEXT_PAGE_WAIT = 2000; // Google-recommended delay before using nextPageToken

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizePhone(raw) {
  if (!raw) return null;
  let cleaned = String(raw).replace(/[^\d+]/g, '');
  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
  return cleaned.length >= 7 ? cleaned : null;
}

function phoneKey(phone) {
  if (!phone) return null;
  const key = String(phone).replace(/\D/g, '');
  return key.length >= 7 ? key : null;
}

function pickLocality(addressComponents = []) {
  const prefs = [
    ['locality'],
    ['postal_town'],
    ['administrative_area_level_2'],
    ['administrative_area_level_1'],
  ];
  for (const want of prefs) {
    const hit = addressComponents.find((c) =>
      Array.isArray(c.types) && want.every((t) => c.types.includes(t))
    );
    if (hit) return hit.longText || hit.shortText || null;
  }
  return null;
}

function pickCountry(addressComponents = []) {
  const hit = addressComponents.find(
    (c) => Array.isArray(c.types) && c.types.includes('country')
  );
  return hit ? (hit.longText || hit.shortText || null) : null;
}

function normalizePlace(place, { category, zone, scrapeJobId }) {
  const phone = normalizePhone(
    place.internationalPhoneNumber || place.nationalPhoneNumber || null
  );
  const name =
    (place.displayName && (place.displayName.text || place.displayName)) ||
    null;

  const city   = pickLocality(place.addressComponents);
  const country = pickCountry(place.addressComponents);

  return {
    name:    name || null,
    phone:   phone || null,
    phoneRaw: place.internationalPhoneNumber || place.nationalPhoneNumber || null,
    address: place.formattedAddress || null,
    website: place.websiteUri || null,
    rating:  typeof place.rating === 'number' ? place.rating : null,
    reviews: typeof place.userRatingCount === 'number' ? place.userRatingCount : null,
    lat:     place.location?.latitude ?? null,
    lng:     place.location?.longitude ?? null,
    city:    city || null,
    country: country || null,
    zone:    zone || city || country || null,
    category: category || place.primaryType || null,
    placeId: place.id || null,
    scrapeJobId: scrapeJobId || null,
  };
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * searchPlaces — paginate up to 60 results for a given industry + circle.
 *
 * @param {Object} opts
 * @param {string} opts.industry       Free-text query (e.g. "pharmacies")
 * @param {number} opts.lat            Center latitude
 * @param {number} opts.lng            Center longitude
 * @param {number} opts.radius         Radius in meters (max 50000)
 * @param {AbortSignal} [opts.signal]
 * @param {(n:number)=>void} [opts.onProgress] Called with cumulative count after each page
 * @param {string} [opts.languageCode] ISO language code (optional)
 * @param {string} [opts.regionCode]   ISO region (optional, biases results)
 * @param {string} [opts.apiKey]       Override for process.env.GOOGLE_PLACES_API_KEY
 * @returns {Promise<Array>} Raw place objects (not yet normalized to lead shape)
 */
async function searchPlaces({
  industry,
  lat,
  lng,
  radius,
  signal,
  onProgress,
  languageCode,
  regionCode,
  apiKey,
  onApiCall, // optional: called once per Places HTTP request, after it succeeds
}) {
  const key = apiKey || process.env.GOOGLE_PLACES_API_KEY;
  if (!key) throw new Error('GOOGLE_PLACES_API_KEY is not set');
  if (typeof lat !== 'number' || typeof lng !== 'number') {
    throw new Error('lat/lng must be numbers');
  }
  const clampedRadius = Math.max(100, Math.min(50000, Number(radius) || 2500));

  // NOTE: Places API (New) only supports `rectangle` under `locationRestriction`.
  // A circle (center + radius) must be sent as `locationBias` instead.
  const baseBody = {
    textQuery: String(industry || '').trim(),
    pageSize: PAGE_SIZE,
    locationBias: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: clampedRadius,
      },
    },
  };
  if (languageCode) baseBody.languageCode = languageCode;
  if (regionCode)   baseBody.regionCode   = regionCode;

  const places = [];
  let pageToken = null;

  for (let page = 0; page < MAX_PAGES; page++) {
    if (signal?.aborted) break;

    const body = pageToken ? { ...baseBody, pageToken } : baseBody;
    let res;
    try {
      res = await fetch(PLACES_URL, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': key,
          'X-Goog-FieldMask': FIELD_MASK,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (err?.name === 'AbortError' || signal?.aborted) break;
      throw err;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`places_${res.status}: ${text.slice(0, 400)}`);
      err.status = res.status;
      throw err;
    }

    const data = await res.json().catch(() => ({}));
    const batch = Array.isArray(data.places) ? data.places : [];
    for (const p of batch) places.push(p);

    try { onApiCall?.(); } catch (_) {}
    try { onProgress?.(places.length); } catch (_) {}

    pageToken = data.nextPageToken || null;
    if (!pageToken) break;

    // Google recommends a short delay before using the next page token.
    await new Promise((r) => setTimeout(r, NEXT_PAGE_WAIT));
  }

  return places;
}

/**
 * searchLeads — high-level helper used by the scrape worker.
 * Returns phone-deduplicated, normalized leads ready for Mongo insert.
 */
async function searchLeads({
  industry,
  lat,
  lng,
  radius,
  signal,
  onProgress,
  onApiCall,
  languageCode,
  regionCode,
  zone,
  scrapeJobId,
  requirePhone = true,
}) {
  const raw = await searchPlaces({
    industry, lat, lng, radius, signal, onProgress, onApiCall, languageCode, regionCode,
  });

  const seenPhone = new Set();
  const seenPlace = new Set();
  const leads = [];

  for (const p of raw) {
    const lead = normalizePlace(p, {
      category: industry,
      zone,
      scrapeJobId,
    });
    if (requirePhone && !lead.phone) continue;

    const pk = phoneKey(lead.phone);
    if (pk) {
      if (seenPhone.has(pk)) continue;
      seenPhone.add(pk);
    } else if (lead.placeId) {
      if (seenPlace.has(lead.placeId)) continue;
      seenPlace.add(lead.placeId);
    }
    leads.push(lead);
  }

  return { leads, raw, totalFound: raw.length };
}

module.exports = {
  searchPlaces,
  searchLeads,
  normalizePlace,
  normalizePhone,
  phoneKey,
};
