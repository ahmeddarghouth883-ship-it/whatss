import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../api/client'
import FileUploader from '../components/FileUploader'

// ── Clipboard helper (works on HTTP + HTTPS) ──────────────────────────────────

function writeClipboard(text) {
  if (navigator.clipboard && window.isSecureContext) {
    return navigator.clipboard.writeText(text)
  }
  // Fallback: legacy execCommand (HTTP, older browsers)
  const el = document.createElement('textarea')
  el.value = text
  el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0'
  document.body.appendChild(el)
  el.select()
  document.execCommand('copy')
  document.body.removeChild(el)
  return Promise.resolve()
}

function copyPhone(phone) {
  if (!phone) return
  writeClipboard(phone)
    .then(() => toast.success(`Copied: ${phone}`, { duration: 1500 }))
    .catch(() => toast.error('Copy failed'))
}

function copyPhoneList(phones) {
  if (!phones.length) return toast.error('No numbers to copy')
  const text = phones.filter(Boolean).join('\n')
  writeClipboard(text)
    .then(() => toast.success(`${phones.length} numbers copied to clipboard!`, { duration: 2000 }))
    .catch(() => toast.error('Copy failed'))
}

// ── Tiny copy icon ────────────────────────────────────────────────────────────
function CopyIcon() {
  return (
    <svg width="12" height="12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="9" width="13" height="13" rx="2" strokeLinecap="round"/>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" strokeLinecap="round"/>
    </svg>
  )
}

// ── Quick-send modal ──────────────────────────────────────────────────────────

function QuickSendModal({ leadIds, onClose }) {
  const [sessions,   setSessions]   = useState([])
  const [loading,    setLoading]    = useState(false)
  const [mediaFile,  setMediaFile]  = useState(null)
  const [form, setForm] = useState({ sessionId: '', message: '' })
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    api.get('/whatsapp/sessions')
      .then(r => setSessions(r.data.sessions.filter(s => s.status === 'ready')))
  }, [])

  async function send() {
    if (!form.sessionId) return toast.error('Pick a WhatsApp session first')
    if (!form.message.trim()) return toast.error('Write a message first')
    setLoading(true)
    try {
      // Create campaign with the selected lead IDs
      const name = `Quick send – ${new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}`
      const { data } = await api.post('/campaigns', {
        name,
        message:   form.message,
        sessionId: form.sessionId,
        leadIds,
        mediaUrl:  mediaFile?.url || undefined,
        rateLimit: 20,
      })
      // Immediately launch it
      await api.post(`/campaigns/${data.campaign._id}/send`)
      toast.success(`Sending to ${data.leadCount} contacts!`)
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to send')
    } finally {
      setLoading(false)
    }
  }

  const charCount = form.message.length
  const variables = ['{{name}}', '{{city}}', '{{business}}', '{{category}}']

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-serif text-xl text-gray-900">Send message</h3>
            <p className="text-sm text-gray-400 mt-0.5">To <span className="font-medium text-gray-700">{leadIds.length}</span> selected contacts</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Session */}
          <div>
            <label className="label">WhatsApp account</label>
            <select className="input" value={form.sessionId} onChange={e => set('sessionId', e.target.value)}>
              <option value="">Choose your WhatsApp number…</option>
              {sessions.map(s => (
                <option key={s.sessionId} value={s.sessionId}>
                  {s.name} · {s.phone}
                </option>
              ))}
            </select>
            {sessions.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                No session connected. <Link to="/sessions" className="underline" onClick={onClose}>Connect one first →</Link>
              </p>
            )}
          </div>

          {/* Message */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Your message</label>
              <span className="text-xs text-gray-400">{charCount} chars</span>
            </div>
            <textarea
              className="input resize-none"
              rows={5}
              value={form.message}
              onChange={e => set('message', e.target.value)}
              placeholder={"Hi! We noticed your business and wanted to reach out…"}
              autoFocus
            />
            {/* Variable chips */}
            <div className="flex flex-wrap gap-1.5 mt-2">
              {variables.map(v => (
                <button
                  key={v}
                  type="button"
                  onClick={() => set('message', form.message + v)}
                  className="text-xs bg-gray-100 hover:bg-green-50 hover:text-green-700 text-gray-500 px-2 py-0.5 rounded-full border border-gray-200 hover:border-green-200 transition-colors"
                >
                  {v}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-1.5">
              Variables are replaced with each contact's info automatically.
            </p>
          </div>

          {/* Media (optional) */}
          <div>
            <label className="label">
              Attachment <span className="text-gray-400 font-normal normal-case">(optional)</span>
            </label>
            <FileUploader value={mediaFile} onChange={setMediaFile} />
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-gray-100">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button
            onClick={send}
            disabled={loading || !form.sessionId || !form.message.trim()}
            className="btn-primary flex-1 justify-center gap-2"
          >
            {loading ? (
              <><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"/> Sending…</>
            ) : (
              <>✉ Send now</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function LeadsPage() {
  const [leads,         setLeads]         = useState([])
  const [total,         setTotal]         = useState(0)
  const [page,          setPage]          = useState(1)
  const [loading,       setLoading]       = useState(true)
  const [zones,         setZones]         = useState([])
  const [cats,          setCats]          = useState([])
  const [selected,      setSelected]      = useState(new Set())
  const [showSendModal, setShowSendModal] = useState(false)
  const [filters,       setFilters]       = useState({ zone: '', category: '', verified: '', search: '' })

  const loadLeads = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit: 50 })
      if (filters.zone)     params.set('zone',     filters.zone)
      if (filters.category) params.set('category', filters.category)
      if (filters.verified) params.set('verified', filters.verified)
      if (filters.search)   params.set('search',   filters.search)
      const res = await api.get(`/leads?${params}`)
      setLeads(res.data.leads)
      setTotal(res.data.total)
    } finally {
      setLoading(false)
    }
  }, [page, filters])

  useEffect(() => { loadLeads() }, [loadLeads])
  useEffect(() => {
    api.get('/scrape/zones').then(r => setZones(r.data.zones))
    api.get('/scrape/categories').then(r => setCats(r.data.categories))
  }, [])

  function toggleSelect(id) {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleAll() {
    if (selected.size === leads.length) setSelected(new Set())
    else setSelected(new Set(leads.map(l => l._id)))
  }
  async function deleteLead(id) {
    await api.delete(`/leads/${id}`)
    toast.success('Lead deleted')
    loadLeads()
  }
  async function deleteSelected() {
    if (!confirm(`Delete ${selected.size} leads?`)) return
    await Promise.all([...selected].map(id => api.delete(`/leads/${id}`)))
    toast.success(`${selected.size} leads deleted`)
    setSelected(new Set())
    loadLeads()
  }
  async function exportCSV() {
    const params = new URLSearchParams()
    if (filters.zone)     params.set('zone',     filters.zone)
    if (filters.category) params.set('category', filters.category)
    if (filters.verified) params.set('verified', filters.verified)
    window.open(`/api/leads/export?${params}`, '_blank')
  }

  const pages = Math.ceil(total / 50)
  const hasFilters = filters.zone || filters.category || filters.verified || filters.search
  const numSelected = selected.size

  return (
    <div className="p-4 sm:p-8 max-w-7xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 sm:mb-6">
        <div>
          <h2 className="font-serif text-2xl sm:text-3xl text-gray-900">Leads</h2>
          <p className="text-sm text-gray-500 mt-0.5">{total.toLocaleString()} total contacts</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => copyPhoneList(leads.map(l => l.phone))}
            className="btn-secondary flex-1 sm:flex-none"
          >
            <CopyIcon /> Copy numbers
          </button>
          <button onClick={exportCSV} className="btn-secondary flex-1 sm:flex-none justify-center">
            ↓ Export CSV
          </button>
          <Link to="/scrape" className="btn-primary flex-1 sm:flex-none justify-center">⊕ Scrape more</Link>
        </div>
      </div>

      {/* Selection action bar — appears when leads are checked */}
      {numSelected > 0 && (
        <div className="mb-4 px-4 py-3 bg-green-50 border border-green-200 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <span className="text-sm font-medium text-green-800">
            {numSelected} contact{numSelected > 1 ? 's' : ''} selected
          </span>
          <div className="flex flex-wrap gap-2 w-full sm:w-auto">
            <button
              onClick={() => setShowSendModal(true)}
              className="btn-primary flex-1 sm:flex-none justify-center gap-1.5 py-2 text-sm"
            >
              ✉ Send message
            </button>
            <button
              onClick={() => copyPhoneList(leads.filter(l => selected.has(l._id)).map(l => l.phone))}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 py-2 px-4 text-sm border border-green-300 text-green-700 hover:bg-green-100 rounded-lg transition-colors"
            >
              <CopyIcon /> Copy numbers
            </button>
            <button
              onClick={deleteSelected}
              className="flex-1 sm:flex-none justify-center py-2 px-4 text-sm border border-red-200 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="py-2 px-3 text-sm text-gray-400 hover:text-gray-600 transition-colors"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card p-3 sm:p-4 mb-4 grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-3">
        <input
          className="input col-span-2 sm:w-48"
          placeholder="Search name, phone…"
          value={filters.search}
          onChange={e => { setFilters(f => ({ ...f, search: e.target.value })); setPage(1) }}
        />
        <select
          className="input sm:w-40"
          value={filters.zone}
          onChange={e => { setFilters(f => ({ ...f, zone: e.target.value })); setPage(1) }}
        >
          <option value="">All zones</option>
          {zones.map(z => <option key={z} value={z}>{z}</option>)}
        </select>
        <select
          className="input sm:w-40"
          value={filters.category}
          onChange={e => { setFilters(f => ({ ...f, category: e.target.value })); setPage(1) }}
        >
          <option value="">All categories</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <select
          className="input"
          value={filters.verified}
          onChange={e => { setFilters(f => ({ ...f, verified: e.target.value })); setPage(1) }}
        >
          <option value="">WA: all</option>
          <option value="true">✓ Verified</option>
          <option value="false">Not checked</option>
        </select>
        {hasFilters && (
          <button
            className="btn-secondary text-xs col-span-2 sm:col-span-1"
            onClick={() => { setFilters({ zone:'', category:'', verified:'', search:'' }); setPage(1) }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Table (desktop) / Cards (mobile) */}
      <div className="card overflow-hidden">
        {/* Desktop table */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                <th className="px-4 py-3 w-8">
                  <input
                    type="checkbox"
                    onChange={toggleAll}
                    checked={selected.size === leads.length && leads.length > 0}
                    className="rounded"
                  />
                </th>
                {['Name', 'Phone', 'Category', 'Zone', 'Rating', 'WA', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400">No leads found</td></tr>
              ) : leads.map(lead => (
                <tr key={lead._id} className={`hover:bg-gray-50 transition-colors ${selected.has(lead._id) ? 'bg-green-50' : ''}`}>
                  <td className="px-4 py-3">
                    <input type="checkbox" checked={selected.has(lead._id)} onChange={() => toggleSelect(lead._id)} className="rounded" />
                  </td>
                  <td className="px-4 py-3 font-medium text-gray-900 max-w-[160px] truncate">{lead.name}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => copyPhone(lead.phone)}
                      className="group flex items-center gap-1.5 font-mono text-gray-700 text-xs hover:text-green-700 transition-colors"
                      title={`Click to copy ${lead.phone}`}
                    >
                      {lead.phone}
                      <span className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400">
                        <CopyIcon />
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-3 text-gray-500 capitalize text-xs">{lead.category}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{lead.zone}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{lead.rating ? `★ ${lead.rating}` : '—'}</td>
                  <td className="px-4 py-3">
                    {lead.whatsappVerified
                      ? <span className="badge-green text-xs">✓ WA</span>
                      : <span className="badge-gray text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => deleteLead(lead._id)} className="text-gray-300 hover:text-red-500 text-xs transition-colors">
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="md:hidden">
          {loading ? (
            <div className="p-8 text-center text-gray-400 text-sm">Loading…</div>
          ) : leads.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No leads found</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {leads.map(lead => (
                <div
                  key={lead._id}
                  className={`px-4 py-3 space-y-1 ${selected.has(lead._id) ? 'bg-green-50' : ''}`}
                  onClick={() => toggleSelect(lead._id)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <input type="checkbox" checked={selected.has(lead._id)} onChange={() => toggleSelect(lead._id)} className="rounded flex-shrink-0" onClick={e => e.stopPropagation()} />
                      <span className="font-medium text-gray-900 text-sm leading-tight">{lead.name}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {lead.whatsappVerified
                        ? <span className="badge-green text-xs">✓ WA</span>
                        : <span className="badge-gray text-xs">—</span>}
                      <button onClick={e => { e.stopPropagation(); deleteLead(lead._id) }} className="text-gray-300 hover:text-red-500 text-xs transition-colors">
                        ✕
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); copyPhone(lead.phone) }}
                    className="text-xs font-mono text-gray-600 pl-6 hover:text-green-700 transition-colors flex items-center gap-1.5 group"
                    title={`Click to copy ${lead.phone}`}
                  >
                    {lead.phone}
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity text-gray-400"><CopyIcon /></span>
                  </button>
                  <div className="flex items-center gap-3 text-xs text-gray-400 pl-6">
                    <span className="capitalize">{lead.category}</span>
                    <span>·</span>
                    <span>{lead.zone}</span>
                    {lead.rating && <span>· ★ {lead.rating}</span>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-500">
            <span className="text-xs">Page {page} of {pages}</span>
            <div className="flex gap-2">
              <button className="btn-secondary py-1.5 px-3 text-xs" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                ← Prev
              </button>
              <button className="btn-secondary py-1.5 px-3 text-xs" disabled={page === pages} onClick={() => setPage(p => p + 1)}>
                Next →
              </button>
            </div>
          </div>
        )}
      </div>

      {showSendModal && (
        <QuickSendModal
          leadIds={[...selected]}
          onClose={() => setShowSendModal(false)}
        />
      )}
    </div>
  )
}
