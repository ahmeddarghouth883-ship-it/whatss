import { useEffect, useState } from 'react'
import api from '../api/client'

let cachedKeyPromise = null
let cachedScriptPromise = null
const cachedLibrariesPromises = new Map()

function waitForGoogleMaps(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const timer = window.setInterval(() => {
      if (window.google?.maps) {
        window.clearInterval(timer)
        resolve(window.google)
        return
      }
      if (Date.now() - startedAt >= timeoutMs) {
        window.clearInterval(timer)
        reject(new Error('Timed out waiting for Google Maps namespace'))
      }
    }, 50)
  })
}

async function fetchMapsKey() {
  if (!cachedKeyPromise) {
    cachedKeyPromise = api
      .get('/config/maps-key')
      .then((r) => r.data?.key || '')
      .catch((err) => {
        const detail = err?.response?.data?.error || err?.message || 'Unknown error'
        throw new Error(`Failed to fetch Google Maps key: ${detail}`)
      })
  }
  return cachedKeyPromise
}

function attachGoogleMapsAuthFailureHandler(onFailure) {
  if (typeof window === 'undefined') return () => {}
  const previous = window.gm_authFailure
  const handler = () => {
    if (typeof previous === 'function') previous()
    if (window.gm_authFailure === handler) window.gm_authFailure = previous
    onFailure()
  }
  window.gm_authFailure = handler
  return () => {
    if (window.gm_authFailure === handler) window.gm_authFailure = previous
  }
}

function loadScript(key, libraries = ['places']) {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'))
  if (window.google?.maps) return Promise.resolve(window.google)
  if (cachedScriptPromise) return cachedScriptPromise

  cachedScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('google-maps-js')
    if (existing) {
      // If a previous render already loaded Maps, resolve immediately.
      if (window.google?.maps) {
        resolve(window.google)
        return
      }
      // Existing script may already be finished (success or failure), so don't
      // rely only on future load/error events.
      const existingSrc = existing.getAttribute('src') || ''
      const isMapsScript = /maps\.googleapis\.com\/maps\/api\/js/.test(existingSrc)
      if (isMapsScript && (existing.dataset.loaded === 'true' || existing.readyState === 'complete')) {
        // If the event already fired before we subscribed, explicitly wait for the namespace.
        waitForGoogleMaps()
          .then(resolve)
          .catch((err) => {
            existing.remove()
            cachedScriptPromise = null
            reject(err)
          })
        return
      }
      if (!isMapsScript) {
        existing.remove()
        cachedScriptPromise = null
      } else {
        existing.addEventListener('load', () => {
          waitForGoogleMaps()
            .then(resolve)
            .catch((err) => {
              cachedScriptPromise = null
              reject(err)
            })
        }, { once: true })
        existing.addEventListener('error', () => {
          cachedScriptPromise = null
          reject(new Error('Failed to load Google Maps JS'))
        }, { once: true })
        return
      }
    }
    const restoreAuthHandler = attachGoogleMapsAuthFailureHandler(() => {
      cachedScriptPromise = null
      reject(new Error('Google Maps authentication failed. Check API key restrictions and referrer settings.'))
    })

    const s = document.createElement('script')
    s.id = 'google-maps-js'
    s.async = true
    s.defer = true
    const libs = Array.from(new Set(libraries)).join(',')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=${libs}&v=weekly&loading=async`
    s.onload = () => {
      s.dataset.loaded = 'true'
      waitForGoogleMaps()
        .then((google) => {
          restoreAuthHandler()
          resolve(google)
        })
        .catch((err) => {
          restoreAuthHandler()
          cachedScriptPromise = null
          reject(err)
        })
    }
    s.onerror = () => {
      restoreAuthHandler()
      cachedScriptPromise = null
      reject(new Error('Failed to load Google Maps JS'))
    }
    document.head.appendChild(s)
  })
  return cachedScriptPromise
}

async function ensureLibraries(googleObj, libraries = ['places']) {
  if (!googleObj?.maps) throw new Error('Google Maps namespace unavailable')
  if (typeof googleObj.maps.importLibrary !== 'function') return googleObj

  const unique = Array.from(new Set(['maps', ...libraries]))
  const key = unique.sort().join(',')
  if (cachedLibrariesPromises.has(key)) {
    return cachedLibrariesPromises.get(key)
  }

  const librariesPromise = Promise.all(unique.map((lib) => googleObj.maps.importLibrary(lib)))
    .then(() => googleObj)
    .catch((err) => {
      cachedLibrariesPromises.delete(key)
      throw err
    })

  cachedLibrariesPromises.set(key, librariesPromise)
  return librariesPromise
}

/**
 * useGoogleMaps — loads the Google Maps JS API once and returns { google, ready, error }.
 * The API key is fetched from the /api/config/maps-key endpoint,
 * so it lives only in env/logs on the server (no VITE_* duplication).
 */
export function useGoogleMaps(libraries = ['places']) {
  const [google, setGoogle] = useState(typeof window !== 'undefined' ? window.google || null : null)
  const [ready, setReady]   = useState(!!(typeof window !== 'undefined' && window.google?.maps?.Map))
  const [error, setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const key = await fetchMapsKey()
        if (!key) throw new Error('Google Maps key unavailable. Check server env/logs.')
        const g = await loadScript(key, libraries)
        await ensureLibraries(g, libraries)
        if (cancelled) return
        setGoogle(g)
        setReady(!!g?.maps?.Map)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load Google Maps')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { google, ready, error }
}
