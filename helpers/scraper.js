/**
 * scraper.js — Google Maps lead scraper (Playwright)
 * Fixes vs previous version:
 *  - Leads no longer discarded when name extraction is slow (common in fast mode)
 *  - Name extracted from URL as reliable fallback (always available)
 *  - Feed scroll works on Arabic/RTL Google Maps (added Arabic aria-label variants)
 *  - Settle time raised so JS-rendered elements (h1, address) actually appear
 *  - Per-job browser isolation (unchanged from last version)
 */

const { chromium } = require('playwright');

// ── Phone utilities ────────────────────────────────────────────────────────────

function normalizePhone(raw) {
  if (!raw) return null;
  const noLabel = raw.replace(/^(phone|call|tel|mobile|mob|fax)\s*:?\s*/i, '').trim();
  let cleaned = noLabel.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('00')) cleaned = `+${cleaned.slice(2)}`;
  return cleaned.length >= 7 ? cleaned : null;
}

function phoneKey(phone) {
  if (!phone) return null;
  const key = phone.replace(/\D/g, '');
  return key.length >= 7 ? key : null;
}

// Extract a human-readable name from a Google Maps place URL as a reliable fallback.
// e.g. "https://.../maps/place/1910+Bistrot+Lafayette/data=..." → "1910 Bistrot Lafayette"
function nameFromUrl(href) {
  try {
    const m = String(href || '').match(/\/maps\/place\/([^/]+)/);
    if (!m) return null;
    return decodeURIComponent(m[1]).replace(/\+/g, ' ').trim() || null;
  } catch {
    return null;
  }
}

// ── Stealth init script ────────────────────────────────────────────────────────

const STEALTH_SCRIPT = () => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  window.chrome = {
    runtime: { connect: () => {}, sendMessage: () => {}, onMessage: { addListener: () => {} } },
    loadTimes: () => {}, csi: () => {}, app: {},
  };
  const fakePlugins = [
    { name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format' },
    { name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
    { name: 'Native Client', filename: 'internal-nacl-plugin', description: '' },
  ];
  fakePlugins.refresh = () => {};
  Object.defineProperty(navigator, 'plugins', { get: () => fakePlugins });
  Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
  Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
  Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
  Object.defineProperty(screen, 'colorDepth', { get: () => 24 });
  const origQuery = window.navigator.permissions.query;
  window.navigator.permissions.query = (p) =>
    p.name === 'notifications'
      ? Promise.resolve({ state: Notification.permission })
      : origQuery(p);
  delete window.__nightmare;
  delete window._phantom;
  delete window.callPhantom;
};

// ── Browser launch ─────────────────────────────────────────────────────────────

async function launchBrowser() {
  try {
    return await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
        '--disable-gpu', '--disable-blink-features=AutomationControlled',
        '--disable-extensions', '--no-first-run', '--no-default-browser-check',
        '--disable-background-networking', '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding', '--disable-ipc-flooding-protection',
        '--password-store=basic', '--use-mock-keychain',
        '--disable-features=TranslateUI,BlinkGenPropertyTrees',
        '--lang=en-US,en',
      ],
    });
  } catch (err) {
    const hint = 'Playwright could not launch Chromium. Run: npx playwright install chromium';
    console.error('[scraper]', hint, err.message);
    throw new Error(`${hint} (${err.message})`);
  }
}

async function makeContext(browser) {
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    viewport: { width: 1366, height: 768 },
    screen: { width: 1920, height: 1080 },
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    },
  });
  await context.addInitScript(STEALTH_SCRIPT);
  await context.route('**/*.{woff,woff2,ttf,eot,gif,mp4,webm,ogg,png,jpg,jpeg,webp,ico}', (r) => r.abort());
  return context;
}

// ── Accept consent dialogs ─────────────────────────────────────────────────────

const CONSENT_SELECTORS = [
  'button[aria-label="Accept all"]', 'button[jsname="b3VHJd"]',
  'form[action*="consent"] button[type="submit"]',
  'button:has-text("Accept all")', 'button:has-text("I agree")',
  'button:has-text("Agree")', 'button:has-text("Accepter")',
  'button:has-text("Tout accepter")', 'button:has-text("Continuer")',
  'button:has-text("Accepter tout")', 'button:has-text("J\'accepte")',
  'button:has-text("قبول الكل")', 'button:has-text("أوافق")',
  'button:has-text("موافق")', '#introAgreeButton',
  '#L2AGLb',
];

async function acceptConsent(page, options = {}) {
  const visibilityTimeoutMs = Number(options.visibilityTimeoutMs || 600);
  const settleAfterClickMs = Number(options.settleAfterClickMs ?? 800);
  for (const sel of CONSENT_SELECTORS) {
    try {
      const btn = page.locator(sel).first();
      if (await btn.isVisible({ timeout: visibilityTimeoutMs })) {
        await btn.click({ timeout: 1500 }).catch(() => {});
        if (settleAfterClickMs > 0) {
          await page.waitForTimeout(settleAfterClickMs);
        }
        return true;
      }
    } catch { /* try next */ }
  }
  return false;
}

// ── Phase 1: Collect place URLs ────────────────────────────────────────────────
//
// Feed selectors now include Arabic aria-label variants since Google Maps
// renders labels in the user's locale.  Class-based selectors (.m6QErb) are
// locale-independent and act as the primary fallback.

const FEED_SELECTORS = [
  'div[role="feed"]',
  // English
  'div[aria-label*="Results for"]',
  'div[aria-label*="Search results"]',
  'div[aria-label*="results"]',
  // Arabic (Tunisia / North Africa Google Maps locale)
  'div[aria-label*="نتائج"]',
  'div[aria-label*="البحث"]',
  // French (also common in Tunisia)
  'div[aria-label*="Résultats"]',
  'div[aria-label*="résultats"]',
  // Class-based (locale-independent, works across all languages)
  '.m6QErb.DxyBCb',
  '.m6QErb[aria-label]',
  '.m6QErb',
  'div.section-scrollbox',
];

const END_SELECTORS = [
  'span:has-text("end of list")', 'span:has-text("reached the end")',
  'span:has-text("No more results")', 'div:has-text("end of list")',
  // Arabic end-of-list markers
  'span:has-text("نهاية القائمة")', 'span:has-text("لا مزيد من النتائج")',
  '.HlvSq',
];

async function findFeed(page) {
  for (const sel of FEED_SELECTORS) {
    try {
      const el = page.locator(sel).first();
      if (await el.count().then((n) => n > 0).catch(() => false)) {
        // Verify it's actually scrollable (has height > 0)
        const h = await el.evaluate((e) => e.scrollHeight).catch(() => 0);
        if (h > 100) return el;
      }
    } catch { /* try next */ }
  }
  return null;
}

async function scrollFeed(page, feed) {
  // Strategy 1: scroll the feed container
  if (feed) {
    await feed.evaluate((el) => {
      const delta = Math.max(1400, Math.floor(el.clientHeight * 1.8));
      el.scrollBy(0, delta);
      el.scrollTop = el.scrollHeight;
    }).catch(() => {});
  }
  // Strategy 2: keyboard (acts on the focused element in the page)
  await page.keyboard.press('PageDown').catch(() => {});
  await page.keyboard.press('End').catch(() => {});
  // Strategy 3: mouse wheel
  await page.mouse.wheel(0, 1400).catch(() => {});
  // Strategy 4: JS body scroll
  await page.evaluate(() => {
    window.scrollBy(0, 1200);
    document.documentElement.scrollTop += 1200;
  }).catch(() => {});
}

function normHref(href) {
  if (!href || !href.includes('/maps/place/')) return null;
  return href.split('?')[0];
}

async function collectPlaceUrls(page, searchUrl, maxUrls, tuning = {}) {
  const initialWaitMs = Number(tuning.initialWaitMs || 1000);
  const postWaitMs    = Number(tuning.postWaitMs    || 400);
  const scrollWaitMs  = Number(tuning.scrollWaitMs  || 280);
  const maxStalled    = Number(tuning.maxStalled    || 14);
  const maxLoops      = Number(tuning.maxLoops      || 0) || Math.max(30, Math.ceil(maxUrls / 14));
  const budget        = Number(tuning.phase1BudgetMs || 0);
  const deadline      = budget > 0 ? Date.now() + budget : 0;

  await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(initialWaitMs);
  await acceptConsent(page, { visibilityTimeoutMs: 650, settleAfterClickMs: 650 });
  await page.waitForSelector('a[href*="/maps/place/"]', { timeout: 18000 }).catch(() => {});
  await page.waitForTimeout(postWaitMs);

  const feed = await findFeed(page);
  if (feed) {
    // Click a neutral point on the feed to give it keyboard focus,
    // but avoid clicking a result link (would navigate away).
    await feed.evaluate((el) => el.focus?.()).catch(() => {});
    await page.mouse.click(350, 400).catch(() => {});
  }

  const seen = new Set();
  let stalled = 0;
  let loops = 0;

  while (
    seen.size < maxUrls &&
    stalled < maxStalled &&
    loops < maxLoops &&
    (deadline === 0 || Date.now() < deadline)
  ) {
    loops++;
    const prev = seen.size;

    const hrefs = await page
      .locator('a[href*="/maps/place/"], a[href*="maps/place/"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('href') || e.href || null))
      .catch(() => []);
    for (const href of hrefs) {
      const norm = normHref(href);
      if (norm) seen.add(norm);
      if (seen.size >= maxUrls) break;
    }

    stalled = seen.size === prev ? stalled + 1 : 0;

    for (const sel of END_SELECTORS) {
      const visible = await page.locator(sel).first().isVisible({ timeout: 200 }).catch(() => false);
      if (visible) { console.log('[scraper] End of results'); return [...seen]; }
    }

    await scrollFeed(page, feed);
    await page.waitForTimeout(scrollWaitMs);
  }

  if (deadline > 0 && Date.now() >= deadline) {
    console.log(`[scraper] Phase 1 budget hit (${seen.size}/${maxUrls})`);
  }
  console.log(`[scraper] Collected ${seen.size} place URLs (loops=${loops} stalled=${stalled})`);
  return [...seen];
}

// ── Phase 2: Extract data from a single place page ─────────────────────────────

const PHONE_ITEM_SELS = [
  '[data-item-id^="phone:tel:"]',
  '[data-item-id^="phone"]',
  'button[data-tooltip*="phone" i]',
  'button[aria-label*="Phone" i]',
  'button[aria-label*="phone" i]',
  '[data-section-id="phone"]',
];
const TEL_LINK_SELS   = ['a[href^="tel:"]'];
const ADDRESS_SELS    = [
  '[data-item-id="address"]', 'button[data-item-id="address"]',
  '[aria-label*="Address" i]:not(h1)', 'button[data-tooltip*="address" i]',
  '.rogA2c .Io6YTe', 'div.rogA2c',
];
const WEBSITE_SELS    = [
  'a[data-item-id^="authority"]',
  'a[aria-label*="website" i]', 'a[aria-label*="Website" i]',
  'a[data-tooltip*="website" i]',
];
const RATING_SELS     = [
  '[aria-label*=" stars"]', '[aria-label*=" star"]',
  'span.ceNzKf[aria-label]', 'div.F7nice span[aria-label]',
  'span[aria-label*="rating" i]',
];
const REVIEW_SELS     = [
  '[aria-label*="review" i]', 'button[jsaction*="review"]', 'span.UY7F9',
];
const NAME_SELS       = [
  'h1.DUwDvf', 'h1', '[data-attrid="title"]', '.SPZz6b span',
];

async function extractPlaceData(page, href, tuning = {}) {
  // Settle time raised: h1 and other elements on Maps place pages are JS-rendered.
  // 300ms (old fast default) is too short — they often haven't painted yet.
  const settleMs    = Number(tuning.settleMs    || 650);
  const phoneRaceMs = Number(tuning.phoneRaceMs || 1700);

  await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 22000 });
  await page.waitForTimeout(settleMs);
  await acceptConsent(page, { visibilityTimeoutMs: 120, settleAfterClickMs: 0 });

  const phoneWaitSel = [...TEL_LINK_SELS, ...PHONE_ITEM_SELS.slice(0, 2)].join(', ');
  await Promise.race([
    page.waitForSelector(phoneWaitSel, { timeout: phoneRaceMs }),
    page.waitForTimeout(phoneRaceMs),
  ]).catch(() => {});

  // ── Phone (4-tier cascade) ──────────────────────────────────────────────────

  let phone = null;

  // Tier 1: tel: href links
  const telHrefs = await page
    .locator(TEL_LINK_SELS.join(', '))
    .evaluateAll((els) => els.map((e) => e.getAttribute('href')))
    .catch(() => []);
  for (const h of telHrefs) {
    if (h) { phone = normalizePhone(h.replace('tel:', '')); if (phone) break; }
  }

  // Tier 2: data-item-id / aria-label elements
  if (!phone) {
    for (const sel of PHONE_ITEM_SELS) {
      try {
        const items = await page.locator(sel).evaluateAll((els) =>
          els.map((e) => ({
            id:   e.getAttribute('data-item-id') || '',
            text: e.innerText || e.textContent || '',
            aria: e.getAttribute('aria-label') || '',
          }))
        ).catch(() => []);
        for (const item of items) {
          if (item.id.startsWith('phone:tel:')) phone = normalizePhone(item.id.replace('phone:tel:', ''));
          if (!phone && item.aria) phone = normalizePhone(item.aria.replace(/^Phone:\s*/i, ''));
          if (!phone && item.text) phone = normalizePhone(item.text);
          if (phone) break;
        }
      } catch { /* try next */ }
      if (phone) break;
    }
  }

  // Tier 3: body text regex
  if (!phone) {
    const body = await page.evaluate(() => document.body.innerText).catch(() => '');
    const matches = body.match(/(\+?[\d][\d\s()./-]{5,}[\d])/g) || [];
    for (const m of matches) {
      const p = normalizePhone(m);
      if (p && p.replace(/\D/g, '').length >= 8) { phone = p; break; }
    }
  }

  if (!phone) return null;

  // ── Name ────────────────────────────────────────────────────────────────────
  // Try DOM selectors first, then fall back to the URL which always contains
  // the place name (e.g. /maps/place/1910+Bistrot+Lafayette/...).
  // This prevents valid leads from being discarded just because the h1
  // hasn't rendered yet under tight time budgets.

  let name = null;
  for (const sel of NAME_SELS) {
    try {
      const txt = await page.locator(sel).first().textContent({ timeout: 1500 });
      if (txt?.trim()) { name = txt.trim(); break; }
    } catch { /* try next */ }
  }
  if (!name) name = nameFromUrl(href);  // reliable fallback — always present

  // ── Address ─────────────────────────────────────────────────────────────────
  let address = null;
  for (const sel of ADDRESS_SELS) {
    try {
      const txt = await page.locator(sel).first().textContent({ timeout: 1000 });
      if (txt?.trim()) { address = txt.trim(); break; }
    } catch { /* */ }
  }

  // ── Website ─────────────────────────────────────────────────────────────────
  let website = null;
  for (const sel of WEBSITE_SELS) {
    try {
      const w = await page.locator(sel).first().getAttribute('href', { timeout: 1000 });
      if (w) { website = w; break; }
    } catch { /* */ }
  }

  // ── Rating ──────────────────────────────────────────────────────────────────
  let rating = null;
  for (const sel of RATING_SELS) {
    try {
      const label = await page.locator(sel).first().getAttribute('aria-label', { timeout: 800 });
      if (label) { const m = label.match(/[\d.]+/); if (m) { rating = parseFloat(m[0]); break; } }
    } catch { /* */ }
  }

  // ── Reviews ─────────────────────────────────────────────────────────────────
  let reviews = null;
  for (const sel of REVIEW_SELS) {
    try {
      const label = await page.locator(sel).first().getAttribute('aria-label', { timeout: 800 });
      if (label) { const m = label.match(/[\d,]+/); if (m) { reviews = parseInt(m[0].replace(',', ''), 10); break; } }
    } catch { /* */ }
  }

  return {
    phone,
    name:    name    || null,
    address: address || null,
    website: website || null,
    rating:  rating  != null && !isNaN(rating)  ? rating  : null,
    reviews: reviews != null && !isNaN(reviews) ? reviews : null,
  };
}

// ── Parallel worker pool ───────────────────────────────────────────────────────

async function processBatch(context, hrefs, seenPhoneKeys, zone, category, onProgress, currentCount, parallelOverride, signal, tuning = {}, maxNewResults = Number.POSITIVE_INFINITY) {
  const PARALLEL      = Math.max(2, Math.min(10, Number(parallelOverride || process.env.SCRAPE_PAGE_PARALLEL || 6)));
  const perUrlTimeout = Math.max(4000, Number(tuning.perUrlTimeoutMs || process.env.SCRAPE_PER_URL_TIMEOUT_MS || 9000));
  const targetCount   = Number.isFinite(maxNewResults) ? Math.max(1, Math.floor(maxNewResults)) : Number.POSITIVE_INFINITY;
  const results       = [];
  const stats         = { processed: 0, errors: 0, timeouts: 0 };

  async function processOne(page, href) {
    if (signal?.aborted) return null;
    let onAbort = null;
    try {
      const abortPromise = signal
        ? new Promise((_, rej) => {
            if (signal.aborted) return rej(new Error('aborted'));
            onAbort = () => rej(new Error('aborted'));
            signal.addEventListener('abort', onAbort);
          })
        : new Promise(() => {});

      const data = await Promise.race([
        extractPlaceData(page, href, tuning),
        new Promise((_, rej) => setTimeout(() => rej(new Error('place_timeout')), perUrlTimeout)),
        abortPromise,
      ]);

      if (!data?.phone) return null;

      const key = phoneKey(data.phone);
      if (!key || seenPhoneKeys.has(key)) return null;
      seenPhoneKeys.add(key);

      // Name is always present now (URL fallback), but guard anyway
      const name = data.name || nameFromUrl(href) || 'Unknown';

      return {
        name, phone: data.phone, address: data.address, website: data.website,
        rating: data.rating, reviews: data.reviews, zone, category,
        city: zone.split(',').pop()?.trim() || zone,
      };
    } catch (err) {
      const msg = String(err?.message || '');
      if (msg.includes('place_timeout')) stats.timeouts++;
      else if (!msg.includes('aborted')) stats.errors++;
      return null;
    } finally {
      if (signal && onAbort) signal.removeEventListener('abort', onAbort);
      stats.processed++;
    }
  }

  let nextIndex = 0;
  await Promise.all(
    Array.from({ length: Math.min(PARALLEL, hrefs.length) }, async () => {
      let page = null;
      try {
        page = await context.newPage();
      } catch (err) {
        stats.errors++;
        return;
      }

      try {
        while (nextIndex < hrefs.length) {
          if (signal?.aborted || results.length >= targetCount) break;
          const idx = nextIndex++;
          const r = await processOne(page, hrefs[idx]);
          if (r && results.length < targetCount) {
            results.push(r);
            onProgress?.(currentCount + results.length);
            console.log(`[scraper] Found #${currentCount + results.length}: ${r.name} — ${r.phone}`);
            if (results.length >= targetCount) break;
          }
        }
      } finally {
        await page.close().catch(() => {});
      }
    })
  );

  return { results, stats };
}

// ── Main scrape function ───────────────────────────────────────────────────────

async function scrapeZone({ zone, category, maxResults = 200, onProgress, signal, speedMode = 'fast' }) {
  const mode = ['fast', 'balanced', 'deep'].includes(String(speedMode || '').toLowerCase())
    ? String(speedMode).toLowerCase()
    : 'fast';
  const isFastHeavyPlan = mode === 'fast' && Number(maxResults || 0) >= 16;

  const tuning =
    mode === 'deep'
      ? { urlMultiplier: 4.6, batchSize: 20, minParallel: 2, maxParallel: 4, perUrlTimeoutMs: 14000, initialWaitMs: 1200, postWaitMs: 500, scrollWaitMs: 320, maxStalled: 18, maxLoops: 140, phase1BudgetMs: 90000, settleMs: 900, phoneRaceMs: 2800, maxMs: 280000 }
      : mode === 'balanced'
      ? { urlMultiplier: 3.1, batchSize: 24, minParallel: 2, maxParallel: 5, perUrlTimeoutMs: 11000, initialWaitMs: 1000, postWaitMs: 420, scrollWaitMs: 260, maxStalled: 14, maxLoops: 100, phase1BudgetMs: 65000, settleMs: 800, phoneRaceMs: 2200, maxMs: 200000 }
      : isFastHeavyPlan
        ? { urlMultiplier: 2.0, batchSize: 18, minParallel: 3, maxParallel: 4, perUrlTimeoutMs: 13000, initialWaitMs: 700, postWaitMs: 300, scrollWaitMs: 170, maxStalled: 12, maxLoops: 60, phase1BudgetMs: 36000, settleMs: 700, phoneRaceMs: 2200, maxMs: 140000 }
      : /* fast */
        { urlMultiplier: 1.9, batchSize: 30, minParallel: 4, maxParallel: 6, perUrlTimeoutMs: 9500, initialWaitMs: 650, postWaitMs: 280, scrollWaitMs: 150, maxStalled: 10, maxLoops: 52, phase1BudgetMs: 32000, settleMs: 650, phoneRaceMs: 1800, maxMs: 130000 };

  let browser = null;
  let context = null;

  try {
    browser = await launchBrowser();
    context = await makeContext(browser);

    const collectorPage = await context.newPage();
    const searchQuery = `${category} in ${zone}`;
    const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(searchQuery)}`;
    console.log(`[scraper] "${category}" in "${zone}" | target=${maxResults} mode=${mode}`);

    if (signal?.aborted) return [];

    const urlCap = Number(process.env.SCRAPE_URL_CAP || 5000);
    const modeHeadroom = mode === 'fast' ? 16 : mode === 'balanced' ? 24 : 30;
    const urlsToFetch = Math.min(
      Math.max(maxResults + modeHeadroom, Math.round(maxResults * Number(tuning.urlMultiplier || 2))),
      urlCap
    );

    let placeUrls;
    let onP1Abort = null;
    try {
      placeUrls = await Promise.race([
        collectPlaceUrls(collectorPage, searchUrl, urlsToFetch, tuning),
        new Promise((_, rej) => {
          if (!signal) return;
          if (signal.aborted) return rej(new Error('aborted'));
          onP1Abort = () => rej(new Error('aborted'));
          signal.addEventListener('abort', onP1Abort);
        }),
      ]);
    } catch (err) {
      if (String(err?.message).includes('aborted')) { console.log('[scraper] Aborted in Phase 1'); return []; }
      throw err;
    } finally {
      if (signal && onP1Abort) signal.removeEventListener('abort', onP1Abort);
      await collectorPage.close().catch(() => {});
    }

    if (!placeUrls?.length) {
      console.log('[scraper] No place URLs found — check network/Chromium access to Google Maps');
      return [];
    }

    const seenPhoneKeys = new Set();
    const results       = [];
    const batchSize     = Math.max(12, Number(tuning.batchSize || 24));
    const minP          = Math.max(2, Number(tuning.minParallel || 2));
    const maxP          = Math.min(10, Math.max(minP, Number(tuning.maxParallel || 5)));
    let   dynP          = maxP;
    const maxMs         = Number(tuning.maxMs || process.env.SCRAPE_MAX_MS || 300000);
    const deadline      = Date.now() + Math.min(maxMs, Math.max(120000, maxResults * 5000));

    for (let i = 0; i < placeUrls.length && results.length < maxResults && Date.now() < deadline; i += batchSize) {
      if (signal?.aborted) { console.log('[scraper] Aborted in Phase 2'); break; }

      const batch = placeUrls.slice(i, i + batchSize);
      const before = results.length;
      let batchResult;

      try {
        const remainingTarget = Math.max(1, maxResults - results.length);
        batchResult = await processBatch(
          context,
          batch,
          seenPhoneKeys,
          zone,
          category,
          onProgress,
          results.length,
          dynP,
          signal,
          tuning,
          remainingTarget
        );
      } catch (err) {
        if (String(err?.message).includes('aborted')) { console.log('[scraper] Aborted on batch'); break; }
        throw err;
      }

      const { results: br, stats } = batchResult;
      results.push(...br);

      const timeoutRate = stats.processed > 0 ? stats.timeouts / stats.processed : 0;
      const errorRate   = stats.processed > 0 ? stats.errors   / stats.processed : 0;
      const timeoutDownThreshold = mode === 'fast' ? 0.72 : 0.35;
      const errorDownThreshold = mode === 'fast' ? 0.35 : 0.2;
      const timeoutUpThreshold = mode === 'fast' ? 0.18 : 0.12;
      const errorUpThreshold = mode === 'fast' ? 0.12 : 0.08;
      if ((timeoutRate > timeoutDownThreshold || errorRate > errorDownThreshold) && dynP > minP) dynP = Math.max(minP, dynP - 1);
      else if (timeoutRate < timeoutUpThreshold && errorRate < errorUpThreshold && dynP < maxP) dynP += 1;

      console.log(`[scraper] Batch: processed=${stats.processed} added=${results.length - before} timeouts=${stats.timeouts} errors=${stats.errors} parallel=${dynP}`);
      if (results.length >= maxResults) break;
    }

    const final = results.slice(0, maxResults);
    console.log(`[scraper] Done — ${final.length}/${maxResults} leads for "${category}" in "${zone}"`);
    return final;

  } finally {
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
  }
}

module.exports = { scrapeZone };
