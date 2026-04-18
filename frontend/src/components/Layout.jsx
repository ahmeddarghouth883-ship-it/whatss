import { useState, useEffect } from 'react'
import { Outlet, NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useSocket } from '../hooks/useSocket'
import { useTranslation } from 'react-i18next'
import { useTheme } from '../contexts/ThemeContext'
import AppHeaderBar from './AppHeaderBar'

const NAV_ITEMS = [
  { to: '/dashboard', key: 'nav.dashboard',   icon: <DashIcon /> },
  { to: '/compose',   key: 'nav.compose',     icon: <ComposeIcon /> },
  { to: '/scrape',    key: 'nav.scrape',      icon: <ScrapeIcon /> },
  { to: '/leads',     key: 'nav.leads',       icon: <LeadsIcon /> },
  { to: '/campaigns', key: 'nav.campaigns',   icon: <CampaignIcon /> },
  { to: '/inbox',     key: 'nav.inbox',       icon: <InboxIcon /> },
  { to: '/sessions',  key: 'nav.sessions', icon: <SessionIcon /> },
  { to: '/wallet',    key: 'nav.wallet',      icon: <WalletIcon /> },
  { to: '/settings',  key: 'nav.settings',    icon: <SettingsIcon /> },
]

// Bottom nav shows the 5 most-used items; "More" opens the full sidebar
const BOTTOM_NAV = NAV_ITEMS.slice(0, 5)

export default function Layout() {
  const { t, i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const { user, logout } = useAuth()
  const navigate  = useNavigate()
  const socket    = useSocket()
  const [sidebarOpen,  setSidebarOpen]  = useState(false)
  const [activeSend,   setActiveSend]   = useState(null)   // { sent, total, failed }
  const [activeScrape, setActiveScrape] = useState(null)   // { phase, found, saved, total }

  // ── Global Socket.IO listeners ──────────────────────────────────────────────
  useEffect(() => {
    const onDirectProgress = d => setActiveSend({ sent: d.sent, failed: d.failed, total: d.total })
    const onDirectDone     = d => {
      setActiveSend(null)
      // Brief done flash handled via toast in ComposePage
    }
    const onScrapeStarted  = d => setActiveScrape({ phase: 'scraping', found: 0, saved: 0, ...d })
    const onScrapeFound    = d => setActiveScrape(s => s ? { ...s, found: d.count } : s)
    const onScrapeSaving   = d => setActiveScrape(s => s ? { ...s, phase: 'saving', total: d.total } : s)
    const onScrapeProgress = d => setActiveScrape(s => s ? { ...s, ...d } : s)
    const onScrapeDone     = _d => setActiveScrape(null)
    const onScrapeError    = _d => setActiveScrape(null)
    const onCampaignStart  = d => setActiveSend({ sent: 0, total: d.total, failed: 0, label: d.name })
    const onCampaignProg   = d => setActiveSend(s => s ? { ...s, sent: d.sent, failed: d.failed } : s)
    const onCampaignDone   = _d => setActiveSend(null)
    const onCampaignPause  = _d => setActiveSend(null)

    socket.on('direct:progress',  onDirectProgress)
    socket.on('direct:done',      onDirectDone)
    socket.on('scrape:started',   onScrapeStarted)
    socket.on('scrape:found',     onScrapeFound)
    socket.on('scrape:saving',    onScrapeSaving)
    socket.on('scrape:progress',  onScrapeProgress)
    socket.on('scrape:done',      onScrapeDone)
    socket.on('scrape:error',     onScrapeError)
    socket.on('campaign:started', onCampaignStart)
    socket.on('campaign:progress',onCampaignProg)
    socket.on('campaign:done',    onCampaignDone)
    socket.on('campaign:paused',  onCampaignPause)

    return () => {
      socket.off('direct:progress',  onDirectProgress)
      socket.off('direct:done',      onDirectDone)
      socket.off('scrape:started',   onScrapeStarted)
      socket.off('scrape:found',     onScrapeFound)
      socket.off('scrape:saving',    onScrapeSaving)
      socket.off('scrape:progress',  onScrapeProgress)
      socket.off('scrape:done',      onScrapeDone)
      socket.off('scrape:error',     onScrapeError)
      socket.off('campaign:started', onCampaignStart)
      socket.off('campaign:progress',onCampaignProg)
      socket.off('campaign:done',    onCampaignDone)
      socket.off('campaign:paused',  onCampaignPause)
    }
  }, [socket])

  function handleLogout() {
    logout()
    navigate('/login')
  }

  const closeSidebar = () => setSidebarOpen(false)

  return (
    <div className="flex h-screen bg-gray-50 dark:bg-gray-950 overflow-hidden">

      {/* ── Mobile backdrop ── */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={closeSidebar}
        />
      )}

      {/* ── Sidebar ── */}
      <aside className={[
        'fixed lg:static inset-y-0 left-0 z-40',
        'w-56 flex-shrink-0 bg-white dark:bg-gray-900 border-r border-gray-100 dark:border-gray-800 flex flex-col',
        'transition-transform duration-200 ease-in-out',
        sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
      ].join(' ')}>

        {/* Logo row */}
        <div className="h-16 flex items-center justify-between px-5 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <span className="font-serif text-xl text-gray-900 dark:text-gray-100 select-none">
            Whisp<span className="text-green-600">Flow</span>
          </span>
          <button
            onClick={closeSidebar}
            className="lg:hidden p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
            aria-label="Close menu"
          >
            <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        {/* Nav links */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end
              onClick={closeSidebar}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400'
                    : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
                }`
              }
            >
              <span className="w-5 flex-shrink-0 flex items-center justify-center opacity-80">
                {item.icon}
              </span>
              <span>{t(item.key)}</span>
            </NavLink>
          ))}

          {user?.role === 'admin' && (
            <NavLink
              to="/admin"
              onClick={closeSidebar}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? 'bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-400' : 'text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100'
                }`
              }
            >
              <span className="w-5 flex-shrink-0 flex items-center justify-center">
                <AdminIcon />
              </span>
              <span>{t('nav.admin')}</span>
            </NavLink>
          )}
        </nav>

        {/* User strip */}
        <div className="p-3 border-t border-gray-100 dark:border-gray-800 flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2 px-1">
            <select
              value={(i18n.language || 'en').split('-')[0]}
              onChange={e => i18n.changeLanguage(e.target.value)}
              className="text-xs flex-1 min-w-0 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
              aria-label={t('common.language')}
            >
              <option value="en">EN</option>
              <option value="fr">FR</option>
              <option value="ar">AR</option>
            </select>
            <button
              type="button"
              onClick={toggleTheme}
              className="text-xs shrink-0 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
              title={t('common.theme')}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
          <div className="flex items-center gap-3 px-3 py-2">
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {user?.name?.[0]?.toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-900 dark:text-gray-100 truncate">{user?.name}</p>
              <p className="text-xs text-gray-400 font-mono">{user?.credits?.toLocaleString()} {t('common.credits')}</p>
            </div>
            <button
              onClick={handleLogout}
              title={t('layout.signOut')}
              className="p-1.5 rounded-md text-gray-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
            >
              <LogoutIcon />
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <AppHeaderBar />

        {/* Mobile top bar */}
        <header className="lg:hidden h-14 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between px-2 sm:px-4 flex-shrink-0 z-20 gap-2">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-1 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 transition-colors"
            aria-label="Open menu"
          >
            <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
              <path d="M4 6h16M4 12h16M4 18h10" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
            </svg>
          </button>

          <NavLink to="/dashboard" className="font-serif text-lg text-gray-900 dark:text-gray-100 select-none flex-shrink-0">
            Whisp<span className="text-green-600">Flow</span>
          </NavLink>

          <div className="flex items-center gap-1 sm:gap-2 min-w-0">
            <select
              value={(i18n.language || 'en').split('-')[0]}
              onChange={e => i18n.changeLanguage(e.target.value)}
              className="text-[10px] sm:text-xs max-w-[52px] sm:max-w-none border border-gray-200 dark:border-gray-600 rounded-md px-1 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
              aria-label={t('common.language')}
            >
              <option value="en">EN</option>
              <option value="fr">FR</option>
              <option value="ar">AR</option>
            </select>
            <button type="button" onClick={toggleTheme} className="text-xs p-1.5 rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300" title={t('common.theme')}>{theme === 'dark' ? '☀' : '☾'}</button>
            <span className="text-xs text-gray-400 font-mono hidden xs:block truncate max-w-[3rem] sm:max-w-none">
              {user?.credits?.toLocaleString()} {t('common.cr')}
            </span>
            <div className="w-8 h-8 rounded-full bg-green-600 flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
              {user?.name?.[0]?.toUpperCase()}
            </div>
          </div>
        </header>

        {/* ── Running jobs banner — persists across all pages ── */}
        {(activeSend || activeScrape) && (
          <div className="bg-blue-600 text-white px-4 py-2 flex items-center justify-between gap-3 flex-shrink-0 text-sm z-10">
            <div className="flex items-center gap-2 min-w-0">
              <span className="animate-spin inline-block w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full flex-shrink-0" />
              {activeSend && (
                <span className="truncate">
                  {activeSend.label
                    ? `📨 ${t('layout.sendingCampaign')} "${activeSend.label}"`
                    : `📨 ${t('layout.sendingMessages')}`}
                  {' — '}{activeSend.sent}/{activeSend.total} {t('layout.sent')}
                  {activeSend.failed > 0 && ` · ${activeSend.failed} ${t('layout.failed')}`}
                </span>
              )}
              {activeScrape && !activeSend && (
                <span className="truncate">
                  {activeScrape.phase === 'scraping'
                    ? `🔍 ${t('layout.scrapingFound', { n: activeScrape.found ?? 0 })}`
                    : `💾 ${t('layout.savingLeads', { saved: activeScrape.saved ?? 0, total: activeScrape.total ?? '?' })}`}
                </span>
              )}
            </div>
            <span className="text-blue-200 text-xs flex-shrink-0 hidden sm:block">
              {t('layout.runsInBackground')}
            </span>
          </div>
        )}

        {/* Page content — padded bottom on mobile to clear the bottom nav */}
        <main className="flex-1 overflow-y-auto pb-16 lg:pb-0 bg-gray-50 dark:bg-gray-950">
          <Outlet />
        </main>
      </div>

      {/* ── Bottom tab bar (mobile only) ── */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-20 bg-white dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800 flex safe-bottom">
        {BOTTOM_NAV.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center justify-center py-2 gap-0.5 transition-colors ${
                isActive ? 'text-green-600 dark:text-green-400' : 'text-gray-400 dark:text-gray-500 active:text-gray-300'
              }`
            }
          >
            <span className="w-5 h-5 flex items-center justify-center">{item.icon}</span>
            <span className="text-[9px] font-medium leading-none">{t(item.key)}</span>
          </NavLink>
        ))}

        {/* "More" opens the full sidebar */}
        <button
          onClick={() => setSidebarOpen(true)}
          className="flex-1 flex flex-col items-center justify-center py-2 gap-0.5 text-gray-400 active:text-gray-700 transition-colors"
        >
          <MoreIcon />
          <span className="text-[9px] font-medium leading-none">{t('common.more')}</span>
        </button>
      </nav>
    </div>
  )
}

// ── Icon components ─────────────────────────────────────────────────────────
function DashIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.75"/>
      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.75"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.75"/>
      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.75"/>
    </svg>
  )
}
function ComposeIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <path d="M12 20h9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function ScrapeIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.75"/>
      <path d="m21 21-3.5-3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <path d="M11 8v6M8 11h6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  )
}
function LeadsIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <circle cx="9" cy="7" r="4" stroke="currentColor" strokeWidth="1.75"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  )
}
function CampaignIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" stroke="currentColor" strokeWidth="1.75"/>
      <path d="m22 6-10 7L2 6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
    </svg>
  )
}
function InboxIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round"/>
    </svg>
  )
}
function SessionIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 1.33h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 9a16 16 0 0 0 6 6l.91-.91a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function WalletIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <path d="M20 12V8H6a2 2 0 0 1 0-4h14v4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M4 6v12c0 1.1.9 2 2 2h14v-4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
      <path d="M18 12h.01" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.75"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function AdminIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function LogoutIcon() {
  return (
    <svg width="14" height="14" fill="none" viewBox="0 0 24 24">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
function MoreIcon() {
  return (
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24">
      <circle cx="5" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="12" cy="12" r="1.5" fill="currentColor"/>
      <circle cx="19" cy="12" r="1.5" fill="currentColor"/>
    </svg>
  )
}
