import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import api from '../api/client'
import { getRequestErrorMessage } from '../api/errors'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../contexts/ThemeContext'
import './register-page.css'

export default function LoginPage() {
  const { t, i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()
  const { register, handleSubmit, formState: { errors } } = useForm()
  const [loading, setLoading] = useState(false)
  const { login } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const token = hash.get('google_token')
    const userB64 = hash.get('google_user')

    if (token && userB64) {
      try {
        const user = JSON.parse(atob(userB64))
        login(token, user)
        toast.success(`Welcome, ${user.name}!`)
        window.history.replaceState({}, document.title, window.location.pathname)
        navigate('/dashboard')
        return
      } catch {
        toast.error(t('login.failed'))
      }
    }

    const params = new URLSearchParams(window.location.search)
    const googleError = params.get('google_error')
    const verifyPending = params.get('verify_pending')
    const verified = params.get('verified')
    const verifyError = params.get('verify_error')

    if (verifyPending) {
      toast.success('Account created. Check your Gmail inbox for your verification code or verification link.')
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }

    if (verified) {
      toast.success('Email verified. You can now log in.')
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }

    if (verifyError) {
      toast.error(verifyError)
      window.history.replaceState({}, document.title, window.location.pathname)
      return
    }

    if (googleError) {
      toast.error(googleError)
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [login, navigate, t])

  async function onSubmit(data) {
    setLoading(true)
    try {
      const res = await api.post('/auth/login', {
        email: String(data.email || '').trim().toLowerCase(),
        password: String(data.password ?? ''),
      })
      login(res.data.token, res.data.user)
      toast.success(`Welcome, ${res.data.user.name}!`)
      navigate('/dashboard')
    } catch (err) {
      toast.error(getRequestErrorMessage(err, t, 'login.failed'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-shell px-4 py-6 sm:py-8">
      <div className="register-shell-inner flex flex-col min-h-screen">
      <div className="flex justify-end gap-2 mb-4 max-w-sm mx-auto w-full">
        <select
          id="login-language"
          name="language"
          value={(i18n.language || 'en').split('-')[0]}
          onChange={e => i18n.changeLanguage(e.target.value)}
          className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
          aria-label={t('common.language')}
        >
          <option value="en">EN</option>
          <option value="fr">FR</option>
          <option value="ar">AR</option>
        </select>
        <button
          type="button"
          onClick={toggleTheme}
          className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center pb-8">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="font-serif text-4xl text-gray-900 dark:text-gray-100 mb-1">
              Whisp<span className="text-green-600">Flow</span>
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">{t('login.subtitle')}</p>
          </div>

          <div className="card register-card p-6 sm:p-8">
            <h2 className="sr-only">{t('login.title')}</h2>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="label">{t('login.email')}</label>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  className="input"
                  placeholder="you@company.com"
                  autoComplete="email"
                  {...register('email', { required: true })}
                />
                {errors.email && <p className="text-red-500 text-xs mt-1">Required</p>}
              </div>

              <div>
                <label htmlFor="login-password" className="label">{t('login.password')}</label>
                <input
                  id="login-password"
                  name="password"
                  type="password"
                  className="input"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  {...register('password', { required: true })}
                />
                {errors.password && <p className="text-red-500 text-xs mt-1">Required</p>}
                <div className="mt-2 text-right">
                  <Link to="/forgot-password" className="text-xs text-green-600 hover:text-green-700 font-medium">
                    Forgot password?
                  </Link>
                </div>
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
                {loading ? t('common.loading') : t('login.submit')}
              </button>

            </form>
          </div>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
            {t('login.noAccount')}{' '}
            <Link to="/register" className="text-green-600 hover:text-green-700 font-medium">
              {t('login.register')}
            </Link>
          </p>
        </div>
      </div>
      </div>
    </div>
  )
}
