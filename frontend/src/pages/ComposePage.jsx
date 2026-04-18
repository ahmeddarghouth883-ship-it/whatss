import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../api/client'
import FileUploader from '../components/FileUploader'
import { useSocket } from '../hooks/useSocket'

// ── Parse a raw string into an array of phone numbers ────────────────────────
function parsePhones(raw) {
  return raw
    .split(/[\s,;\n]+/)
    .map(p => p.replace(/[^\d+]/g, ''))
    .filter(p => p.length >= 7)
}

// ── Phone chip input ──────────────────────────────────────────────────────────
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
    if (['Enter', ',', ';'].includes(e.key)) {
      e.preventDefault()
      commit()
    }
    if (e.key === 'Backspace' && !raw && phones.length) {
      setPhones(prev => prev.slice(0, -1))
    }
  }

  function onPaste(e) {
    e.preventDefault()
    const text = e.clipboardData.getData('text')
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

  function remove(phone) {
    setPhones(prev => prev.filter(p => p !== phone))
  }

  return (
    <div
      className="min-h-[52px] border border-gray-200 rounded-xl p-2 flex flex-wrap gap-1.5 cursor-text focus-within:border-green-400 focus-within:ring-2 focus-within:ring-green-100 transition-all bg-white"
      onClick={() => inputRef.current?.focus()}
    >
      {phones.map(phone => (
        <span
          key={phone}
          className="inline-flex items-center gap-1 bg-green-50 text-green-700 border border-green-100 px-2.5 py-1 rounded-lg text-sm font-mono"
        >
          {phone}
          <button
            type="button"
            onClick={e => { e.stopPropagation(); remove(phone) }}
            className="text-green-400 hover:text-green-700 ml-0.5 leading-none"
          >
            ×
          </button>
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
        placeholder={phones.length ? 'Add more…' : 'Type or paste numbers… +33612345678, +21698765432, …'}
        className="flex-1 min-w-[200px] outline-none text-sm bg-transparent placeholder-gray-300 py-1 px-1"
      />
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

const VARS = ['{{name}}', '{{city}}', '{{business}}']

export default function ComposePage() {
  const socket = useSocket()

  const [phones,     setPhones]     = useState([])
  const [message,    setMessage]    = useState('')
  const [mediaFile,  setMediaFile]  = useState(null)
  const [sessionId,  setSessionId]  = useState('')
  const [sessions,   setSessions]   = useState([])
  const [sending,    setSending]    = useState(false)
  const [progress,   setProgress]   = useState(null)  // { sent, failed, total }

  useEffect(() => {
    api.get('/whatsapp/sessions').then(r => {
      const ready = r.data.sessions.filter(s => s.status === 'ready')
      setSessions(ready)
      if (ready.length === 1) setSessionId(ready[0].sessionId)
    })
  }, [])

  // ── Real-time progress via Socket.IO ────────────────────────────────────────
  useEffect(() => {
    const onProgress = d => setProgress(p => p ? { ...p, sent: d.sent, failed: d.failed } : p)
    const onDone = d => {
      setSending(false)
      setProgress(null)
      setPhones([])
      setMessage('')
      setMediaFile(null)
      if (d.failed === 0) {
        toast.success(`✅ All ${d.sent} messages sent!`)
      } else {
        toast(`${d.sent} sent · ${d.failed} failed`, { icon: '⚠️' })
      }
    }
    socket.on('direct:progress', onProgress)
    socket.on('direct:done',     onDone)
    return () => {
      socket.off('direct:progress', onProgress)
      socket.off('direct:done',     onDone)
    }
  }, [socket])

  // ── Warn before closing the browser tab while sending ───────────────────────
  useEffect(() => {
    if (!sending) return
    const handler = e => {
      e.preventDefault()
      e.returnValue = 'Messages are still being sent. Close anyway?'
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [sending])

  function insertVar(v) {
    setMessage(m => m + v)
  }

  async function send() {
    if (!phones.length) return toast.error('Add at least one phone number')
    if (!message.trim()) return toast.error('Write a message first')
    if (!sessionId)      return toast.error('Select a WhatsApp session')

    setSending(true)
    setProgress({ sent: 0, failed: 0, total: phones.length })

    try {
      await api.post('/messages/direct', {
        phones,
        message:  message.trim(),
        sessionId,
        mediaUrl: mediaFile?.url || undefined,
      })
      toast.success(`📨 Sending to ${phones.length} contacts — running in background`, { duration: 4000 })
    } catch (err) {
      setSending(false)
      setProgress(null)
      toast.error(err.response?.data?.error || 'Failed to send')
    }
  }

  const charCount  = message.length
  const creditCost = phones.length

  return (
    <div className="p-4 sm:p-8 max-w-2xl">
      {/* Header */}
      <div className="mb-6">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900">Send a message</h2>
        <p className="text-sm text-gray-400 mt-0.5">
          Type any WhatsApp number — no scraping needed.
        </p>
      </div>

      {/* Live progress banner (non-blocking) */}
      {sending && progress && (
        <div className="mb-5 card p-4 border-l-4 border-blue-500 bg-blue-50">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full" />
              <span className="text-sm font-medium text-blue-800">
                Sending in background…
              </span>
            </div>
            <span className="text-xs text-blue-600 font-mono">
              {progress.sent}/{progress.total}
              {progress.failed > 0 && ` · ${progress.failed} failed`}
            </span>
          </div>
          <div className="w-full bg-blue-100 rounded-full h-1.5 overflow-hidden">
            <div
              className="h-1.5 bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${Math.round((progress.sent + progress.failed) / progress.total * 100)}%` }}
            />
          </div>
          <p className="text-xs text-blue-500 mt-1.5">
            Safe to navigate — the sending continues on the server.
          </p>
        </div>
      )}

      <div className="space-y-5">

        {/* Phone numbers */}
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="label mb-0">To</label>
            {phones.length > 0 && (
              <span className="text-xs text-gray-400">
                {phones.length} number{phones.length > 1 ? 's' : ''} · {creditCost} credit{creditCost > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <PhoneInput phones={phones} setPhones={setPhones} />
          <p className="text-xs text-gray-400 mt-1.5">
            Paste any numbers — separate by comma, space or new line. Include the country code (e.g. <code className="bg-gray-100 px-1 rounded">+21698765432</code>).
          </p>
        </div>

        {/* WhatsApp session */}
        <div>
          <label className="label">From (WhatsApp account)</label>
          <select
            className="input"
            value={sessionId}
            onChange={e => setSessionId(e.target.value)}
          >
            <option value="">Choose your WhatsApp number…</option>
            {sessions.map(s => (
              <option key={s.sessionId} value={s.sessionId}>
                {s.name} · {s.phone}
              </option>
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
            rows={6}
            value={message}
            onChange={e => setMessage(e.target.value)}
            placeholder="Hi! We wanted to reach out to you directly…"
          />
          <div className="flex flex-wrap gap-1.5 mt-2">
            {VARS.map(v => (
              <button
                key={v}
                type="button"
                onClick={() => insertVar(v)}
                className="text-xs bg-gray-100 hover:bg-green-50 hover:text-green-700 text-gray-500 px-2 py-0.5 rounded-full border border-gray-200 hover:border-green-200 transition-colors"
              >
                {v}
              </button>
            ))}
          </div>
        </div>

        {/* Attachment */}
        <div>
          <label className="label">
            Attachment{' '}
            <span className="text-gray-400 font-normal normal-case">(optional — image, video, document)</span>
          </label>
          <FileUploader value={mediaFile} onChange={setMediaFile} />
        </div>

        {/* Send button */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={send}
            disabled={sending || !phones.length || !message.trim() || !sessionId}
            className="btn-primary flex-1 justify-center gap-2 py-3 text-base"
          >
            {sending ? (
              <><span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" /> Sending…</>
            ) : (
              <>
                ✉ Send now
                {phones.length > 0 && (
                  <span className="bg-white/20 text-white text-xs px-2 py-0.5 rounded-full">
                    {phones.length}
                  </span>
                )}
              </>
            )}
          </button>
        </div>

        {phones.length > 0 && (
          <p className="text-xs text-center text-gray-400">
            Uses <span className="font-medium text-gray-600">{creditCost} credit{creditCost > 1 ? 's' : ''}</span> · Runs server-side — safe to navigate away.
          </p>
        )}
      </div>
    </div>
  )
}
