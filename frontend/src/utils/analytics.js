/**
 * Lightweight analytics bridge: forwards to gtag / dataLayer when present.
 * Set VITE_GA_MEASUREMENT_ID and load gtag in index.html to enable GA4.
 */
export function track(eventName, params = {}) {
  if (typeof window === 'undefined') return;
  try {
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
    }
    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push({ event: eventName, ...params });
    }
    if (import.meta.env?.DEV) {
      console.debug('[analytics]', eventName, params);
    }
  } catch {
    /* ignore */
  }
}
