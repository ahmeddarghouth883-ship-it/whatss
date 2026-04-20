import { useEffect, useRef, useState } from 'react'
import { useGoogleMaps } from '../hooks/useGoogleMaps'
import api from '../api/client'

const DEFAULT_CENTER = { lat: 36.8065, lng: 10.1815 } // Tunis

/**
 * PlacesMapPicker — lets the user pick a zone on a Google Map:
 *   1. Optional autocomplete search box to jump to a city / address.
 *   2. Click anywhere on the map to drop / move a draggable marker.
 *   3. A draggable + editable circle is rendered around the marker.
 *   4. A radius slider (500m – 10km) keeps state in sync with the circle.
 *
 * Props:
 *   value: { lat, lng, radius, address? } | null
 *   onChange: (next) => void
 */
export default function PlacesMapPicker({ value, onChange, className = '' }) {
  const { google, ready, error } = useGoogleMaps(['places'])
  const mapDivRef     = useRef(null)
  const searchInputRef = useRef(null)
  const searchControlRef = useRef(null)
  const mapRef        = useRef(null)
  const markerRef     = useRef(null)
  const circleRef     = useRef(null)
  const autocompleteRef = useRef(null)
  const geocoderRef   = useRef(null)

  const [center, setCenter] = useState(() => (
    value?.lat != null && value?.lng != null ? { lat: value.lat, lng: value.lng } : null
  ))
  const [radius, setRadius] = useState(value?.radius ?? 2500)
  const [address, setAddress] = useState(value?.address || '')
  const [showHeatmap, setShowHeatmap] = useState(false)
  const heatmapRef = useRef(null)

  // ── Init map once Google is ready ─────────────────────────────────────────
  useEffect(() => {
    if (!ready || !google || !mapDivRef.current || mapRef.current) return

    const map = new google.maps.Map(mapDivRef.current, {
      center: center || DEFAULT_CENTER,
      zoom: center ? 13 : 6,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      clickableIcons: false,
    })
    mapRef.current = map
    geocoderRef.current = new google.maps.Geocoder()

    map.addListener('click', (e) => {
      if (!e?.latLng) return
      placeAt(e.latLng.lat(), e.latLng.lng(), { reverseGeocode: true })
    })

    if (center) placeAt(center.lat, center.lng, { reverseGeocode: !address })

    // ── Place autocomplete ─────────────────────────────────────────────────
    const places = google.maps.places || {}
    if (searchControlRef.current && places.PlaceAutocompleteElement) {
      const el = new places.PlaceAutocompleteElement()
      el.setAttribute('placeholder', 'Search city or address to center the map...')
      searchControlRef.current.innerHTML = ''
      searchControlRef.current.appendChild(el)
      autocompleteRef.current = el

      const onPlaceSelect = async (event) => {
        const prediction = event?.placePrediction || event?.detail?.placePrediction || event?.detail
        if (!prediction?.toPlace) return
        try {
          const place = prediction.toPlace()
          await place.fetchFields({
            fields: ['location', 'viewport', 'formattedAddress', 'displayName'],
          })
          if (!place?.location) return
          const lat = place.location.lat()
          const lng = place.location.lng()
          const addr = place.formattedAddress || place.displayName || ''
          setAddress(addr)
          if (place.viewport) map.fitBounds(place.viewport)
          else { map.setCenter({ lat, lng }); map.setZoom(13) }
          placeAt(lat, lng, { address: addr, reverseGeocode: false })
        } catch (_) {
          // Ignore transient Places API failures and keep map usable.
        }
      }

      el.addEventListener('gmp-placeselect', onPlaceSelect)
    } else if (searchInputRef.current && places.Autocomplete) {
      // Fallback for projects/accounts where the legacy widget is still used.
      const ac = new places.Autocomplete(searchInputRef.current, {
        fields: ['geometry', 'formatted_address', 'name'],
        types: ['geocode'],
      })
      autocompleteRef.current = ac
      ac.addListener('place_changed', () => {
        const place = ac.getPlace()
        if (!place?.geometry?.location) return
        const lat = place.geometry.location.lat()
        const lng = place.geometry.location.lng()
        const addr = place.formatted_address || place.name || ''
        setAddress(addr)
        if (place.geometry.viewport) map.fitBounds(place.geometry.viewport)
        else { map.setCenter({ lat, lng }); map.setZoom(13) }
        placeAt(lat, lng, { address: addr, reverseGeocode: false })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, google])

  // ── Helpers ───────────────────────────────────────────────────────────────
  function placeAt(lat, lng, opts = {}) {
    const g = google || window.google
    const map = mapRef.current
    if (!g || !map) return

    const pos = { lat, lng }
    setCenter(pos)

    if (!markerRef.current) {
      markerRef.current = new g.maps.Marker({
        position: pos, map, draggable: true,
        title: 'Drag to adjust the zone center',
      })
      markerRef.current.addListener('dragend', (e) => {
        placeAt(e.latLng.lat(), e.latLng.lng(), { reverseGeocode: true })
      })
    } else {
      markerRef.current.setPosition(pos)
    }

    if (!circleRef.current) {
      circleRef.current = new g.maps.Circle({
        map, center: pos, radius,
        editable: true, draggable: true, clickable: false,
        strokeColor: '#22c55e', strokeWeight: 2, strokeOpacity: 0.9,
        fillColor: '#22c55e', fillOpacity: 0.12,
      })
      circleRef.current.addListener('radius_changed', () => {
        const r = Math.round(circleRef.current.getRadius())
        setRadius(r)
        emitChange({ radius: r })
      })
      circleRef.current.addListener('center_changed', () => {
        const c = circleRef.current.getCenter()
        if (!c) return
        const next = { lat: c.lat(), lng: c.lng() }
        if (markerRef.current) markerRef.current.setPosition(next)
        setCenter(next)
        emitChange({ lat: next.lat, lng: next.lng, reverseGeocode: true })
      })
    } else {
      circleRef.current.setCenter(pos)
    }

    if (opts.address) setAddress(opts.address)
    if (opts.reverseGeocode && geocoderRef.current) {
      geocoderRef.current.geocode({ location: pos }, (results, status) => {
        if (status === 'OK' && results?.[0]) {
          const addr = results[0].formatted_address
          setAddress(addr)
          emitChange({ lat, lng, address: addr })
        } else {
          emitChange({ lat, lng })
        }
      })
    } else {
      emitChange({ lat, lng, ...(opts.address ? { address: opts.address } : {}) })
    }
  }

  function emitChange(patch = {}) {
    const next = {
      lat:     patch.lat     ?? center?.lat ?? null,
      lng:     patch.lng     ?? center?.lng ?? null,
      radius:  patch.radius  ?? radius,
      address: patch.address ?? address,
    }
    if (next.lat == null || next.lng == null) return
    onChange?.(next)
  }

  // ── Heatmap of existing user leads ────────────────────────────────────────
  async function loadHeatmap() {
    const g = google || window.google
    const map = mapRef.current
    if (!g || !map || !g.maps?.visualization) return
    if (heatmapRef.current) {
      heatmapRef.current.setMap(null)
      heatmapRef.current = null
    }
    try {
      // Pull up to 1000 leads for the user; we don't have lat/lng on Lead
      // (only address) so we approximate by reusing the search center.
      // For now, geocode-on-demand would be expensive; we simply show the
      // markers we DO have geo data for via /scrape/jobs (each job has lat/lng/radius).
      const r = await api.get('/scrape/jobs')
      const points = []
      for (const j of (r.data?.jobs || [])) {
        if (typeof j?.lat === 'number' && typeof j?.lng === 'number' && j?.saved > 0) {
          // Weight roughly by saved leads at the job center
          points.push({ location: new g.maps.LatLng(j.lat, j.lng), weight: Math.min(50, j.saved) })
        }
      }
      if (points.length === 0) return
      heatmapRef.current = new g.maps.visualization.HeatmapLayer({
        data: points, map, radius: 40, opacity: 0.65,
      })
    } catch (_) { /* ignore */ }
  }

  useEffect(() => {
    if (!showHeatmap) {
      if (heatmapRef.current) { heatmapRef.current.setMap(null); heatmapRef.current = null }
      return
    }
    loadHeatmap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHeatmap, ready])

  // ── Radius slider updates the circle ──────────────────────────────────────
  function handleRadiusChange(e) {
    const r = Math.max(200, Math.min(50000, Number(e.target.value) || 2500))
    setRadius(r)
    if (circleRef.current) circleRef.current.setRadius(r)
    emitChange({ radius: r })
  }

  const radiusKm = (radius / 1000).toFixed(radius < 1000 ? 2 : 1)
  const areaKm2  = (Math.PI * Math.pow(radius / 1000, 2)).toFixed(1)

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Search box */}
      <div className="relative">
        <div
          ref={searchControlRef}
          className={ready ? '' : 'hidden'}
        />
        <input
          ref={searchInputRef}
          type="text"
          className={`input w-full ${ready ? 'hidden' : ''}`}
          placeholder={ready ? 'Search city or address to center the map…' : 'Loading map…'}
          disabled={!ready}
          defaultValue={value?.address || ''}
          onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault() }}
        />
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </div>

      {/* Map */}
      <div
        ref={mapDivRef}
        className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900"
        style={{ height: 380 }}
      >
        {!ready && !error && (
          <div className="h-full flex items-center justify-center text-xs text-gray-400">
            Loading Google Maps…
          </div>
        )}
      </div>

      {/* Radius slider */}
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400 font-medium">
          Radius
        </label>
        <input
          type="range"
          min={500}
          max={10000}
          step={100}
          value={Math.min(10000, radius)}
          onChange={handleRadiusChange}
          className="flex-1 min-w-[160px] accent-green-600"
          disabled={!ready}
        />
        <span className="text-sm font-mono text-gray-700 dark:text-gray-200 whitespace-nowrap">
          {radiusKm} km
        </span>
        <span className="text-[11px] text-gray-400 font-mono whitespace-nowrap">
          ~{areaKm2} km²
        </span>
        <div className="flex gap-1.5">
          {[1000, 2500, 5000, 10000].map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => {
                setRadius(r)
                if (circleRef.current) circleRef.current.setRadius(r)
                emitChange({ radius: r })
              }}
              className={`text-[11px] px-2 py-1 rounded border ${radius === r ? 'bg-green-50 border-green-300 text-green-700' : 'bg-white border-gray-200 text-gray-500 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300'}`}
            >
              {r >= 1000 ? `${r / 1000}km` : `${r}m`}
            </button>
          ))}
        </div>
      </div>

      {/* Selection summary + heatmap toggle */}
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs text-gray-500 dark:text-gray-400 font-mono break-words flex-1 min-w-0">
          {center
            ? <>📍 {center.lat.toFixed(5)}, {center.lng.toFixed(5)} {address && <>— {address}</>}</>
            : <>Click on the map to drop the zone center, or search an address above.</>}
        </div>
        <label className="text-[11px] text-gray-500 dark:text-gray-400 flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
          <input type="checkbox" checked={showHeatmap} onChange={e => setShowHeatmap(e.target.checked)} className="rounded" />
          Heatmap
        </label>
      </div>
    </div>
  )
}
