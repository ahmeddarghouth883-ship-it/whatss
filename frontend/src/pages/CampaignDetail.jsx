import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from 'recharts'
import api from '../api/client'
import { useSocket } from '../hooks/useSocket'

const COLORS = { sent:'#6b7280', delivered:'#3b82f6', read:'#8b5cf6', replied:'#22c55e', failed:'#ef4444' }

export default function CampaignDetail() {
  const { id }       = useParams()
  const socket       = useSocket()
  const [campaign, setCampaign] = useState(null)
  const [stats,    setStats]    = useState(null)
  const [messages, setMessages] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    Promise.all([
      api.get(`/campaigns/${id}`),
      api.get(`/messages/campaign/${id}/stats`)
    ]).then(([c, s]) => {
      setCampaign(c.data.campaign)
      setMessages(c.data.messages)
      setStats(s.data)
    }).finally(() => setLoading(false))
  }, [id])

  useEffect(() => {
    const onProgress = d => {
      if (d.campaignId !== id) return
      setCampaign(c => c ? { ...c, stats: { ...c.stats, sent: d.sent } } : c)
    }
    const onDone = d => {
      if (d.campaignId !== id) return
      setCampaign(c => c ? { ...c, status: 'done' } : c)
    }
    socket.on('campaign:progress', onProgress)
    socket.on('campaign:done',     onDone)
    return () => { socket.off('campaign:progress', onProgress); socket.off('campaign:done', onDone) }
  }, [socket, id])

  if (loading) return (
    <div className="flex items-center justify-center h-full py-24 text-gray-400 text-sm">Loading…</div>
  )
  if (!campaign) return (
    <div className="p-4 sm:p-8 text-gray-400">Campaign not found</div>
  )

  const total    = campaign.stats?.total || 1
  const pieData  = Object.entries(COLORS).map(([key, color]) => ({
    name: key, value: stats?.stats?.[key] || 0, color
  })).filter(d => d.value > 0)

  const scoreNum = stats
    ? Math.round(((stats.stats?.delivered || 0) + (stats.stats?.read || 0) * 2 + (stats.stats?.replied || 0) * 3) / (total * 3) * 100)
    : 0
  const scoreLabel = scoreNum >= 85 ? 'A+' : scoreNum >= 70 ? 'A' : scoreNum >= 55 ? 'B' : scoreNum >= 40 ? 'C' : 'D'

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      {/* Back link */}
      <Link to="/campaigns" className="text-sm text-gray-400 hover:text-gray-600 mb-2 inline-block">
        ← Campaigns
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-6 sm:mb-8">
        <div className="min-w-0 flex-1">
          <h2 className="font-serif text-2xl sm:text-3xl text-gray-900">{campaign.name}</h2>
          <p className="text-sm text-gray-500 mt-1 truncate">{campaign.message}</p>
        </div>
        <div className="flex flex-col items-center bg-green-50 border border-green-100 rounded-xl p-3 sm:p-4 flex-shrink-0">
          <span className="font-serif text-2xl sm:text-3xl text-green-700">{scoreLabel}</span>
          <span className="text-[10px] text-green-600 font-mono mt-0.5">score</span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 sm:gap-3 mb-6 sm:mb-8">
        {[
          { label: 'Total',     value: total,                         color: 'text-gray-900' },
          { label: 'Sent',      value: campaign.stats?.sent || 0,     color: 'text-gray-700' },
          { label: 'Delivered', value: stats?.stats?.delivered || 0,  color: 'text-blue-600' },
          { label: 'Read',      value: stats?.stats?.read || 0,       color: 'text-purple-600' },
          { label: 'Replied',   value: stats?.stats?.replied || 0,    color: 'text-green-600' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <span className={`font-serif text-xl sm:text-2xl ${s.color}`}>{s.value.toLocaleString()}</span>
            <span className="stat-label text-[10px] sm:text-xs">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Charts */}
      {pieData.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 mb-6 sm:mb-8">
          <div className="card p-4 sm:p-6">
            <h3 className="font-serif text-lg mb-4">Status breakdown</h3>
            <ResponsiveContainer width="100%" height={180}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" outerRadius={70} dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-4 sm:p-6">
            <h3 className="font-serif text-lg mb-4">Performance rates</h3>
            <div className="space-y-4">
              {[
                { label: 'Delivery rate', value: stats?.deliveryRate || 0 },
                { label: 'Read rate',     value: stats?.readRate     || 0 },
                { label: 'Reply rate',    value: stats?.replyRate    || 0 },
              ].map(r => (
                <div key={r.label}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-600 text-xs sm:text-sm">{r.label}</span>
                    <span className="font-mono font-medium text-sm">{r.value}%</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2">
                    <div className="h-2 bg-green-500 rounded-full transition-all" style={{ width: `${r.value}%` }} />
                  </div>
                </div>
              ))}
              {stats?.avgReadMinutes && (
                <p className="text-xs text-gray-400 font-mono mt-2">
                  Avg time to read: {stats.avgReadMinutes} min
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Messages table (desktop) / cards (mobile) */}
      {messages.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
            <h3 className="font-serif text-lg text-gray-900">Messages</h3>
          </div>

          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {['Phone', 'Status', 'Sent at', 'Read at', 'Replied at'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {messages.slice(0, 100).map(m => (
                  <tr key={m._id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-mono text-gray-700 text-xs">{m.phone}</td>
                    <td className="px-4 py-3">
                      <span className={`badge text-xs ${
                        m.status === 'replied'   ? 'badge-green' :
                        m.status === 'read'      ? 'bg-purple-100 text-purple-800' :
                        m.status === 'delivered' ? 'badge-blue'  :
                        m.status === 'sent'      ? 'badge-gray'  : 'badge-red'
                      }`}>{m.status}</span>
                    </td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{m.sentAt ? new Date(m.sentAt).toLocaleTimeString() : '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{m.readAt ? new Date(m.readAt).toLocaleTimeString() : '—'}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{m.repliedAt ? new Date(m.repliedAt).toLocaleTimeString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile message cards */}
          <div className="sm:hidden divide-y divide-gray-50">
            {messages.slice(0, 100).map(m => (
              <div key={m._id} className="px-4 py-3 flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-gray-700">{m.phone}</span>
                <span className={`badge text-xs flex-shrink-0 ${
                  m.status === 'replied'   ? 'badge-green' :
                  m.status === 'read'      ? 'bg-purple-100 text-purple-800' :
                  m.status === 'delivered' ? 'badge-blue'  :
                  m.status === 'sent'      ? 'badge-gray'  : 'badge-red'
                }`}>{m.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
