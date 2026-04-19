import { useEffect, useState, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend,
} from 'recharts'
import api from '../api/client'
import { useAuth } from '../hooks/useAuth'
import { useSocket } from '../hooks/useSocket'

const COSTS = { extraction: 1, message: 0.5 }

function fmtDate(d) {
  if (!d) return ''
  try {
    return new Date(d).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch { return String(d) }
}

function sourceColor(source) {
  if (source === 'extraction') return 'text-amber-600 bg-amber-50 dark:bg-amber-500/10'
  if (source === 'message')    return 'text-sky-600 bg-sky-50 dark:bg-sky-500/10'
  if (source === 'order')      return 'text-green-600 bg-green-50 dark:bg-green-500/10'
  if (source === 'admin')      return 'text-purple-600 bg-purple-50 dark:bg-purple-500/10'
  if (source === 'signup_bonus') return 'text-pink-600 bg-pink-50 dark:bg-pink-500/10'
  return 'text-gray-600 bg-gray-100 dark:bg-gray-700/40'
}

export default function Dashboard() {
  const { t, i18n }      = useTranslation()
  const { user, refreshUser } = useAuth()
  const socket           = useSocket()
  const [walletData, setWalletData] = useState({ credits: 0, plan: null, recent: [], pending: [] })
  const [series, setSeries]         = useState([])
  const [leadStats, setLeadStats]   = useState({ total: 0, verified: 0 })
  const [msgStats, setMsgStats]     = useState({ sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, replyRate: 0 })
  const [loading, setLoading]       = useState(true)

  const firstName = user?.name?.split(' ')[0] || ''

  const greetingKey = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'dashboard.greeting'
    if (h < 18) return 'dashboard.greetingAfternoon'
    return 'dashboard.greetingEvening'
  }, [])

  const reload = useCallback(() => {
    Promise.all([
      api.get('/me/wallet').catch(() => ({ data: { credits: 0, plan: null, recent: [], pending: [] } })),
      api.get('/me/transactions/daily?days=14').catch(() => ({ data: { series: [] } })),
      api.get('/leads/stats').catch(() => ({ data: { total: 0, verified: 0 } })),
      api.get('/messages/analytics').catch(() => ({ data: { sent: 0, delivered: 0, read: 0, replied: 0, failed: 0, replyRate: 0 } })),
    ]).then(([w, d, l, m]) => {
      setWalletData(w.data || {})
      setSeries(d.data?.series || [])
      setLeadStats(l.data || { total: 0, verified: 0 })
      setMsgStats(m.data || {})
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  // Live update on order events from admin.
  useEffect(() => {
    if (!socket) return
    const onApproved = (payload) => {
      toast.success(`Order approved! +${payload.creditsGranted?.toLocaleString?.() || payload.creditsGranted} credits`)
      reload()
      refreshUser?.()
    }
    const onRejected = (payload) => {
      toast.error(`Order rejected${payload.reason ? `: ${payload.reason}` : ''}`)
      reload()
    }
    socket.on('order:approved', onApproved)
    socket.on('order:rejected', onRejected)
    return () => {
      socket.off('order:approved', onApproved)
      socket.off('order:rejected', onRejected)
    }
  }, [socket, reload, refreshUser])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-24 text-gray-400 dark:text-gray-500 text-sm">
        {t('common.loading', 'Loading…')}
      </div>
    )
  }

  const isRtl     = (i18n.language || '').startsWith('ar')
  const credits   = walletData.credits ?? user?.credits ?? 0
  const plan      = walletData.plan
  const planLabel = plan?.label || (user?.plan === 'free' ? 'Free Trial' : (user?.plan || 'Free Trial'))
  const planTotal = plan?.credits || 0
  const usedThisCycle  = Math.max(0, planTotal - credits)
  const usedPct        = planTotal ? Math.min(100, Math.round((usedThisCycle / planTotal) * 100)) : 0

  // Roll up the series for "this week" message vs extraction usage.
  const usedExtraction = series.reduce((s, r) => s + (r.extraction || 0), 0)
  const usedMessage    = series.reduce((s, r) => s + (r.message || 0), 0)
  const toppedUp       = series.reduce((s, r) => s + (r.topup || 0), 0)

  return (
    <div className="p-4 sm:p-8 max-w-6xl" dir={isRtl ? 'rtl' : 'ltr'}>
      {/* Greeting */}
      <div className="mb-6 sm:mb-8">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900 dark:text-gray-100">
          {t(greetingKey, { name: firstName })}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{t('dashboard.subtitle', 'Here is your wallet and outreach activity at a glance.')}</p>
      </div>

      {/* Pending order banner */}
      {walletData.pending?.length > 0 && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              You have {walletData.pending.length} order{walletData.pending.length > 1 ? 's' : ''} awaiting admin approval.
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-300/80 mt-0.5">
              Credits will land in your wallet automatically once approved.
            </p>
          </div>
          <Link to="/wallet" className="text-xs font-medium text-amber-900 dark:text-amber-200 hover:underline">View →</Link>
        </div>
      )}

      {/* Wallet hero card + small stats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="card p-5 sm:p-6 lg:col-span-2 relative overflow-hidden">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="stat-label">Credits remaining</p>
              <p className="font-serif text-4xl sm:text-5xl text-green-600 mt-1 leading-none">
                {Number(credits).toLocaleString()}
              </p>
              <p className="text-xs text-gray-400 mt-2 font-mono">
                ≈ {Math.floor(credits / COSTS.extraction).toLocaleString()} extractions
                &nbsp;·&nbsp;
                {Math.floor(credits / COSTS.message).toLocaleString()} messages
              </p>
            </div>
            <div className="text-right flex-shrink-0">
              <p className="stat-label">Plan</p>
              <p className="font-serif text-lg text-gray-900 dark:text-gray-100 mt-1 capitalize">{planLabel}</p>
              <Link to="/wallet" className="btn-primary text-xs py-1 px-3 mt-2 inline-flex">
                Top up
              </Link>
            </div>
          </div>

          {planTotal > 0 && (
            <div className="mt-5">
              <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
                <span>Used this cycle</span>
                <span className="font-mono">{usedThisCycle.toLocaleString()} / {planTotal.toLocaleString()}</span>
              </div>
              <div className="h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-500"
                  style={{ width: `${usedPct}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:gap-4">
          <div className="stat-card">
            <span className="stat-value text-amber-600">{usedExtraction.toLocaleString()}</span>
            <span className="stat-label">Extractions (14d)</span>
          </div>
          <div className="stat-card">
            <span className="stat-value text-sky-600">{usedMessage.toLocaleString()}</span>
            <span className="stat-label">Msg credits (14d)</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{leadStats.total?.toLocaleString() || 0}</span>
            <span className="stat-label">Total leads</span>
          </div>
          <div className="stat-card">
            <span className="stat-value">{msgStats.replyRate || 0}%</span>
            <span className="stat-label">Reply rate</span>
          </div>
        </div>
      </div>

      {/* Usage chart + recent transactions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6 mb-6 sm:mb-8">
        <div className="card p-4 sm:p-6 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif text-lg text-gray-900 dark:text-gray-100">Credit usage · last 14 days</h3>
            <span className="text-xs text-gray-400 font-mono">+{toppedUp.toLocaleString()} topped up</span>
          </div>
          {series.some(r => r.extraction || r.message || r.topup) ? (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={series} margin={{ top: 5, right: 5, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="extGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#f59e0b" stopOpacity={0.45} />
                    <stop offset="1" stopColor="#f59e0b" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="msgGrad" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0" stopColor="#0ea5e9" stopOpacity={0.45} />
                    <stop offset="1" stopColor="#0ea5e9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="#e5e7eb" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: '#9ca3af' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(d) => d?.slice(5) || d}
                />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} width={36} />
                <Tooltip
                  contentStyle={{ border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                  formatter={(v, name) => [`${v} cr`, name === 'extraction' ? 'Extraction' : name === 'message' ? 'Message' : name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" iconSize={8} />
                <Area type="monotone" dataKey="extraction" stroke="#f59e0b" strokeWidth={2} fill="url(#extGrad)" name="Extraction" />
                <Area type="monotone" dataKey="message"    stroke="#0ea5e9" strokeWidth={2} fill="url(#msgGrad)" name="Message" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 text-sm gap-3">
              <span>No credit activity yet — go extract or send your first message.</span>
              <Link to="/scrape" className="btn-primary text-xs py-1.5 px-4 mt-2">
                Extract leads
              </Link>
            </div>
          )}
        </div>

        <div className="card p-4 sm:p-6">
          <h3 className="font-serif text-lg text-gray-900 dark:text-gray-100 mb-4">Recent activity</h3>
          {(walletData.recent || []).slice(0, 6).length === 0 ? (
            <p className="text-sm text-gray-400">No transactions yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {walletData.recent.slice(0, 6).map(tx => (
                <li key={tx._id} className="flex items-center justify-between gap-2 text-sm">
                  <div className="min-w-0 flex items-center gap-2">
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${sourceColor(tx.source)}`}>
                      {tx.source}
                    </span>
                    <span className="truncate text-gray-700 dark:text-gray-300 text-xs">{tx.description || tx.type}</span>
                  </div>
                  <span className={`font-mono text-xs flex-shrink-0 ${tx.credits > 0 ? 'text-green-600' : 'text-red-500'}`}>
                    {tx.credits > 0 ? '+' : ''}{tx.credits} cr
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link to="/wallet" className="mt-4 block text-xs text-green-600 hover:underline">View all transactions →</Link>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 gap-4 sm:gap-6">
        <div className="card p-4 sm:p-6">
          <h3 className="font-serif text-lg text-gray-900 dark:text-gray-100 mb-4">{t('dashboard.quickActions', 'Quick actions')}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Link to="/scrape" className="btn-primary justify-center">
              Extract leads (1 cr each)
            </Link>
            <Link to="/compose" className="btn-secondary justify-center">
              Send message (0.5 cr)
            </Link>
            <Link to="/campaigns" className="btn-secondary justify-center">
              {t('dashboard.newCampaign', 'New campaign')}
            </Link>
            <Link to="/wallet" className="btn-secondary justify-center">
              {t('dashboard.topUp', 'Top up wallet')}
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
