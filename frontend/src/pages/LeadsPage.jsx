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

function formatLastMessaged(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })
}

function websiteHref(raw) {
  if (!raw) return '#'
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
}

function LeadWebsiteCell({ lead }) {
  if (!lead.website) {
    return <span className="text-gray-300 text-xs">—</span>
  }
  const href = websiteHref(lead.website)
  let label = lead.website.replace(/^https?:\/\//i, '')
  if (label.length > 40) label = `${label.slice(0, 22)}…${label.slice(-14)}`
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-xs text-blue-600 hover:underline truncate max-w-[220px] inline-block align-bottom"
      title={lead.website}
      onClick={(e) => e.stopPropagation()}
    >
      {label}
    </a>
  )
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
      const selectedIds = leadIds.map(id => String(id))
      const { data } = await api.post('/campaigns', {
        name,
        message:   form.message,
        sessionId: form.sessionId,
        audience: 'selected',
        leadIds: selectedIds,
        selectedLeadIds: selectedIds,
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
  const [editingLead,   setEditingLead]   = useState(null)   // _id of inline editor row
  const [busyId,        setBusyId]        = useState(null)
  const [waSessions,    setWaSessions]    = useState([])
  const [busyAction,    setBusyAction]    = useState('')

  useEffect(() => {
    api.get('/whatsapp/sessions').then(r => setWaSessions(r.data.sessions || [])).catch(() => {})
  }, [])

  function patchLeadInPlace(id, patch) {
    setLeads(prev => prev.map(l => l._id === id ? { ...l, ...patch } : l))
  }

  async function saveTagsNotes(lead, { tags, notes }) {
    try {
      const r = await api.patch(`/leads/${lead._id}`, { tags, notes })
      patchLeadInPlace(lead._id, r.data.lead)
      toast.success('Saved')
      setEditingLead(null)
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Save failed')
    }
  }

  async function enrichLead(lead) {
    if (!lead.website) return toast.error('Lead has no website for email extraction')
    setBusyId(lead._id)
    try {
      const r = await api.post(`/leads/${lead._id}/enrich`)
      patchLeadInPlace(lead._id, r.data.lead)
      if (r.data.lead?.email) toast.success(`Found email: ${r.data.lead.email}`)
      else toast(`No email on ${new URL(/^https?:/i.test(lead.website) ? lead.website : `https://${lead.website}`).hostname}`)
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Enrichment failed')
    } finally { setBusyId(null) }
  }

  async function verifyWaSelection() {
    if (selected.size === 0) return
    const ready = waSessions.find(s => s.status === 'ready')
    if (!ready) return toast.error('Connect a WhatsApp session first (Sessions page)')
    try {
      const r = await api.post('/whatsapp/verify-numbers', {
        sessionId: ready.sessionId,
        leadIds: [...selected],
      })
      toast.success(`${r.data.verified}/${r.data.checked} are on WhatsApp`)
      loadLeads()
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Verification failed')
    }
  }

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
    api.get('/extract/zones').then(r => setZones(r.data.zones))
    api.get('/extract/categories').then(r => setCats(r.data.categories))
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
    setBusyAction('delete')
    try {
      const ids = [...selected]
      const r = await api.post('/leads/bulk-delete', { ids })
      toast.success(`${r.data.deleted || ids.length} leads deleted`)
      setSelected(new Set())
      loadLeads()
    } catch (e) {
      toast.error(e?.response?.data?.error || 'Delete failed')
    } finally {
      setBusyAction('')
    }
  }
  async function exportSelectedExcel() {
    if (selected.size === 0) return
    setBusyAction('excel')
    try {
      const ids = [...selected]
      const res = await api.post('/leads/export-excel', { ids }, { responseType: 'blob' })
      const blob = res.data instanceof Blob ? res.data : new Blob([res.data])
      const cd = res.headers['content-disposition'] || ''
      const match = cd.match(/filename="?([^";]+)"?/i)
      const filename = match ? match[1] : `leads-export-${new Date().toISOString().slice(0, 10)}.xlsx`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`Exported ${ids.length} lead${ids.length > 1 ? 's' : ''}`)
    } catch (e) {
      let msg = e?.response?.data?.error || e?.message || 'Export failed'
      if (e?.response?.data instanceof Blob) {
        try {
          const txt = await e.response.data.text()
          const parsed = JSON.parse(txt)
          msg = parsed.error || msg
        } catch (_) {}
      }
      toast.error(msg)
    } finally {
      setBusyAction('')
    }
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
          <Link to="/extract" className="btn-primary flex-1 sm:flex-none justify-center">⊕ Extract more</Link>
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
              onClick={exportSelectedExcel}
              disabled={busyAction === 'excel'}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 py-2 px-4 text-sm border border-green-300 text-green-700 hover:bg-green-100 rounded-lg transition-colors disabled:opacity-60"
            >
              {busyAction === 'excel' ? 'Exporting…' : '↓ Export Excel'}
            </button>
            <button
              onClick={verifyWaSelection}
              className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 py-2 px-4 text-sm border border-green-300 text-green-700 hover:bg-green-100 rounded-lg transition-colors"
              title="Check which selected leads have WhatsApp"
            >
              ✓ Verify WA
            </button>
            <button
              onClick={deleteSelected}
              disabled={busyAction === 'delete'}
              className="flex-1 sm:flex-none justify-center py-2 px-4 text-sm border border-red-200 text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-60"
            >
              {busyAction === 'delete' ? 'Deleting…' : 'Delete'}
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
                {['Name', 'Phone', 'Category', 'Zone', 'Website', 'Rating', 'WA', 'Messaged', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">Loading…</td></tr>
              ) : leads.length === 0 ? (
                <tr><td colSpan={10} className="px-4 py-10 text-center text-gray-400">No leads found</td></tr>
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
                  <td className="px-4 py-3 max-w-[240px]"><LeadWebsiteCell lead={lead} /></td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{lead.rating ? `★ ${lead.rating}` : '—'}</td>
                  <td className="px-4 py-3">
                    {lead.whatsappVerified
                      ? <span className="badge-green text-xs">✓ WA</span>
                      : <span className="badge-gray text-xs">—</span>}
                  </td>
                  <td className="px-4 py-3 max-w-[140px]">
                    {lead.lastContacted ? (
                      <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md" title="Last outbound WhatsApp from this app">
                        ✉ {formatLastMessaged(lead.lastContacted)}
                      </span>
                    ) : (
                      <span className="text-gray-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setEditingLead(editingLead === lead._id ? null : lead._id)}
                        className="text-xs text-gray-400 hover:text-gray-700"
                        title="Tags & notes"
                      >
                        ✎
                      </button>
                      {lead.website && (
                        <button
                          onClick={() => enrichLead(lead)}
                          disabled={busyId === lead._id}
                          className="text-xs text-gray-400 hover:text-blue-600 disabled:opacity-40"
                          title={lead.email ? `Email: ${lead.email}` : 'Extract email from website'}
                        >
                          {busyId === lead._id ? '…' : (lead.email ? '✉' : '↗')}
                        </button>
                      )}
                      <button onClick={() => deleteLead(lead._id)} className="text-xs text-gray-300 hover:text-red-500 transition-colors">
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {editingLead && (() => {
                const lead = leads.find(l => l._id === editingLead)
                if (!lead) return null
                let tagsRef = (lead.tags || []).join(', ')
                let notesRef = lead.notes || ''
                return (
                  <tr key={`${editingLead}-edit`} className="bg-yellow-50/40 dark:bg-yellow-900/10 border-b border-yellow-100 dark:border-yellow-900">
                    <td colSpan={10} className="px-4 py-3">
                      <div className="flex flex-col gap-2 max-w-2xl">
                        <p className="text-[11px] text-gray-500 uppercase tracking-wide">Edit {lead.name}</p>
                        <input
                          defaultValue={tagsRef}
                          onChange={(e) => { tagsRef = e.target.value }}
                          placeholder="Tags (comma-separated, e.g. vip, follow-up)"
                          className="input text-xs"
                        />
                        <textarea
                          defaultValue={notesRef}
                          onChange={(e) => { notesRef = e.target.value }}
                          placeholder="Notes…"
                          rows={2}
                          className="input text-xs"
                        />
                        {lead.email && <p className="text-[11px] text-gray-500">Email: <a className="text-blue-600 underline" href={`mailto:${lead.email}`}>{lead.email}</a></p>}
                        <div className="flex gap-2">
                          <button onClick={() => saveTagsNotes(lead, { tags: tagsRef.split(',').map(t => t.trim()).filter(Boolean), notes: notesRef })}
                                  className="btn-primary py-1.5 px-3 text-xs">Save</button>
                          <button onClick={() => setEditingLead(null)}
                                  className="text-xs px-3 py-1.5 rounded border border-gray-200 text-gray-500 hover:bg-gray-50">Cancel</button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })()}
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
                  {lead.website && (
                    <div className="pl-6 pt-1" onClick={(e) => e.stopPropagation()}>
                      <LeadWebsiteCell lead={lead} />
                    </div>
                  )}
                  {lead.lastContacted && (
                    <p className="text-[11px] text-emerald-700 pl-6 pt-0.5">
                      ✉ Messaged {formatLastMessaged(lead.lastContacted)}
                    </p>
                  )}
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
