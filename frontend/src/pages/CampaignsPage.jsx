import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../api/client'
import FileUploader from '../components/FileUploader'

function StatusBadge({ status }) {
  const map = { draft:'badge-gray', running:'badge-blue', paused:'badge-yellow', done:'badge-green', failed:'badge-red' }
  return <span className={map[status] || 'badge-gray'}>{status}</span>
}

// ── Variable helper chips ─────────────────────────────────────────────────────

const VARS = ['{{name}}', '{{city}}', '{{business}}', '{{category}}']

function VarChips({ onInsert }) {
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {VARS.map(v => (
        <button
          key={v}
          type="button"
          onClick={() => onInsert(v)}
          className="text-xs bg-gray-100 hover:bg-green-50 hover:text-green-700 text-gray-500 px-2 py-0.5 rounded-full border border-gray-200 hover:border-green-200 transition-colors"
        >
          {v}
        </button>
      ))}
    </div>
  )
}

// ── Create / launch modal ─────────────────────────────────────────────────────

function CreateModal({ onClose, onCreate }) {
  const [loading,   setLoading]   = useState(false)
  const [sessions,  setSessions]  = useState([])
  const [zones,     setZones]     = useState([])
  const [cats,      setCats]      = useState([])
  const [sendNow,   setSendNow]   = useState(true)
  const [mediaFile, setMediaFile] = useState(null)
  const [form, setForm] = useState({
    name: '', message: '', zone: '', category: '', sessionId: '',
    rateLimit: 20, scheduledAt: '',
  })

  useEffect(() => {
    api.get('/whatsapp/sessions').then(r => setSessions(r.data.sessions.filter(s => s.status === 'ready')))
    api.get('/scrape/zones').then(r => setZones(r.data.zones))
    api.get('/scrape/categories').then(r => setCats(r.data.categories))
  }, [])

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))
  const insertVar = v => set('message', form.message + v)

  async function submit() {
    if (!form.message.trim())  return toast.error('Write your message first')
    if (!form.sessionId)       return toast.error('Select a WhatsApp session')
    setLoading(true)
    try {
      const name = form.name.trim() ||
        `Campaign ${new Date().toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}`

      const { data } = await api.post('/campaigns', { ...form, name, mediaUrl: mediaFile?.url || undefined })

      if (sendNow && !form.scheduledAt) {
        await api.post(`/campaigns/${data.campaign._id}/send`)
        toast.success(`Sending to ${data.leadCount} contacts!`)
      } else {
        toast.success(`Campaign saved — ${data.leadCount} leads matched.`)
      }

      onCreate(data.campaign)
      onClose()
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create campaign')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
      <div className="bg-white w-full sm:max-w-lg sm:rounded-2xl rounded-t-2xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100 flex-shrink-0">
          <h3 className="font-serif text-xl text-gray-900">New campaign</h3>
          <button onClick={onClose} className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1">

          {/* Step 1: message (most important — first) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="label mb-0">Your message</label>
              <span className="text-xs text-gray-400">{form.message.length} chars</span>
            </div>
            <textarea
              className="input resize-none"
              rows={5}
              value={form.message}
              onChange={e => set('message', e.target.value)}
              placeholder={"Hi {{name}}! We help businesses in {{city}} grow via WhatsApp. Interested?"}
              autoFocus
            />
            <VarChips onInsert={insertVar} />
            <p className="text-xs text-gray-400 mt-1.5">Variables are auto-filled per contact.</p>
          </div>

          {/* Step 2: session */}
          <div>
            <label className="label">WhatsApp account</label>
            <select className="input" value={form.sessionId} onChange={e => set('sessionId', e.target.value)}>
              <option value="">Choose your WhatsApp number…</option>
              {sessions.map(s => <option key={s.sessionId} value={s.sessionId}>{s.name} · {s.phone}</option>)}
            </select>
            {sessions.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">
                No sessions connected. <Link to="/sessions" className="underline" onClick={onClose}>Add one first →</Link>
              </p>
            )}
          </div>

          {/* Step 3: audience filters */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Zone filter</label>
              <select className="input" value={form.zone} onChange={e => set('zone', e.target.value)}>
                <option value="">All zones</option>
                {zones.map(z => <option key={z} value={z}>{z}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Category filter</label>
              <select className="input" value={form.category} onChange={e => set('category', e.target.value)}>
                <option value="">All categories</option>
                {cats.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>

          {/* Step 4: send timing */}
          <div className="border border-gray-100 rounded-xl p-4 space-y-3 bg-gray-50">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">When to send</p>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="timing"
                checked={sendNow && !form.scheduledAt}
                onChange={() => { setSendNow(true); set('scheduledAt', '') }}
                className="text-green-600"
              />
              <div>
                <span className="text-sm font-medium text-gray-800">Send immediately</span>
                <p className="text-xs text-gray-400">Starts as soon as you click Launch</p>
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="timing"
                checked={!!form.scheduledAt}
                onChange={() => setSendNow(false)}
                className="text-green-600"
              />
              <div className="flex-1">
                <span className="text-sm font-medium text-gray-800">Schedule for later</span>
                {!!form.scheduledAt || !sendNow ? (
                  <input
                    type="datetime-local"
                    className="input mt-1.5"
                    value={form.scheduledAt}
                    onChange={e => set('scheduledAt', e.target.value)}
                  />
                ) : null}
              </div>
            </label>

            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="radio"
                name="timing"
                checked={!sendNow && !form.scheduledAt}
                onChange={() => { setSendNow(false); set('scheduledAt', '') }}
                className="text-green-600"
              />
              <div>
                <span className="text-sm font-medium text-gray-800">Save as draft</span>
                <p className="text-xs text-gray-400">Launch manually from the list</p>
              </div>
            </label>
          </div>

          {/* Advanced (collapsed by default) */}
          <details className="group">
            <summary className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer select-none flex items-center gap-1">
              <span className="group-open:rotate-90 inline-block transition-transform">›</span>
              Advanced options
            </summary>
            <div className="mt-3 space-y-3 pl-3 border-l border-gray-100">
              <div>
                <label className="label">Campaign name <span className="font-normal text-gray-400">(auto-generated if empty)</span></label>
                <input className="input" value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Restaurants Tunis June" />
              </div>
              <div>
                <label className="label">Rate limit <span className="font-normal text-gray-400">(messages / min)</span></label>
                <input type="number" className="input w-32" value={form.rateLimit} min={5} max={60}
                  onChange={e => set('rateLimit', Number(e.target.value))} />
              </div>
              <div>
                <label className="label">Attachment <span className="font-normal text-gray-400">(optional image, video, document)</span></label>
                <FileUploader value={mediaFile} onChange={setMediaFile} />
              </div>
            </div>
          </details>
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-5 border-t border-gray-100 flex-shrink-0">
          <button onClick={onClose} className="btn-secondary flex-1 justify-center">Cancel</button>
          <button
            onClick={submit}
            disabled={loading || !form.sessionId || !form.message.trim()}
            className="btn-primary flex-1 justify-center gap-2"
          >
            {loading ? (
              <><span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full"/> Working…</>
            ) : sendNow && !form.scheduledAt ? (
              '▶ Launch campaign'
            ) : form.scheduledAt ? (
              '🕐 Schedule'
            ) : (
              '💾 Save draft'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Campaign list ─────────────────────────────────────────────────────────────

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [showModal, setShowModal] = useState(false)

  useEffect(() => {
    api.get('/campaigns').then(r => setCampaigns(r.data.campaigns)).finally(() => setLoading(false))
  }, [])

  async function launchCampaign(id) {
    try {
      await api.post(`/campaigns/${id}/send`)
      toast.success('Campaign sending started!')
      setCampaigns(cs => cs.map(c => c._id === id ? { ...c, status: 'running' } : c))
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to start')
    }
  }

  async function pauseCampaign(id) {
    await api.post(`/campaigns/${id}/pause`)
    setCampaigns(cs => cs.map(c => c._id === id ? { ...c, status: 'paused' } : c))
  }

  async function deleteCampaign(id) {
    if (!confirm('Delete this campaign?')) return
    await api.delete(`/campaigns/${id}`)
    setCampaigns(cs => cs.filter(c => c._id !== id))
    toast.success('Campaign deleted')
  }

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6 sm:mb-8">
        <div>
          <h2 className="font-serif text-2xl sm:text-3xl text-gray-900">Campaigns</h2>
          <p className="text-sm text-gray-500 mt-0.5">{campaigns.length} total</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary">
          <span className="hidden sm:inline">✉ </span>New campaign
        </button>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm">Loading…</div>
      ) : campaigns.length === 0 ? (
        <div className="card p-10 sm:p-12 text-center">
          <div className="text-4xl mb-4">✉</div>
          <p className="text-gray-500 font-medium mb-1">No campaigns yet</p>
          <p className="text-gray-400 text-sm mb-5">Create a campaign to send WhatsApp messages to your leads.</p>
          <button onClick={() => setShowModal(true)} className="btn-primary">Create first campaign</button>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map(c => (
            <div key={c._id} className="card p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <Link to={`/campaigns/${c._id}`} className="font-medium text-gray-900 hover:text-green-600 text-sm">
                      {c.name}
                    </Link>
                    <StatusBadge status={c.status} />
                    {c.scheduledAt && (
                      <span className="text-xs text-gray-400 font-mono">
                        🕐 {new Date(c.scheduledAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 truncate max-w-md">{c.message}</p>
                  <div className="flex items-center gap-3 mt-2 text-xs text-gray-400 font-mono flex-wrap">
                    <span>{c.stats?.total ?? 0} leads</span>
                    <span className="text-green-600">{c.stats?.sent ?? 0} sent</span>
                    <span className="text-blue-500">{c.stats?.read ?? 0} read</span>
                    <span className="text-purple-500">{c.stats?.replied ?? 0} replied</span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {c.status === 'draft' && (
                    <button onClick={() => launchCampaign(c._id)} className="btn-primary py-1.5 px-3 text-xs" title="Launch">
                      ▶ Launch
                    </button>
                  )}
                  {c.status === 'running' && (
                    <button onClick={() => pauseCampaign(c._id)} className="btn-secondary py-1.5 px-3 text-xs">
                      ⏸ Pause
                    </button>
                  )}
                  <Link to={`/campaigns/${c._id}`} className="btn-secondary py-1.5 px-3 text-xs">
                    Stats
                  </Link>
                  {c.status !== 'running' && (
                    <button onClick={() => deleteCampaign(c._id)} className="p-1.5 text-gray-300 hover:text-red-500 text-xs transition-colors">
                      ✕
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {showModal && (
        <CreateModal
          onClose={() => setShowModal(false)}
          onCreate={c => setCampaigns(cs => [c, ...cs])}
        />
      )}
    </div>
  )
}
