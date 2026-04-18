import { useEffect, useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import api from '../api/client'
import { useAuth } from '../hooks/useAuth'

export default function Dashboard() {
  const { t, i18n } = useTranslation()
  const { user } = useAuth()
  const [stats, setStats] = useState(null)
  const [msgStats, setMsgStats] = useState(null)
  const [loading, setLoading] = useState(true)

  const firstName = user?.name?.split(' ')[0] || ''

  const greetingKey = useMemo(() => {
    const h = new Date().getHours()
    if (h < 12) return 'dashboard.greeting'
    if (h < 18) return 'dashboard.greetingAfternoon'
    return 'dashboard.greetingEvening'
  }, [])

  useEffect(() => {
    Promise.all([api.get('/leads/stats'), api.get('/messages/analytics')])
      .then(([l, m]) => {
        setStats(l.data)
        setMsgStats(m.data)
      })
      .finally(() => setLoading(false))
  }, [])

  const chartData = msgStats
    ? [
        { name: t('dashboard.chartSent'), value: msgStats.sent, color: '#6b7280' },
        { name: t('dashboard.chartDelivered'), value: msgStats.delivered, color: '#3b82f6' },
        { name: t('dashboard.chartRead'), value: msgStats.read, color: '#8b5cf6' },
        { name: t('dashboard.chartReplied'), value: msgStats.replied, color: '#22c55e' },
        { name: t('dashboard.chartFailed'), value: msgStats.failed, color: '#ef4444' },
      ]
    : []

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full py-24 text-gray-400 dark:text-gray-500 text-sm">
        {t('common.loading')}
      </div>
    )
  }

  const isRtl = (i18n.language || '').startsWith('ar')

  return (
    <div className="p-4 sm:p-8 max-w-6xl" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="mb-6 sm:mb-8">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900 dark:text-gray-100">
          {t(greetingKey, { name: firstName })}
        </h2>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{t('dashboard.subtitle')}</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="stat-card">
          <span className="stat-value text-green-600">{user?.credits?.toLocaleString()}</span>
          <span className="stat-label">{t('dashboard.creditsLeft')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats?.total?.toLocaleString() || 0}</span>
          <span className="stat-label">{t('dashboard.totalLeads')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{stats?.verified?.toLocaleString() || 0}</span>
          <span className="stat-label">{t('dashboard.waVerified')}</span>
        </div>
        <div className="stat-card">
          <span className="stat-value">{msgStats?.replyRate || 0}%</span>
          <span className="stat-label">{t('dashboard.replyRate')}</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
        <div className="card p-4 sm:p-6 lg:col-span-2">
          <h3 className="font-serif text-lg text-gray-900 dark:text-gray-100 mb-4">{t('dashboard.messagePerformance')}</h3>
          {msgStats?.total > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={chartData} barSize={32}>
                <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#6b7280' }} axisLine={false} tickLine={false} width={36} />
                <Tooltip
                  contentStyle={{ border: '1px solid #e5e7eb', borderRadius: 8, fontSize: 12 }}
                  cursor={{ fill: '#f9fafb' }}
                />
                <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, i) => (
                    <Cell key={i} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[200px] flex flex-col items-center justify-center text-gray-400 dark:text-gray-500 text-sm gap-3">
              <span>{t('dashboard.noCampaignData')}</span>
              <Link to="/campaigns" className="btn-primary text-xs py-1.5 px-4 mt-2">
                {t('dashboard.launchFirst')}
              </Link>
            </div>
          )}
        </div>

        <div className="card p-4 sm:p-6">
          <h3 className="font-serif text-lg text-gray-900 dark:text-gray-100 mb-4">{t('dashboard.quickActions')}</h3>
          <div className="space-y-2">
            <Link to="/scrape" className="btn-primary w-full justify-center">
              <svg width="14" height="14" fill="none" viewBox="0 0 24 24" className="me-1">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2" />
                <path d="M21 21-3.5-3.5M11 8v6M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
              {t('dashboard.scrapeZone')}
            </Link>
            <Link to="/campaigns" className="btn-secondary w-full justify-center">
              {t('dashboard.newCampaign')}
            </Link>
            <Link to="/sessions" className="btn-secondary w-full justify-center">
              {t('dashboard.addSession')}
            </Link>
            <Link to="/wallet" className="btn-secondary w-full justify-center">
              {t('dashboard.topUp')}
            </Link>
          </div>

          <div className="mt-5 pt-4 border-t border-gray-100 dark:border-gray-800">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 font-mono uppercase tracking-wide">{t('dashboard.plan')}</p>
            <span className="badge-green text-sm capitalize">{user?.plan}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
