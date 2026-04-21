import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useSocket } from '../hooks/useSocket'
import PlacesMapPicker from '../components/PlacesMapPicker'

const QUICK_INDUSTRIES = [
  'restaurants', 'pharmacies', 'lawyers', 'real estate agents',
  'hotels', 'clinics', 'dentists', 'car dealers', 'gyms',
  'supermarkets', 'bakeries', 'schools', 'banks', 'travel agencies',
  'construction companies', 'electronics stores', 'clothing stores',
  'hair salons', 'beauty salons', 'architects', 'accountants',
]

const MAX_LEADS_HARD_CAP = 500 // server enforces this too
const DEFAULT_MAX_LEADS  = 200
const MAX_LEAD_PRESETS   = [60, 200, 500]

function StatusBadge({ status }) {
  const map = { pending:'badge-yellow', running:'badge-blue', done:'badge-green', failed:'badge-red', cancel_requested:'badge-yellow', cancelled:'badge-gray' }
  return <span className={map[status] || 'badge-gray'}>{status}</span>
}

function formatTimelineClock(value) {
  if (!value) return '--:--:--'
  const dt = new Date(value)
  if (Number.isNaN(dt.getTime())) return '--:--:--'
  return dt.toLocaleTimeString([], { hour12: false })
}

function timelineEventTone(event) {
  const code = String(event || '').toLowerCase()
  if (code.includes('failed') || code.includes('timed_out')) return 'bg-red-50 border-red-200 text-red-700'
  if (code.includes('retry') || code.includes('stopped') || code.includes('cancel')) return 'bg-yellow-50 border-yellow-200 text-yellow-700'
  if (code.includes('completed') || code.includes('finished')) return 'bg-green-50 border-green-200 text-green-700'
  return 'bg-blue-50 border-blue-200 text-blue-700'
}

function formatTimelineEvent(entry) {
  const event = String(entry?.event || '').toLowerCase()
  const added = Number.isFinite(Number(entry?.added)) ? Number(entry.added) : null
  const durationMs = Number.isFinite(Number(entry?.durationMs)) ? Number(entry.durationMs) : null
  const durationLabel = durationMs !== null ? ` in ${Math.max(1, Math.round(durationMs / 1000))}s` : ''
  const addedLabel = added !== null ? ` (+${added})` : ''

  const planLabel = entry?.planIndex ? `tile ${entry.planIndex}${entry?.planCount ? `/${entry.planCount}` : ''}` : 'tile'

  if (event === 'job_started')     return entry?.planCount ? `Job started · ${entry.planCount} tile(s)` : 'Job started'
  if (event === 'job_finished')    return `Job finished${addedLabel}${durationLabel}`
  if (event === 'job_failed')      return `Job failed (${entry?.errorCode || 'EXTRACTION_FAILURE'})`
  if (event === 'job_cancelled')   return 'Job cancelled by user'
  if (event === 'plan_started')    return `${planLabel} started`
  if (event === 'plan_completed') {
    const raw = Number.isFinite(Number(entry?.rawCount)) ? Number(entry.rawCount) : null
    const withPhone = Number.isFinite(Number(entry?.withPhoneCount)) ? Number(entry.withPhoneCount) : null
    const deduped = Number.isFinite(Number(entry?.dedupedCount)) ? Number(entry.dedupedCount) : null
    const diagnostics = (raw !== null && withPhone !== null && deduped !== null)
      ? ` · raw:${raw} phone:${withPhone} deduped:${deduped}`
      : ''
    return `${planLabel} done${addedLabel}${durationLabel}${diagnostics}`
  }
  if (event === 'plan_failed')     return `${planLabel} failed`
  return event || 'event'
}

export default function ScrapePage() {
  const socket = useSocket()

  const [industry,   setIndustry]   = useState('')
  const [zonePick,   setZonePick]   = useState(null)   // { lat, lng, radius, address }
  const [maxResults, setMaxResults] = useState(DEFAULT_MAX_LEADS)
  const [progress,   setProgress]   = useState(null)
  const [jobs,       setJobs]       = useState([])
  const [loading,    setLoading]    = useState(false)
  const [jobsLoading,setJobsLoading]= useState(true)
  const [timelineEvents, setTimelineEvents] = useState([])
  const [timelineMeta, setTimelineMeta] = useState({ included: false, totalEvents: 0, returnedEvents: 0 })
  const [presets,    setPresets]    = useState([])
  const [presetSaving, setPresetSaving] = useState(false)
  const [preview,    setPreview]    = useState(null)   // { existingInZone, existingInCategory, zone, subCategories }

  async function refreshPresets() {
    try { const r = await api.get('/presets'); setPresets(r.data.presets || []) } catch (_) {}
  }
  useEffect(() => { refreshPresets() }, [])

  // Duplicate-detection preview (debounced)
  useEffect(() => {
    if (!industry.trim() || !zonePick?.lat || !zonePick?.lng) { setPreview(null); return }
    const id = setTimeout(async () => {
      try {
        const r = await api.get('/scrape/preview', {
          params: { industry: industry.trim(), lat: zonePick.lat, lng: zonePick.lng, radius: zonePick.radius },
        })
        setPreview(r.data)
      } catch (_) { setPreview(null) }
    }, 600)
    return () => clearTimeout(id)
  }, [industry, zonePick?.lat, zonePick?.lng, zonePick?.radius])

  async function savePreset() {
    if (!industry.trim() || !zonePick?.lat) return toast.error('Pick a zone and industry first')
    const name = (window.prompt('Name this preset (e.g. "Tunis pharmacies 5km")') || '').trim()
    if (!name) return
    setPresetSaving(true)
    try {
      await api.post('/presets', {
        name, industry: industry.trim(),
        lat: zonePick.lat, lng: zonePick.lng, radius: zonePick.radius,
        zone: zonePick.address || '', maxResults,
      })
      toast.success(`Preset "${name}" saved`)
      refreshPresets()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to save preset')
    } finally { setPresetSaving(false) }
  }

  function loadPreset(p) {
    setIndustry(p.industry)
    setMaxResults(p.maxResults || DEFAULT_MAX_LEADS)
    setZonePick({ lat: p.lat, lng: p.lng, radius: p.radius, address: p.zone || '' })
    api.post(`/presets/${p._id}/use`).catch(() => {})
    toast.success(`Loaded "${p.name}"`)
  }

  async function deletePreset(p) {
    if (!window.confirm(`Delete preset "${p.name}"?`)) return
    try { await api.delete(`/presets/${p._id}`); toast.success('Preset deleted'); refreshPresets() }
    catch (e) { toast.error(e?.response?.data?.error || 'Delete failed') }
  }

  async function refreshJobs() {
    setJobsLoading(true)
    try {
      const r = await api.get('/scrape/jobs')
      setJobs(r.data.jobs)
    } finally {
      setJobsLoading(false)
    }
  }

  useEffect(() => { refreshJobs() }, [])

  // Poll job status so completion works even if Socket.IO misses events.
  useEffect(() => {
    const jobId = progress?.jobId
    if (!jobId || progress?.phase === 'done' || progress?.phase === 'error') return
    const id = setInterval(async () => {
      try {
        const { data } = await api.get(`/scrape/jobs/${jobId}?includeTimeline=1&timelineLimit=60`)
        const job = data.job
        if (!job) return

        if (Array.isArray(job.planTimeline)) setTimelineEvents(job.planTimeline)
        if (data.timeline) setTimelineMeta(data.timeline)

        if (job.status !== 'done' && job.status !== 'failed' && job.status !== 'cancelled') {
          setProgress((p) => {
            if (!p) return p
            return {
              ...p,
              phase: job.status === 'cancel_requested'
                ? 'cancel_requested'
                : (p.phase === 'starting' ? 'scraping' : p.phase),
              found: Number.isFinite(Number(job.found)) ? Number(job.found) : (p.found || 0),
              saved: Number.isFinite(Number(job.saved)) ? Number(job.saved) : (p.saved || 0),
              total: Number.isFinite(Number(job.target)) ? Number(job.target) : p.total,
              stopReason: job.stopReason || p.stopReason,
            }
          })
          return
        }

        setProgress((p) => {
          if (!p || p.phase === 'done' || p.phase === 'error') return p
          if (job.status === 'cancelled') {
            toast('Extraction stopped')
            refreshJobs()
            return { ...p, phase: 'cancelled', total: Number(job?.found || 0), saved: Number(job?.saved || 0), stopReason: job?.stopReason || p?.stopReason }
          }
          if (job.status === 'failed') {
            toast.error(`Extraction failed: ${job.error || 'Unknown error'}`)
            return { ...p, phase: 'error', error: job.error, stopReason: job?.stopReason || p?.stopReason }
          }
          if (job.saved > 0) toast.success(`Done! ${job.saved} leads saved`)
          else toast.error('No leads extracted (no phone numbers returned). Try a wider radius or another industry.')
          refreshJobs()
          return { ...p, phase: 'done', saved: job.saved, dupes: job.dupes, total: job.found, zone: job.zone, category: job.category, stopReason: job.stopReason }
        })
      } catch (_) {}
    }, 1500)
    return () => clearInterval(id)
  }, [progress?.jobId, progress?.phase])

  useEffect(() => {
    const onStarted  = d => setProgress((p) => ({ ...(p || {}), ...d, phase: 'scraping', saved: p?.saved ?? 0, found: p?.found ?? 0, startedAt: p?.startedAt || Date.now() }))
    const onFound    = d => setProgress(p => p ? { ...p, found: d.count } : p)
    const onSaving   = d => setProgress(p => p ? { ...p, total: d.total, phase: 'saving' } : p)
    const onProgress = d => setProgress(p => p ? { ...p, ...d } : p)
    const onDone     = d => {
      setProgress((p) => {
        if (!p || p.phase === 'done' || p.phase === 'error') return p
        if (d.saved > 0) toast.success(`Done! ${d.saved} leads saved`)
        else toast.error('No leads extracted (no phone numbers returned). Try a wider radius or another industry.')
        refreshJobs()
        return { ...p, ...d, phase: 'done' }
      })
    }
    const onError = d => {
      setProgress((p) => {
        if (!p || p.phase === 'error' || p.phase === 'done') return p
        toast.error(`Extraction failed: ${d.message}`)
        return { ...p, phase: 'error', error: d.message }
      })
    }
    const onCancelled = d => {
      setProgress((p) => {
        if (!p || p.phase === 'done' || p.phase === 'error' || p.phase === 'cancelled') return p
        toast('Extraction stopped')
        refreshJobs()
        return { ...p, phase: 'cancelled', total: d?.total ?? p?.total ?? 0 }
      })
    }
    socket.on('scrape:started',  onStarted)
    socket.on('scrape:found',    onFound)
    socket.on('scrape:saving',   onSaving)
    socket.on('scrape:progress', onProgress)
    socket.on('scrape:done',     onDone)
    socket.on('scrape:error',    onError)
    socket.on('scrape:cancelled', onCancelled)
    return () => {
      socket.off('scrape:started',  onStarted)
      socket.off('scrape:found',    onFound)
      socket.off('scrape:saving',   onSaving)
      socket.off('scrape:progress', onProgress)
      socket.off('scrape:done',     onDone)
      socket.off('scrape:error',    onError)
      socket.off('scrape:cancelled', onCancelled)
    }
  }, [socket])

  const canStart = Boolean(industry.trim() && zonePick?.lat != null && zonePick?.lng != null)

  async function startScrape() {
    if (!canStart) return toast.error('Pick a zone on the map and enter an industry')
    setLoading(true)
    setTimelineEvents([])
    setTimelineMeta({ included: true, totalEvents: 0, returnedEvents: 0 })
    const startedAt = Date.now()
    const safeMax = Math.max(10, Math.min(MAX_LEADS_HARD_CAP, Number(maxResults) || DEFAULT_MAX_LEADS))
    setProgress({
      zone:     zonePick.address || `${zonePick.lat.toFixed(3)},${zonePick.lng.toFixed(3)}`,
      category: industry.trim(),
      phase:    'starting',
      saved:    0,
      found:    0,
      total:    safeMax,
      startedAt,
      jobId:    null,
    })
    try {
      const res = await api.post('/scrape/zone', {
        industry:   industry.trim(),
        lat:        zonePick.lat,
        lng:        zonePick.lng,
        radius:     zonePick.radius,
        maxResults: safeMax,
        zone:       zonePick.address || `${zonePick.lat.toFixed(3)},${zonePick.lng.toFixed(3)}`,
      })
      toast.success('Extraction started!')
      setProgress((p) => p ? { ...p, jobId: res.data.jobId, total: res.data.target || safeMax } : p)
    } catch (err) {
      setProgress(null)
      const serverMsg = err.response?.data?.error
      const net = !err.response && (err.code === 'ERR_NETWORK' || err.code === 'ECONNABORTED' || err.message === 'Network Error')
      const msg = serverMsg || (net ? 'Cannot reach the API. Start the backend (npm start) on port 5000.' : null) || err.message || 'Failed to start extraction'
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  async function stopScrape() {
    if (!progress?.jobId) return
    try {
      await api.post(`/scrape/jobs/${progress.jobId}/cancel`)
      toast('Stopping extraction...')
      setProgress((p) => p ? { ...p, phase: 'cancel_requested' } : p)
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to stop extraction')
    }
  }

  const pct = progress?.total ? Math.round((progress.saved / progress.total) * 100)
           : (progress?.phase === 'scraping' ? null : 0)

  const elapsedSec = progress?.startedAt ? Math.max(1, Math.round((Date.now() - progress.startedAt) / 1000)) : 0
  const foundRate = progress?.found ? (progress.found / elapsedSec) : 0
  const savedRate = progress?.saved ? (progress.saved / elapsedSec) : 0
  const etaSec = progress?.total && progress?.saved > 0
    ? Math.max(0, Math.round((progress.total - progress.saved) / Math.max(savedRate, 0.05)))
    : null
  const timelinePreview = timelineEvents.slice(-12).reverse()
  const timelineSummaryTotal = Number.isFinite(Number(timelineMeta?.totalEvents))
    ? Number(timelineMeta.totalEvents) : timelineEvents.length
  const timelineSummaryReturned = Number.isFinite(Number(timelineMeta?.returnedEvents))
    ? Number(timelineMeta.returnedEvents) : timelineEvents.length

  const fmtDuration = (sec) => {
    const s = Math.max(0, Number(sec) || 0)
    const m = Math.floor(s / 60)
    const r = s % 60
    return m > 0 ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`
  }

  return (
    <div className="p-4 sm:p-8 max-w-4xl text-gray-900 dark:text-gray-100">

      <div className="mb-6">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900 dark:text-gray-100">Extract leads</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
          Type the industry you want to target, pick a zone on the map, then choose how many leads to pull. Phone-verified businesses are saved straight to your Leads.
        </p>
      </div>

      {/* Presets row */}
      {presets.length > 0 && (
        <div className="card p-3 sm:p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] uppercase tracking-wide text-gray-400 font-medium">Saved presets</p>
            <span className="text-[11px] text-gray-400">{presets.length} saved</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {presets.map(p => (
              <span key={p._id} className="inline-flex items-center gap-1 text-xs bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-full pl-3 pr-1 py-1">
                <button onClick={() => loadPreset(p)} className="text-gray-700 dark:text-gray-200 hover:text-green-700">
                  {p.name} <span className="text-gray-400 dark:text-gray-500">· {p.industry}</span>
                </button>
                <button onClick={() => deletePreset(p)} className="text-gray-300 hover:text-red-500 text-base leading-none px-1" title={`Delete preset ${p.name}`}>×</button>
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="card p-5 sm:p-6 mb-5 space-y-5">

        {/* Industry */}
        <div>
          <label className="label" htmlFor="scrape-industry">Industry / Category</label>
          <input
            id="scrape-industry"
            name="industry"
            className="input"
            value={industry}
            onChange={e => setIndustry(e.target.value)}
            placeholder="e.g. pharmacies, lawyers, car dealers, architects…"
            onKeyDown={e => e.key === 'Enter' && canStart && startScrape()}
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {QUICK_INDUSTRIES.map(ind => (
              <button
                key={ind}
                type="button"
                onClick={() => setIndustry(ind)}
                className={`text-xs px-2.5 py-1 rounded-full border transition-colors capitalize ${
                  industry === ind
                    ? 'bg-green-100 dark:bg-green-900/30 border-green-300 dark:border-green-700 text-green-800 dark:text-green-300'
                    : 'bg-gray-50 dark:bg-gray-900 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-600'
                }`}
              >
                {ind}
              </button>
            ))}
          </div>
        </div>

        {/* Map picker */}
        <div>
          <p className="label">Zone on map</p>
          <PlacesMapPicker value={zonePick} onChange={setZonePick} />
        </div>

        {/* Max leads */}
        <div>
          <label className="label" htmlFor="extract-max">Max leads</label>
            <div className="flex flex-wrap items-center gap-2">
              <input
                id="extract-max"
                name="maxResults"
                type="number"
                min={10}
                max={MAX_LEADS_HARD_CAP}
                step={10}
                value={maxResults}
                onChange={(e) => {
                  const n = Math.max(10, Math.min(MAX_LEADS_HARD_CAP, Number(e.target.value) || DEFAULT_MAX_LEADS))
                  setMaxResults(n)
                }}
                className="input w-28"
              />
              <div className="flex gap-1.5">
                {MAX_LEAD_PRESETS.map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setMaxResults(n)}
                    className={`text-xs px-2.5 py-1.5 rounded border ${
                      maxResults === n
                        ? 'bg-green-50 border-green-300 text-green-700 dark:bg-green-900/30 dark:border-green-700 dark:text-green-300'
                        : 'bg-white border-gray-200 text-gray-500 dark:bg-gray-900 dark:border-gray-700 dark:text-gray-300'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
        </div>

        {/* Preview / duplicate warning */}
        {preview && (preview.existingInZone > 0 || preview.existingInCategory > 0) && (
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 dark:bg-yellow-900/20 dark:border-yellow-800 p-3 text-xs text-yellow-800 dark:text-yellow-200">
            {preview.existingInZone > 0
              ? <>You already have <b>{preview.existingInZone}</b> {preview.industry} in <b>{preview.zone}</b>. Re-extracting will dedup by phone but still uses API quota.</>
              : <>You already have <b>{preview.existingInCategory}</b> total {preview.industry} (other zones). Re-extracting may overlap.</>}
            {Array.isArray(preview.subCategories) && preview.subCategories.length > 1 && (
              <p className="mt-1 text-[11px] text-yellow-700 dark:text-yellow-300">
                Will fan out into {preview.subCategories.length} sub-queries: {preview.subCategories.slice(0, 6).join(', ')}{preview.subCategories.length > 6 ? '…' : ''}
              </p>
            )}
          </div>
        )}

        {/* Query preview + start */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-end gap-4 pt-2 border-t border-gray-100 dark:border-gray-800">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 mb-1 uppercase tracking-wide font-medium">Search query</p>
            <p className="text-sm text-gray-700 dark:text-gray-200 font-mono bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 truncate">
              {canStart
                ? `"${industry.trim()}" within ${(zonePick.radius / 1000).toFixed(1)}km of ${zonePick.address || `${zonePick.lat.toFixed(3)},${zonePick.lng.toFixed(3)}`} · target ${maxResults}`
                : <span className="text-gray-300">fill in industry and pick a zone…</span>}
            </p>
            <p className="text-[11px] text-gray-400 mt-1">
              Phone-verified businesses are deduped and saved to your <a href="/leads" className="text-green-600 hover:underline">Leads</a>.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
            <button
              onClick={savePreset}
              disabled={presetSaving || !canStart}
              className="text-xs px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900 disabled:opacity-50"
              title="Save as preset for one-click reuse"
            >
              {presetSaving ? 'Saving…' : '☆ Save preset'}
            </button>
            <button
              onClick={startScrape}
              disabled={loading || !canStart || progress?.phase === 'scraping' || progress?.phase === 'saving'}
              className="btn-primary py-2.5 px-6 w-full sm:w-auto justify-center"
            >
              {loading ? 'Queuing…' : '⊕ Start extraction'}
            </button>
          </div>
        </div>
      </div>

      {/* Live progress */}
      {progress && (
        <div className={`card p-4 sm:p-5 mb-5 border-l-4 ${
          progress.phase === 'done'  ? 'border-green-500' :
          progress.phase === 'error' ? 'border-red-500'   : 'border-blue-500'
        }`}>
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <span className="font-medium text-sm text-gray-900 dark:text-gray-100">
                {progress.phase === 'done'     ? '✅ Complete' :
                 progress.phase === 'error'    ? '❌ Failed' :
                 progress.phase === 'cancelled' ? '⏹️ Stopped' :
                 progress.phase === 'cancel_requested' ? '⏹️ Stopping…' :
                 progress.phase === 'scraping' ? '🔍 Querying Google Places…' :
                 progress.phase === 'saving'   ? '💾 Saving to database…' : '⏳ Starting…'}
              </span>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-mono">{progress.zone} · {progress.category}</p>
            </div>
            {progress.phase === 'done' && (
              <span className="text-sm text-green-700 font-mono whitespace-nowrap">{progress.saved} saved</span>
            )}
          </div>

          {(progress.phase === 'scraping' || progress.phase === 'saving') && (
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Found</p>
                <p className="text-sm font-mono text-gray-700">{progress.found || 0}</p>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Saved</p>
                <p className="text-sm font-mono text-gray-700">{progress.saved || 0}</p>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Rate</p>
                <p className="text-sm font-mono text-gray-700">{foundRate.toFixed(2)}/s</p>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-2 py-1.5">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">Elapsed</p>
                <p className="text-sm font-mono text-gray-700">{fmtDuration(elapsedSec)}</p>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 px-2 py-1.5 col-span-2">
                <p className="text-[10px] uppercase tracking-wide text-gray-400">ETA</p>
                <p className="text-sm font-mono text-gray-700">{etaSec !== null ? fmtDuration(etaSec) : 'estimating...'}</p>
              </div>
            </div>
          )}

          {progress.phase !== 'done' && progress.phase !== 'error' && progress.phase !== 'cancelled' && (
            <div className="w-full bg-gray-100 rounded-full h-2">
              {pct !== null ? (
                <div className="h-2 bg-green-500 rounded-full transition-all duration-300" style={{ width: `${pct}%` }} />
              ) : (
                <div className="h-2 bg-green-400 rounded-full animate-pulse w-1/3" />
              )}
            </div>
          )}
          {(progress.phase === 'scraping' || progress.phase === 'saving' || progress.phase === 'starting' || progress.phase === 'cancel_requested') && (
            <button
              type="button"
              onClick={stopScrape}
              disabled={progress.phase === 'cancel_requested'}
              className="mt-3 text-xs px-3 py-1.5 rounded-lg border border-red-300 dark:border-red-700 text-red-700 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 disabled:opacity-60"
            >
              {progress.phase === 'cancel_requested' ? 'Stopping…' : 'Stop extracting'}
            </button>
          )}
          {progress.phase === 'saving' && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-mono">{progress.saved} / {progress.total} leads saved</p>
          )}
          {progress.phase === 'scraping' && progress.found > 0 && (
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 font-mono">{progress.found} businesses found so far…</p>
          )}
          {progress.error && <p className="text-xs text-red-600 mt-2">{progress.error}</p>}

          {progress.jobId && (
            <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs uppercase tracking-wide text-gray-400 dark:text-gray-500 font-medium">Execution timeline</p>
                <span className="text-[11px] font-mono text-gray-400 dark:text-gray-500">
                  {timelineSummaryReturned} / {timelineSummaryTotal} events
                </span>
              </div>
              {timelinePreview.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500">Waiting for timeline events…</p>
              ) : (
                <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
                  {timelinePreview.map((entry, idx) => (
                    <div key={`${entry.at || 'n/a'}-${entry.event || 'event'}-${idx}`} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded border text-[11px] font-mono ${timelineEventTone(entry.event)}`}>
                          {formatTimelineEvent(entry)}
                        </span>
                      </div>
                      <span className="text-[11px] text-gray-400 dark:text-gray-500 whitespace-nowrap font-mono">
                        {formatTimelineClock(entry.at)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {progress.stopReason && (
                <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 font-mono">
                  stop reason: {progress.stopReason}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Past jobs */}
      <div className="card overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="font-serif text-lg text-gray-900 dark:text-gray-100">Extraction history</h3>
          <button
            type="button"
            onClick={refreshJobs}
            className="text-xs px-2.5 py-1.5 rounded border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900"
          >
            Refresh
          </button>
        </div>

        {jobsLoading ? (
          <div className="p-6 text-gray-400 dark:text-gray-500 text-sm">Loading…</div>
        ) : jobs.length === 0 ? (
          <div className="p-8 text-center text-gray-400 dark:text-gray-500 text-sm">No extractions yet. Start your first one above.</div>
        ) : (
          <>
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
                  <tr>
                    {['Zone', 'Category', 'Status', 'Saved', 'Dupes', 'Date'].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                  {jobs.map(job => (
                    <tr key={job._id} className="hover:bg-gray-50 dark:hover:bg-gray-900/40">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{job.zone}</td>
                      <td className="px-4 py-3 text-gray-600 dark:text-gray-300 capitalize">{job.category}</td>
                      <td className="px-4 py-3"><StatusBadge status={job.status} /></td>
                      <td className="px-4 py-3 text-green-700 font-mono">{job.saved}</td>
                      <td className="px-4 py-3 text-gray-400 dark:text-gray-500 font-mono">{job.dupes}</td>
                      <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-xs">{new Date(job.createdAt).toLocaleDateString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="sm:hidden divide-y divide-gray-50 dark:divide-gray-800">
              {jobs.map(job => (
                <div key={job._id} className="px-4 py-3 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 dark:text-gray-100 text-sm">{job.zone}</span>
                    <StatusBadge status={job.status} />
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 capitalize">{job.category}</p>
                  <div className="flex items-center gap-4 text-xs font-mono">
                    <span className="text-green-700">{job.saved} saved</span>
                    <span className="text-gray-400 dark:text-gray-500">{job.dupes} dupes</span>
                    <span className="text-gray-400 dark:text-gray-500 ml-auto">{new Date(job.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
