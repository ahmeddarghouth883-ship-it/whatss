# WhispFlow — Google Places lead finder

Backend (Express + Socket.IO + MongoDB) and React/Vite frontend for extracting
business contacts from the **Google Places API (New)** by picking a zone on a
map. Each scrape returns up to **60 leads** (the API hard cap: 3 pages × 20).

## 1. API key setup

Create or edit `env/logs` at the repo root:

```
Google Place API=YOUR_GOOGLE_API_KEY_HERE
```

If you want to use a separate browser key for the map picker, you can also set:

```
Google Maps API=YOUR_GOOGLE_MAPS_API_KEY_HERE
```

In the [Google Cloud Console](https://console.cloud.google.com/) enable
**both** of these APIs on the key's project:

- **Places API (New)** — server-side business data (uses Pro SKU for phone
  fields `internationalPhoneNumber` / `nationalPhoneNumber`).
- **Maps JavaScript API** — browser-side map picker + Places Autocomplete.

You can also set `MONGODB_URI` and `JWT_SECRET` either in the same `env/logs`
file or in a standard `.env` (both are loaded at boot).

If **MongoDB is already running** on your machine (e.g. local service or Docker), point the app at it so data persists and the in-memory fallback is not used:

```
MONGODB_URI=mongodb://127.0.0.1:27017/whispflow
```

Unset `USE_MEMORY_DB` or set `USE_MEMORY_DB=0` when using a real database.

## 2. Install

```bash
npm install            # backend deps (express, socket.io, mongoose, …)
cd frontend && npm install && cd ..
```

## 3. Run

Two terminals:

```bash
# terminal 1 — backend on :5000
npm start

# terminal 2 — frontend on :5173 (proxies /api + /socket.io to :5000)
cd frontend && npm run dev
```

Open `http://localhost:5173`, register an account, go to **Scrape**:

1. Type the industry (e.g. `pharmacies`, `car dealers`).
2. Use the search box or click on the map to drop the zone center.
3. Drag the marker, drag the circle, or use the radius slider (500 m – 10 km).
4. Click **Start scrape** — up to 60 phone-verified leads land in your database.

## 4. Architecture

```
frontend/src/pages/ScrapePage.jsx       ─┐
frontend/src/components/PlacesMapPicker  ├─ Maps JS + circle + slider
frontend/src/hooks/useGoogleMaps.js      ─┘       ▲
                                                  │ GET /api/config/maps-key
                                                  │
server.js                                         │ POST /api/scrape/zone
 ├── routes/auth.js     (register / login / me)   │      { industry, lat, lng, radius }
 ├── routes/config.js   (maps-key)                ▼
 ├── routes/scrape.js   (zone / jobs / cancel)  helpers/placesService.js
 ├── helpers/envLoader  (env/logs -> process.env)    └─ Places API (New) searchText × 3 pages
 ├── helpers/database   (MongoDB / in-memory fallback)
 └── Socket.IO          (scrape:started|found|saving|progress|done|error|cancelled)
```

## 5. What this change touched / did NOT touch

**Replaced:** `helpers/scraper.js` (Playwright Google Maps scraper) was deleted
and fully replaced by `helpers/placesService.js` which calls the official
Google Places API (New) Text Search.

**Preserved unchanged:** `helpers/whatsappManager.js` (QR scan / WhatsApp
session logic) and `helpers/email.js` (SMTP verification emails). No changes
were made to the messaging pipeline.

**Out of scope:** other frontend pages (Campaigns, Inbox, Leads detail,
Wallet, Sessions) hit backend routes that aren't mounted in `server.js` yet
and will return 404 until their routes are added.

## 6. Power features

| Feature | Where it lives |
|---|---|
| **Skip-duplicates pre-check** | `GET /api/scrape/preview` — debounced from ScrapePage; warns if you already have leads in this zone/category |
| **Auto-named jobs** | Server-side reverse-geocode in [routes/scrape.js](routes/scrape.js) — turns `36.806,10.181` into `Tunis, Tunisia` |
| **Sub-category fan-out** | [helpers/subcategories.js](helpers/subcategories.js) — broad terms like `restaurants` query 8 narrower terms per tile (italian/pizza/cafes/...) for higher yield |
| **Saved presets** | [models/Preset.js](models/Preset.js) + [routes/presets.js](routes/presets.js) — chip row at the top of Extract; click to reload |
| **Tags & notes** | Inline editor on [LeadsPage](frontend/src/pages/LeadsPage.jsx) (✎ icon per row) |
| **Email enrichment** | `POST /api/leads/:id/enrich` fetches website (8s timeout, 750KB cap) and extracts mailto/regex; saves to `lead.email` |
| **WhatsApp validation** | `POST /api/whatsapp/verify-numbers` uses an active wa-web.js session to flag `lead.whatsappVerified`. Requires a connected session. |
| **Heatmap layer** | Toggle on the Extract map shows where past extractions ran (uses `ScrapeJob.lat/lng/saved`) |
| **API usage meter** | `GET /api/me/usage` — tracked per call in [helpers/usage.js](helpers/usage.js), shown in the header bar |
| **CSV export with email** | `GET /api/leads/export?token=...` — accepts JWT in query so `<a download>` works |

## 7. Login / auth

### Test admin (development)

On startup, the server seeds an **admin** account when `NODE_ENV` is not `production`
(unless `SEED_ADMIN=0`). Default credentials:

| Field | Value |
|-------|--------|
| **Email** | `admin@whispflow.local` |
| **Password** | `Admin123456!` |

Override with `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `ADMIN_NAME` in `.env` or `env/logs`.
In production, set `SEED_ADMIN=0` unless you intentionally set `SEED_ADMIN=1`.

**Wipe MongoDB and start over (one admin, plans re-seeded):** from the repo root run `npm run reset-db`. That drops the current database, then creates only the seeded admin (other admin accounts are demoted on each seed unless `ALLOW_MULTIPLE_ADMINS=1`). Alternatively, set `RESET_DB_ON_START=1` for one server boot to drop the DB before seeding (ignored in production unless `ALLOW_RESET_DB_IN_PRODUCTION=1`).

- **Email + password:** `POST /api/auth/login` — backend trims/lowercases email.
- **Google:** `POST /api/auth/google` — set `GOOGLE_CLIENT_ID` in `.env` / `env/logs`
  (`Google Client ID=...`) or rely on `frontend/.env.local` (`VITE_GOOGLE_CLIENT_ID`),
  which the server copies to `GOOGLE_CLIENT_ID` at boot.
- **Register:** if the API returns `token` + `user`, the app logs you in immediately
  (no fake “verification code” step unless the server omits the token).
- **Forgot password:** stub only — SMTP is not wired; use a new account or Google.
- **MongoDB:** if you did not set `MONGODB_URI`, the dev server uses an **in-memory**
  database — **all users are lost when you restart `node server.js`**. Set
  `MONGODB_URI=mongodb://127.0.0.1:27017/whispflow` (or Atlas) to keep accounts.
