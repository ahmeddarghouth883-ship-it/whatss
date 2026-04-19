/**
 * envLoader.js — populate process.env from the project's non-standard
 * `env/logs` file plus any standard `.env` file (via dotenv, if installed).
 *
 * `env/logs` format example:
 *   Google Place API=AIzaSy...
 *   MONGODB_URI=mongodb://127.0.0.1:27017/whispflow
 * mongodb+srv://ahmeddarghouthditasli_db_user:7BbNw0n29p7OAyvI@cluster0.t78gscb.mongodb.net/?appName=Cluster0
 *
 * Keys are mapped to canonical env var names:
 *   - Any key containing "google place" -> GOOGLE_PLACES_API_KEY
 *   - Otherwise the key is uppercased, whitespace -> "_".
 *
 * Existing values in process.env are never overwritten.
 */

const fs   = require('fs');
const path = require('path');

function canonicalKey(raw) {
  const trimmed = String(raw || '').trim();
  if (/google\s*place/i.test(trimmed)) return 'GOOGLE_PLACES_API_KEY';
  if (/google/i.test(trimmed) && /client/i.test(trimmed) && /id/i.test(trimmed)) {
    return 'GOOGLE_CLIENT_ID';
  }
  return trimmed.replace(/\s+/g, '_').toUpperCase();
}

/** If GOOGLE_CLIENT_ID is unset, reuse VITE_GOOGLE_CLIENT_ID from frontend/.env.local (same OAuth client). */
function tryLoadGoogleClientIdFromVite() {
  if (process.env.GOOGLE_CLIENT_ID) return;
  try {
    const p = path.join(__dirname, '..', 'frontend', '.env.local');
    if (!fs.existsSync(p)) return;
    const contents = fs.readFileSync(p, 'utf8');
    for (const line of contents.split(/\r?\n/)) {
      const m = line.match(/^\s*VITE_GOOGLE_CLIENT_ID\s*=\s*(.+?)\s*$/);
      if (m) {
        process.env.GOOGLE_CLIENT_ID = m[1].trim().replace(/^['"]|['"]$/g, '');
        console.log('[envLoader] GOOGLE_CLIENT_ID loaded from frontend/.env.local');
        return;
      }
    }
  } catch (_) { /* ignore */ }
}

function loadLogsFile() {
  const p = path.join(__dirname, '..', 'env', 'logs');
  if (!fs.existsSync(p)) return { loaded: 0, file: p, missing: true };

  let loaded = 0;
  const contents = fs.readFileSync(p, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const l = line.trim();
    if (!l || l.startsWith('#')) continue;
    const m = l.match(/^([^=]+?)\s*=\s*(.+?)\s*$/);
    if (!m) continue;
    const key = canonicalKey(m[1]);
    const val = m[2].replace(/^['"]|['"]$/g, '');
    if (!key) continue;
    if (process.env[key] == null || process.env[key] === '') {
      process.env[key] = val;
      loaded++;
    }
  }
  return { loaded, file: p, missing: false };
}

function loadDotenv() {
  try {
    // Optional dependency — only loads .env if dotenv is installed.
    require('dotenv').config();
    return true;
  } catch (_) {
    return false;
  }
}

function loadEnvLogs() {
  loadDotenv();
  const info = loadLogsFile();
  if (info.missing) {
    console.warn(`[envLoader] ${info.file} not found — GOOGLE_PLACES_API_KEY may be unset.`);
  } else if (info.loaded > 0) {
    console.log(`[envLoader] loaded ${info.loaded} entr${info.loaded === 1 ? 'y' : 'ies'} from env/logs`);
  }
  tryLoadGoogleClientIdFromVite();
  return info;
}

module.exports = { loadEnvLogs, canonicalKey, tryLoadGoogleClientIdFromVite };
