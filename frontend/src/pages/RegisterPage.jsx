import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import api from '../api/client'
import { getRequestErrorMessage } from '../api/errors'
import { useAuth } from '../hooks/useAuth'
import { useTheme } from '../contexts/ThemeContext'
import { track } from '../utils/analytics'
import './register-page.css'

export default function RegisterPage() {
  const { t, i18n } = useTranslation()
  const { theme, toggleTheme } = useTheme()

  // Prefill email if the user came from the landing-page hero capture (?email=...)
  const prefilledEmail = (() => {
    if (typeof window === 'undefined') return ''
    try {
      const p = new URLSearchParams(window.location.search)
      return String(p.get('email') || '').trim()
    } catch { return '' }
  })()

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm({
    defaultValues: {
      email: prefilledEmail,
    }
  })
  const [loading, setLoading] = useState(false)
  const [resending, setResending] = useState(false)
  const [step, setStep] = useState('register')
  const [pendingEmail, setPendingEmail] = useState('')
  const [verificationCode, setVerificationCode] = useState('')
  const { login } = useAuth()
  const navigate = useNavigate()
  const isRtl = (i18n.language || '').startsWith('ar')

  useEffect(() => {
    track('register_view', { has_prefill: !!prefilledEmail })
  }, [prefilledEmail])

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const token = hash.get('google_token')
    const userB64 = hash.get('google_user')

    if (token && userB64) {
      try {
        const user = JSON.parse(atob(userB64))
        login(token, user)
        toast.success(t('register.success'))
        window.history.replaceState({}, document.title, window.location.pathname)
        navigate('/dashboard')
        return
      } catch {
        toast.error(t('register.failed'))
      }
    }

    const params = new URLSearchParams(window.location.search)
    const googleError = params.get('google_error')
    if (googleError) {
      toast.error(googleError)
      window.history.replaceState({}, document.title, window.location.pathname)
    }
  }, [login, navigate, t])

  async function onSubmit(data) {
    setLoading(true)
    try {
      const payload = {
        ...data,
        email: String(data.email || '').toLowerCase().trim()
      }

      const res = await api.post('/auth/register', payload)
      // Server returns JWT immediately — log in and skip the email-code step.
      if (res.data?.token && res.data?.user) {
        login(res.data.token, res.data.user)
        toast.success(res?.data?.message || 'Account created.')
        navigate('/dashboard')
        return
      }
      setPendingEmail(payload.email)
      setStep('verify')
      toast.success(res?.data?.message || 'Account created. Check your email for verification code.')
    } catch (err) {
      toast.error(getRequestErrorMessage(err, t, 'register.failed'))
    } finally {
      setLoading(false)
    }
  }

  async function onVerifyCode(e) {
    e.preventDefault()
    if (!pendingEmail || verificationCode.length !== 6) {
      toast.error('Please enter the 6-digit verification code.')
      return
    }

    setLoading(true)
    try {
      const res = await api.post('/auth/verify-email-code', {
        email: pendingEmail,
        code: verificationCode
      })

      toast.success(res?.data?.message || 'Account registered successfully. You can now log in.')
      navigate('/login')
    } catch (err) {
      toast.error(getRequestErrorMessage(err, t, 'register.failed'))
    } finally {
      setLoading(false)
    }
  }

  async function onResendCode() {
    if (!pendingEmail) {
      toast.error('Please register first so we know where to resend the code.')
      return
    }

    setResending(true)
    try {
      const res = await api.post('/auth/resend-verification-code', {
        email: pendingEmail
      })
      toast.success(res?.data?.message || 'A new verification code has been sent.')
    } catch (err) {
      toast.error(getRequestErrorMessage(err, t, 'register.failed'))
    } finally {
      setResending(false)
    }
  }

  return (
    <div
      className="register-shell px-4 py-6 sm:py-10"
      dir={isRtl ? 'rtl' : 'ltr'}
    >
      <div className="register-shell-inner flex flex-col min-h-screen">
      <div className="flex justify-end gap-2 mb-6 max-w-md mx-auto w-full">
        <select
          id="register-language"
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
        <div className="w-full max-w-md register-card-wrap">
          <div className="text-center mb-8">
            <div className="register-badge">
              <span className="register-badge-dot" aria-hidden />
              {t('register.badge')}
            </div>
            <h1 className="register-title text-4xl sm:text-5xl font-semibold mb-2">
              Whisp<span className="text-green-600 dark:text-green-400">Flow</span>
            </h1>
            <p className="text-sm text-gray-600 dark:text-gray-400 max-w-sm mx-auto leading-relaxed">
              {t('register.subtitle')}
            </p>
          </div>

          <div className="register-card p-6 sm:p-9">
            {step === 'register' ? (
              <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
                <div>
                  <label htmlFor="register-name" className="label">{t('register.fullName')}</label>
                  <input
                    id="register-name"
                    name="name"
                    type="text"
                    className="input"
                    autoComplete="name"
                    {...register('name', { required: true })}
                  />
                  {errors.name && <p className="text-red-500 text-xs mt-1">{t('register.nameRequired')}</p>}
                </div>

                <div>
                  <label htmlFor="register-email" className="label">{t('login.email')}</label>
                  <input
                    id="register-email"
                    name="email"
                    type="email"
                    className="input"
                    autoComplete="email"
                    {...register('email', { required: true })}
                  />
                  {errors.email && <p className="text-red-500 text-xs mt-1">{t('register.emailRequired')}</p>}
                </div>

                <div>
                  <label htmlFor="register-company" className="label">{t('register.company')}</label>
                  <input
                    id="register-company"
                    name="company"
                    type="text"
                    className="input"
                    autoComplete="organization"
                    {...register('company')}
                  />
                </div>

                <div>
                  <label htmlFor="register-password" className="label">{t('login.password')}</label>
                  <input
                    id="register-password"
                    name="password"
                    type="password"
                    className="input"
                    autoComplete="new-password"
                    placeholder={t('register.passwordPlaceholder')}
                    {...register('password', { required: true, minLength: 6 })}
                  />
                  {errors.password?.type === 'required' && (
                    <p className="text-red-500 text-xs mt-1">{t('register.passwordRequired')}</p>
                  )}
                  {errors.password?.type === 'minLength' && (
                    <p className="text-red-500 text-xs mt-1">{t('register.passwordMin')}</p>
                  )}
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-3">
                  {loading ? t('register.submitLoading') : t('register.submit')}
                </button>

              </form>
            ) : (
              <form onSubmit={onVerifyCode} className="space-y-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  We sent a 6-digit verification code to <span className="font-medium">{pendingEmail}</span>.
                </p>
                <div>
                  <label htmlFor="register-verification-code" className="label">Verification code</label>
                  <input
                    id="register-verification-code"
                    name="verificationCode"
                    type="text"
                    className="input"
                    placeholder="6-digit code"
                    autoComplete="one-time-code"
                    value={verificationCode}
                    onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>
                <button type="submit" disabled={loading || resending} className="btn-primary w-full justify-center py-2.5">
                  {loading ? 'Verifying...' : 'Verify and complete registration'}
                </button>
                <button
                  type="button"
                  disabled={loading || resending}
                  onClick={onResendCode}
                  className="w-full text-sm text-green-600 hover:text-green-700 font-medium disabled:text-gray-400"
                >
                  {resending ? 'Sending new code...' : 'Resend verification code'}
                </button>
                <button
                  type="button"
                  disabled={loading || resending}
                  onClick={() => setStep('register')}
                  className="w-full text-sm text-gray-500 dark:text-gray-400"
                >
                  Back to registration form
                </button>
              </form>
            )}
          </div>

          <p className="text-center text-sm text-gray-600 dark:text-gray-400 mt-6">
            {t('register.haveAccount')}{' '}
            <Link to="/login" className="text-green-600 dark:text-green-400 hover:text-green-700 font-semibold">
              {t('register.signIn')}
            </Link>
          </p>
        </div>
      </div>
      </div>
    </div>
  )
}