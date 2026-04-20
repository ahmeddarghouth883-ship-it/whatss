import { useEffect, useState } from 'react'
import api from '../api/client'

let cachedKeyPromise = null
let cachedScriptPromise = null
let cachedLibrariesPromise = null

async function fetchMapsKey() {
  if (!cachedKeyPromise) {
    cachedKeyPromise = api.get('/config/maps-key').then(r => r.data?.key || '').catch(() => '')
  }
  return cachedKeyPromise
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
      if (/maps\.googleapis\.com\/maps\/api\/js/.test(existingSrc) && existing.dataset.loaded === 'true') {
        resolve(window.google)
        return
      }
      existing.addEventListener('load', () => resolve(window.google))
      existing.addEventListener('error', () => {
        cachedScriptPromise = null
        reject(new Error('Failed to load Google Maps JS'))
      })
      return
    }
    const s = document.createElement('script')
    s.id = 'google-maps-js'
    s.async = true
    s.defer = true
    const libs = Array.from(new Set(libraries)).join(',')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=${libs}&v=weekly&loading=async`
    s.onload = () => {
      s.dataset.loaded = 'true'
      resolve(window.google)
    }
    s.onerror = () => {
      cachedScriptPromise = null
      reject(new Error('Failed to load Google Maps JS'))
    }
    document.head.appendChild(s)
  })
  return cachedScriptPromise
}

async function ensureLibraries(googleObj, libraries = ['places']) {
  if (!googleObj?.maps) throw new Error('Google Maps namespace unavailable')
  if (cachedLibrariesPromise) return cachedLibrariesPromise
  if (typeof googleObj.maps.importLibrary !== 'function') return googleObj

  const unique = Array.from(new Set(['maps', ...libraries]))
  cachedLibrariesPromise = Promise.all(unique.map((lib) => googleObj.maps.importLibrary(lib)))
    .then(() => googleObj)
    .catch((err) => {
      cachedLibrariesPromise = null
      throw err
    })

  return cachedLibrariesPromise
}

/**
 * useGoogleMaps — loads the Google Maps JS API once and returns { google, ready, error }.
 * The API key is fetched from the authenticated /api/config/maps-key endpoint,
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
