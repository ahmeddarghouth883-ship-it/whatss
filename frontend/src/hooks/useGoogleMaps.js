import { useEffect, useState } from 'react'
import api from '../api/client'

let cachedKeyPromise = null
let cachedScriptPromise = null

async function fetchMapsKey() {
  if (!cachedKeyPromise) {
    cachedKeyPromise = api.get('/config/maps-key').then(r => r.data?.key || '').catch(() => '')
  }
  return cachedKeyPromise
}

function loadScript(key, libraries = ['places']) {
  if (typeof window === 'undefined') return Promise.reject(new Error('No window'))
  if (window.google?.maps?.places) return Promise.resolve(window.google)
  if (cachedScriptPromise) return cachedScriptPromise

  cachedScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('google-maps-js')
    if (existing) {
      existing.addEventListener('load', () => resolve(window.google))
      existing.addEventListener('error', reject)
      return
    }
    const s = document.createElement('script')
    s.id = 'google-maps-js'
    s.async = true
    s.defer = true
    const libs = Array.from(new Set([...libraries, 'visualization'])).join(',')
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=${libs}&v=weekly&loading=async`
    s.onload = () => resolve(window.google)
    s.onerror = () => {
      cachedScriptPromise = null
      reject(new Error('Failed to load Google Maps JS'))
    }
    document.head.appendChild(s)
  })
  return cachedScriptPromise
}

/**
 * useGoogleMaps — loads the Google Maps JS API once and returns { google, ready, error }.
 * The API key is fetched from the authenticated /api/config/maps-key endpoint,
 * so it lives only in env/logs on the server (no VITE_* duplication).
 */
export function useGoogleMaps(libraries = ['places']) {
  const [google, setGoogle] = useState(typeof window !== 'undefined' ? window.google || null : null)
  const [ready, setReady]   = useState(!!(typeof window !== 'undefined' && window.google?.maps?.places))
  const [error, setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const key = await fetchMapsKey()
        if (!key) throw new Error('Google Maps key unavailable. Check server env/logs.')
        const g = await loadScript(key, libraries)
        if (cancelled) return
        setGoogle(g)
        setReady(true)
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load Google Maps')
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { google, ready, error }
}
