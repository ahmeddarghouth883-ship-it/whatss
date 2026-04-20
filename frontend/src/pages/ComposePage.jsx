import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../api/client'
import MultiFileUploader from '../components/MultiFileUploader'
import { useSocket } from '../hooks/useSocket'

// ── Parse a raw string into an array of phone numbers ─────────────────────
/** International (E.164-style): 7–15 digits after stripping formatting — all countries supported. */
function digitCount(p) {
  return String(p || '').replace(/\D/g, '').length
}

function parsePhones(raw) {
  return raw
    .split(/[\s,;\n]+/)
    .map(p => p.replace(/[^\d+]/g, ''))
    .filter(p => digitCount(p) >= 7 && digitCount(p) <= 15)
}

// ── Phone chip input ───────────────────────────────────────────────────────
function PhoneInput({ phones, setPhones }) {
  const [raw, setRaw] = useState('')
  const inputRef = useRef(null)

  function commit() {
    const parsed = parsePhones(raw)
    if (!parsed.length) return
    setPhones(prev => {
      const next = [...prev]
      for (const p of parsed) if (!next.includes(p)) next.push(p)
      return next
    })
    setRaw('')
  }

  function onKeyDown(e) {
    if (['Enter', ',', ';'].includes(e.key)) { e.preventDefault(); commit() }
    if (e.key === 'Backspace' && !raw && phones.length) setPhones(prev => prev.slice(0, -1))
  }

  function onPaste(e) {
    e.preventDefault()
    const text   = e.clipboardData.getData('text')
    const parsed = parsePhones(text)
    if (parsed.length) {
      setPhones(prev => {
        const next = [...prev]
        for (const p of parsed) if (!next.includes(p)) next.push(p)
        return next
      })
    } else {
      setRaw(prev => prev + text)
    }
  }

  return (
    <div
      className="min-h-[52px] border border-gray-200 rounded-xl p-2 flex flex-wrap gap-1.5 cursor-text focus-within:border-green-400 focus-within:ring-2 focus-within:ring-green-100 transition-all bg-white"
      onClick={() => inputRef.current?.focus()}
    >
      {phones.map(phone => (
        <span key={phone} className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-100 px-2.5 py-1 rounded-lg text-sm font-mono">
          {phone}
          <button type="button" onClick={e => { e.stopPropagation(); setPhones(prev => prev.filter(p => p !== phone)) }}
            className="text-green-400 hover:text-green-700 ml-0.5 leading-none">×</button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="tel"
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={commit}
        onPaste={onPaste}
        placeholder={phones.length ? 'Add more…' : 'Paste numbers worldwide… +212…, +1…, +44…, +971…'}
        className="flex-1 min-w-[200px] outline-none text-sm bg-transparent placeholder-gray-300 py-1 px-1"
      />
    </div>
  )
}

// ── Scheduled jobs mini-list ───────────────────────────────────────────────
function ScheduledList() {
  const [jobs, setJobs] = useState([])

  useEffect(() => {
    api.get('/messages/scheduled').then(r => setJobs(r.data.jobs || [])).catch(() => {})
  }, [])

  async function cancel(id) {
    try {
      await api.delete(`/messages/scheduled/${id}`)
      setJobs(j => j.filter(x => x._id !== id))
      toast.success('Scheduled send cancelled')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Cancel failed')
    }
  }

  if (!jobs.length) return null

  return (
    <div className="card p-4">
      <h3 className="text-sm font-medium text-gray-700 mb-3">Scheduled sends ({jobs.length})</h3>
      <ul className="space-y-2">
        {jobs.map(j => (
          <li key={j._id} className="flex items-center justify-between gap-3 text-xs">
            <div className="min-w-0">
              <p className="font-mono text-gray-700 truncate">
                {j.phones.length} number{j.phones.length > 1 ? 's' : ''} · {new Date(j.scheduledAt).toLocaleString()}
              </p>
              <p className="text-gray-400 truncate">{j.message?.slice(0, 60) || '(no text)'}</p>
            </div>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono flex-shrink-0 ${
              j.status === 'pending'   ? 'bg-yellow-50 text-yellow-700 border border-yellow-200' :
              j.status === 'done'      ? 'bg-green-50 text-green-700 border border-green-200' :
              j.status === 'failed'    ? 'bg-red-50 text-red-700 border border-red-200' :
              j.status === 'cancelled' ? 'bg-gray-100 text-gray-500 border border-gray-200' :
              'bg-blue-50 text-blue-700 border border-blue-200'
            }`}>{j.status}</span>
            {j.status === 'pending' && (
              <button onClick={() => cancel(j._id)}
                className="text-gray-300 hover:text-red-500 transition-colors text-base leading-none flex-shrink-0">×</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Main page ──────────────────────────────────────────────────────────────
const VARS         = ['{{name}}', '{{city}}', '{{business}}']
const MESSAGE_COST = 0.5

// Local datetime string → ISO (for input[type=datetime-local])
function toLocalISO(d) {
  const dt = d ? new Date(d) : new Date()
  dt.setSeconds(0, 0)
  return dt.toISOString().slice(0, 16)
}

export default function ComposePage() {
  const socket = useSocket()

  const [phones,      setPhones]      = useState([])
  const [message,     setMessage]     = useState('')
  const [mediaFiles,  setMediaFiles]  = useState([])
  const [sessionId,   setSessionId]   = useState('')
  const [sessions,    setSessions]    = useState([])
  const [sending,     setSending]     = useState(false)
  const [progress,    setProgress]    = useState(null)
  const [activeJobId, setActiveJobId] = useState('')
  const [scheduleOn,  setScheduleOn]  = useState(false)
  const [scheduleAt,  setScheduleAt]  = useState(() => {
    const d = new Date(); d.setMinutes(d.getMinutes() + 30); return toLocalISO(d)
  })

  useEffect(() => {
    api.get('/whatsapp/sessions').then(r => {
      const ready = r.data.sessions.filter(s => s.status === 'ready')
      setSessions(ready)
      if (ready.length === 1) setSessionId(ready[0].sessionId)
    })
  }, [])

  useEffect(() => {
    const onProgress = d => setProgress(p => p ? { ...p, sent: d.sent, failed: d.failed } : p)
    const onDone     = d => {
      setSending(false)
      setProgress(null)
      setActiveJobId('')
      if (d.failed === 0) toast.success(`✅ All ${d.sent} messages sent!`)
      else toast(`${d.sent} sent · ${d.failed} failed`, { icon: '⚠️' })
    }
    socket.on('direct:progress', onProgress)
    socket.on('direct:done',     onDone)
    return () => { socket.off('direct:progress', onProgress); socket.off('direct:done', onDone) }
  }, [socket])

  useEffect(() => {
    if (!sending) return
    const h = e => { e.preventDefault(); e.returnValue = 'Messages are still being sent. Close anyway?' }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [sending])

  // Fallback for lost/missed socket events: poll job status until it finishes.
  useEffect(() => {
    if (!activeJobId || !sending || scheduleOn) return

    let stopped = false
    const poll = async () => {
      try {
        const r = await api.get(`/messages/direct/${activeJobId}`)
        const job = r.data?.job
        if (!job || stopped) return

        setProgress({
          sent: Number(job.sent) || 0,
          failed: Number(job.failed) || 0,
          total: Number(job.total) || phones.length || 0
        })

        if (job.status === 'done' || job.status === 'failed' || job.status === 'cancelled') {
          setSending(false)
          setActiveJobId('')
          setProgress(null)
          if (job.status === 'done') {
            if ((job.failed || 0) === 0) toast.success(`✅ All ${job.sent || 0} messages sent!`)
            else toast(`${job.sent || 0} sent · ${job.failed || 0} failed`, { icon: '⚠️' })
          } else {
            toast.error(job.error || 'Sending stopped before completion')
          }
        }
      } catch (_) {
        // Keep polling; transient errors are expected during deploy/reconnect.
      }
    }

    poll()
    const id = setInterval(poll, 3000)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [activeJobId, sending, scheduleOn, phones.length])

  async function send() {
    if (!phones.length)    return toast.error('Add at least one phone number')
    if (!message.trim() && mediaFiles.length === 0) return toast.error('Write a message or attach a file')
    if (!sessionId)        return toast.error('Select a WhatsApp session')

    const payload = {
      phones,
      message:    message.trim(),
      sessionId,
      mediaUrls:  mediaFiles.map(f => f.url),
    }

    if (scheduleOn) {
      const scheduledAt = new Date(scheduleAt)
      if (isNaN(scheduledAt) || scheduledAt <= new Date()) return toast.error('Schedule time must be in the future')
      payload.scheduledAt = scheduledAt.toISOString()
    }

    setSending(true)
    if (!scheduleOn) setProgress({ sent: 0, failed: 0, total: phones.length })

    try {
      const r = await api.post('/messages/direct', payload)
      if (r.data.scheduled) {
        toast.success(`⏰ Scheduled for ${new Date(r.data.scheduledAt).toLocaleString()}`)
        setSending(false)
        setActiveJobId('')
        setPhones([])
        setMessage('')
        setMediaFiles([])
      } else {
        setActiveJobId(String(r.data.jobId || ''))
        toast.success(`📨 Sending to ${phones.length} contacts — running in background`, { duration: 4000 })
      }
    } catch (err) {
      setSending(false)
      setProgress(null)
      setActiveJobId('')
      const msg = err.response?.data?.error || 'Failed to send'
      if (err.response?.data?.error === 'INSUFFICIENT_CREDITS') {
        toast.error(`Not enough credits (need ${err.response.data.needed}, have ${err.response.data.have})`)
      } else {
        toast.error(msg)
      }
    }
  }

  const charCount  = message.length
  const creditCost = phones.length * MESSAGE_COST

  return (
    <div className="p-4 sm:p-8 max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900">Send a message</h2>
        <p className="text-sm text-gray-400 mt-0.5">Type any WhatsApp number — no scraping needed.</p>
      </div>

      {/* Live progress banner */}
      {sending && progress && (
        <div className="mb-5 card p-4 border-l-4 border-blue-500 bg-blue-50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full" />
              <span className="text-sm font-medium text-blue-800">Sending in background…</span>
            </div>
            <span className="text-xs text-blue-600 font-mono">
              {progress.sent}/{progress.total}{progress.failed > 0 && ` · ${progress.failed} failed`}
            </span>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
            <div className="h-1.5 bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.round((progress.sent + progress.failed) / progress.total * 100)}%` }} />
          </div>
          <p className="text-xs text-blue-500 mt-1.5">Safe to navigate — the sending continues on the server.</p>
        </div>
      )}

      <div className="space-y-5">

        {/* Phone numbers */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="label mb-0">To</label>
            {phones.length > 0 && (
              <span className="text-xs text-gray-400">
                {phones.length} number{phones.length > 1 ? 's' : ''} · {creditCost} credit{creditCost !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <PhoneInput phones={phones} setPhones={setPhones} />
          <p className="text-xs text-gray-400 mt-1.5">
            Paste any numbers — separate by comma, space or new line.
            Worldwide — include country code, no leading 0 (e.g.{' '}
            <code className="bg-gray-100 px-1 rounded">+212612345678</code>,{' '}
            <code className="bg-gray-100 px-1 rounded">+33612345678</code>). Max 15 digits total.
          </p>
        </div>

        {/* WhatsApp session */}
        <div>
          <label className="label">From (WhatsApp account)</label>
          <select className="input" value={sessionId} onChange={e => setSessionId(e.target.value)}>
            <option value="">Choose your WhatsApp number…</option>
            {sessions.map(s => (
              <option key={s.sessionId} value={s.sessionId}>{s.name} · {s.phone}</option>
            ))}
          </select>
          {sessions.length === 0 && (
            <p className="text-xs text-amber-600 mt-1">
              No session connected. <Link to="/sessions" className="underline">Connect one →</Link>
            </p>
          )}
        </div>

        {/* Message */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="label mb-0">Message</label>
            <span className="text-xs text-gray-400">{charCount} chars</span>
          </div>
          <textarea
            className="input resize-none"
            rows={5}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Hi! We wanted to reach out to you directly…"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {VARS.map(v => (
              <button key={v} type="button" onClick={() => setMessage(m => m + v)}
                className="text-xs bg-gray-100 hover:bg-green-50 hover:text-green-700 text-gray-500 px-2 py-0.5 rounded-full border border-gray-200 hover:border-green-200 transition-colors">
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Multi-file attachment */}
        <div>
          <label className="label">
            Attachments{' '}
            <span className="text-gray-400 font-normal normal-case">(optional — up to 5 files: images, videos, documents)</span>
          </label>
          <MultiFileUploader files={mediaFiles} onChange={setMediaFiles} max={5} />
        </div>

        {/* Schedule toggle */}
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">Schedule for later</p>
              <p className="text-xs text-gray-400">Messages will be sent automatically at the chosen time.</p>
            </div>
            <button
              type="button"
              onClick={() => setScheduleOn(v => !v)}
              className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${scheduleOn ? 'bg-green-500' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${scheduleOn ? 'translate-x-4' : 'translate-x-0'}`} />
            </button>
          </div>

          {scheduleOn && (
            <div>
              <label className="label mb-1">Send at</label>
              <input
                type="datetime-local"
                className="input"
                value={scheduleAt}
                min={toLocalISO(new Date(Date.now() + 60_000))}
                onChange={e => setScheduleAt(e.target.value)}
              />
              <p className="text-xs text-gray-400 mt-1">
                The server checks every 30 s — messages fire within 30 s of the chosen time.
              </p>
            </div>
          )}
        </div>

        {/* Send button */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={send}
            disabled={sending || !phones.length || (!message.trim() && mediaFiles.length === 0) || !sessionId}
            className="btn-primary flex-1 justify-center gap-2 py-3 text-base"
          >
            {sending ? (
              <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Sending…</>
            ) : scheduleOn ? (
              <>⏰ Schedule ({phones.length || 0})</>
            ) : (
              <>
                ✉ Send now
                {phones.length > 0 && (
                  <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">{phones.length}</span>
                )}
              </>
            )}
          </button>
        </div>

        {phones.length > 0 && (
          <p className="text-xs text-center text-gray-400">
            Uses <span className="font-medium text-gray-600">{creditCost} credit{creditCost !== 1 ? 's' : ''}</span>
            {scheduleOn ? ' · Scheduled — safe to close the tab.' : ' · Runs server-side — safe to navigate away.'}
          </p>
        )}
      </div>

      {/* Scheduled jobs list */}
      <div className="mt-8">
        <ScheduledList />
      </div>
    </div>
  )
}
