/**
 * placesTiles.js — split a circular search zone into a hex tiling of
 * sub-circles whose union covers the original. Used to break past the
 * Places API (New) 60-result hard cap by issuing one query per sub-tile.
 *
 * Layout for a "large" zone (target > 60):
 *
 *           ___
 *          /   \
 *      ___/  C  \___
 *     /   \     /   \
 *    | NW  |---| NE  |
 *     \___/  +  \___/
 *     /   \     /   \
 *    |  W  |---|  E  |
 *     \___/     \___/
 *      ___\  S  /___
 *          \___/
 *
 * 1 center + 6 outer hex tiles. The geometry is intentionally aggressive:
 * smaller overlap and larger center-to-ring spacing to prioritize unique
 * results over dense duplicate coverage.
 */

const EARTH_DEG_PER_M = 1 / 111111;

/**
 * tileCircle — pick a tiling strategy based on how many leads the user wants.
 *
 * @param {number} lat
 * @param {number} lng
 * @param {number} radius   meters (100..50000)
 * @param {number} target   desired number of leads (10..500)
 * @returns {Array<{lat:number,lng:number,radius:number}>}
 */
function tileCircle(lat, lng, radius, target = 60) {
  const r = Math.max(100, Math.min(50000, Number(radius) || 2500));
  const t = Math.max(10, Math.min(500, Number(target) || 60));

  // Small ask -> one tile, the original circle.
  if (t <= 60) return [{ lat, lng, radius: r }];

  // Otherwise hex split into 7 (1 center + 6 ring) with lower overlap.
  // subR is reduced and ring centers are pushed farther out.
  const subR  = Math.max(400, Math.round(r * 0.42));
  const ringR = Math.max(subR * 1.4, r - subR * 0.7);

  const tiles = [{ lat, lng, radius: subR }];
  const cosLat = Math.cos((lat * Math.PI) / 180) || 1e-6;
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3;
    const dLat = (ringR * Math.cos(angle)) * EARTH_DEG_PER_M;
    const dLng = (ringR * Math.sin(angle)) * (EARTH_DEG_PER_M / cosLat);
    tiles.push({ lat: lat + dLat, lng: lng + dLng, radius: subR });
  }
  return tiles;
}

/** Cost estimate (USD) — 1 Places Text Search call (Pro SKU) ~ $0.032. */
function estimateCost(target) {
  const calls = Math.max(1, Math.ceil(Math.min(500, target) / 60)) * 3; // up to 3 pages per call
  return Math.round(calls * 0.032 * 100) / 100;
}

module.exports = { tileCircle, estimateCost };
