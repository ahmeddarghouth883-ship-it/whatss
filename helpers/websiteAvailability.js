/**
 * Lightweight HTTP reachability probe for lead websites (Google Places `websiteUri`).
 * Used during extraction so saved leads carry an up/down signal without manual checks.
 */

const dns = require('dns').promises;
const net = require('net');

const DEFAULT_TIMEOUT_MS = Number(process.env.WEBSITE_CHECK_TIMEOUT_MS || 8000);
const USER_AGENT = 'Mozilla/5.0 WhispFlowSiteCheck/1.0';

function normalizeLeadWebsite(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.href;
  } catch (_) {
    return null;
  }
}

function isPrivateIpv4(ip) {
  const parts = String(ip).split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 0) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

async function assertResolvablePublicHost(hostname) {
  const h = String(hostname || '').toLowerCase();
  if (!h || h === 'localhost' || h.endsWith('.localhost')) {
    throw new Error('blocked_host');
  }

  if (net.isIP(h)) {
    if (h === '::1') throw new Error('blocked_ip');
    if (net.isIPv4(h) && isPrivateIpv4(h)) throw new Error('blocked_ip');
    return;
  }

  let address;
  try {
    const r = await dns.lookup(h, { verbatim: true });
    address = r.address;
  } catch (_) {
    throw new Error('dns_failed');
  }

  if (net.isIPv4(address) && isPrivateIpv4(address)) throw new Error('blocked_ip');
}

/**
 * Returns whether we could complete an HTTP round-trip (network + TLS + response headers).
 * Any HTTP status counts as "reachable" (server answered); only network/TLS/DNS failures are false.
 *
 * @param {string} rawUrl
 * @param {{ signal?: AbortSignal, timeoutMs?: number }} [opts]
 * @returns {Promise<{ reachable: boolean, status: number|null, reason?: string }>}
 */
async function checkWebsiteReachable(rawUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const parentSignal = opts.signal;

  const urlStr = normalizeLeadWebsite(rawUrl);
  if (!urlStr) return { reachable: false, status: null, reason: 'bad_url' };

  let u;
  try {
    u = new URL(urlStr);
    await assertResolvablePublicHost(u.hostname);
  } catch (e) {
    const msg = String(e?.message || '');
    if (msg === 'blocked_host' || msg === 'blocked_ip') return { reachable: false, status: null, reason: msg };
    if (msg === 'dns_failed') return { reachable: false, status: null, reason: 'dns_failed' };
    return { reachable: false, status: null, reason: 'bad_url' };
  }

  const ctrl = new AbortController();
  const timerId = setTimeout(() => ctrl.abort(), timeoutMs);
  const onParentAbort = () => ctrl.abort();
  if (parentSignal?.aborted) ctrl.abort();
  else parentSignal?.addEventListener?.('abort', onParentAbort);

  async function tryRequest(method, extraHeaders = {}) {
    return fetch(u.href, {
      method,
      redirect: 'follow',
      signal: ctrl.signal,
      headers: {
        'user-agent': USER_AGENT,
        ...extraHeaders,
      },
    });
  }

  try {
    let res = await tryRequest('HEAD');

    // Many sites block HEAD; try a tiny ranged GET.
    if (res.status === 405 || res.status === 501) {
      res = await tryRequest('GET', { Range: 'bytes=0-0' });
    }

    const status = res.status;
    try {
      await res.arrayBuffer?.();
    } catch (_) {}

    return { reachable: true, status };
  } catch (err) {
    if (parentSignal?.aborted || err?.name === 'AbortError') {
      return { reachable: false, status: null, reason: 'timeout_or_abort' };
    }
    return { reachable: false, status: null, reason: 'network_error' };
  } finally {
    clearTimeout(timerId);
    parentSignal?.removeEventListener?.('abort', onParentAbort);
  }
}

const CHECK_CONCURRENCY = Math.max(1, Math.min(16, Number(process.env.WEBSITE_CHECK_CONCURRENCY || 8)));

/**
 * Runs {@link checkWebsiteReachable} for each lead that has a website URL.
 * Honors `signal` between chunks; skips check when WEBSITE_AVAILABILITY_CHECK=0.
 *
 * @param {Array<object>} leads Normalized lead objects from Places (may include `website`)
 * @param {{ signal?: AbortSignal }} [opts]
 */
async function attachWebsiteAvailability(leads, opts = {}) {
  const { signal } = opts;
  if (process.env.WEBSITE_AVAILABILITY_CHECK === '0') return leads;

  const out = [];
  for (let i = 0; i < leads.length; i += CHECK_CONCURRENCY) {
    if (signal?.aborted) {
      out.push(...leads.slice(i));
      break;
    }
    const slice = leads.slice(i, i + CHECK_CONCURRENCY);
    const chunk = await Promise.all(
      slice.map(async (lead) => {
        if (!lead?.website || signal?.aborted) return lead;
        const chk = await checkWebsiteReachable(lead.website, { signal });
        return {
          ...lead,
          websiteReachable: chk.reachable,
          websiteHttpStatus: chk.status != null ? chk.status : undefined,
          websiteCheckedAt: new Date(),
        };
      })
    );
    out.push(...chunk);
  }
  return out;
}

module.exports = {
  normalizeLeadWebsite,
  checkWebsiteReachable,
  attachWebsiteAvailability,
};
