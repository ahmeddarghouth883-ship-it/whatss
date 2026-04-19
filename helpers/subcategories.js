/**
 * subcategories.js — break a broad industry into 4-8 narrower queries.
 *
 * Why: each Places API Text Search caps at 60 results. Querying
 * "restaurants" once gives you the 60 most prominent ones in the area.
 * Querying ["italian restaurants", "fast food", "cafes", "bakeries"]
 * separately can yield 200+ unique businesses in the same zone.
 *
 * If the user enters a custom industry that we don't recognise, we just
 * return [industry] (no subdivision).
 */

const SUBCATS = {
  restaurants: [
    'restaurants', 'italian restaurants', 'fast food', 'pizza', 'cafes',
    'bakeries', 'seafood restaurants', 'middle eastern restaurants',
  ],
  hotels: ['hotels', 'guest houses', 'hostels', 'bed and breakfast', 'resorts'],
  shops:  ['shops', 'clothing stores', 'electronics stores', 'supermarkets'],
  beauty: ['hair salons', 'beauty salons', 'spa', 'barber shops', 'nail salons'],
  fitness:['gyms', 'crossfit', 'yoga studios', 'martial arts', 'pilates'],
  health: ['clinics', 'pharmacies', 'dentists', 'doctors', 'medical labs', 'physiotherapy'],
  auto:   ['car dealers', 'auto repair', 'tire shops', 'car wash', 'gas stations'],
  pro:    ['lawyers', 'accountants', 'architects', 'real estate agents', 'consultants'],
};

const ALIASES = {
  food: 'restaurants', dining: 'restaurants', eateries: 'restaurants',
  hospitality: 'hotels', accommodation: 'hotels', lodging: 'hotels',
  store: 'shops', retail: 'shops',
  salons: 'beauty', barber: 'beauty',
  gym: 'fitness', sport: 'fitness',
  medical: 'health', dental: 'health', pharmacy: 'health', clinic: 'health',
  car: 'auto', cars: 'auto',
  legal: 'pro', accounting: 'pro',
};

function expandIndustry(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (!raw) return [];

  // Direct hit
  if (SUBCATS[raw]) return SUBCATS[raw].slice();

  // Alias hit
  if (ALIASES[raw] && SUBCATS[ALIASES[raw]]) return SUBCATS[ALIASES[raw]].slice();

  // Match by substring (e.g. "all restaurants in Tunis" -> restaurants)
  for (const [k, list] of Object.entries(SUBCATS)) {
    if (raw.includes(k)) return list.slice();
  }
  return [raw];
}

module.exports = { expandIndustry };
