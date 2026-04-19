import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import { useTranslation } from 'react-i18next'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { ThemeProvider } from './contexts/ThemeContext'
import LanguageSync from './components/LanguageSync'

import Layout          from './components/Layout'
import LoginPage       from './pages/LoginPage'
import RegisterPage    from './pages/RegisterPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import LandingPage     from './pages/LandingPage'
import Dashboard       from './pages/Dashboard'
import ScrapePage      from './pages/ScrapePage'
import LeadsPage       from './pages/LeadsPage'
import CampaignsPage   from './pages/CampaignsPage'
import CampaignDetail  from './pages/CampaignDetail'
import InboxPage       from './pages/InboxPage'
import SessionsPage    from './pages/SessionsPage'
import ComposePage     from './pages/ComposePage'
import { WalletPage }  from './pages/WalletPage'
import { SettingsPage } from './pages/WalletPage'
import { AdminPage }   from './pages/WalletPage'

function ProtectedRoute({ children, adminOnly = false }) {
  const { t } = useTranslation()
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-white dark:bg-gray-900">
        <div className="flex flex-col items-center">
          <div className="relative mb-6">
            <div className="w-12 h-12 rounded-full border-[3px] border-gray-100 dark:border-gray-800"></div>
            <div className="w-12 h-12 rounded-full border-[3px] border-green-500 border-t-transparent animate-spin absolute top-0 left-0"></div>
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-4 h-4 bg-green-500/20 rounded-full animate-pulse"></div>
            </div>
          </div>
          <div className="text-gray-500 dark:text-gray-400 font-medium text-sm tracking-widest uppercase">
            {t('common.loading', 'LOADING...')}
          </div>
        </div>
      </div>
    )
  }

  if (!user)   return <Navigate to="/login" state={{ from: location }} replace />
  if (adminOnly && user.role !== 'admin') return <Navigate to="/dashboard" replace />
  return children
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter
          future={{
            v7_startTransition: true,
            v7_relativeSplatPath: true,
          }}
        >
          <LanguageSync />
          <Toaster position="top-right" toastOptions={{ duration: 3500 }} />
          <Routes>
            {/* Public landing page */}
            <Route path="/" element={<LandingPage />} />

            {/* Auth routes */}
            <Route path="/login"    element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />

            {/* App (protected) — single Layout instance shared across all app routes */}
            <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route path="/dashboard"     element={<Dashboard />} />
              <Route path="/scrape"        element={<ScrapePage />} />
              <Route path="/leads"         element={<LeadsPage />} />
              <Route path="/campaigns"     element={<CampaignsPage />} />
              <Route path="/campaigns/:id" element={<CampaignDetail />} />
              <Route path="/inbox"         element={<InboxPage />} />
              <Route path="/compose"       element={<ComposePage />} />
              <Route path="/sessions"      element={<SessionsPage />} />
              <Route path="/wallet"        element={<WalletPage />} />
              <Route path="/settings"      element={<SettingsPage />} />
              <Route path="/admin"         element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  )
}
