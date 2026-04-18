import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../api/client'
import { getRequestErrorMessage } from '../api/errors'
import { useTheme } from '../contexts/ThemeContext'

const passthroughT = (key) => key

export default function ForgotPasswordPage() {
  const { theme, toggleTheme } = useTheme()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')

  async function sendCode(e) {
    e.preventDefault()
    if (!email) return toast.error('Email is required')

    setLoading(true)
    try {
      const res = await api.post('/auth/forgot-password', { email })
      toast.success(res?.data?.message || 'Reset code sent')

      if (res?.data?.emailSent === false) {
        toast.error('Email service is unavailable right now. Please try again later.')
      }

      setStep(2)
    } catch (err) {
      toast.error(getRequestErrorMessage(err, passthroughT, 'Failed to send reset code'))
    } finally {
      setLoading(false)
    }
  }

  async function resetPassword(e) {
    e.preventDefault()
    if (!email || !code || !newPassword) {
      return toast.error('Email, code and new password are required')
    }

    setLoading(true)
    try {
      const res = await api.post('/auth/reset-password', { email, code, newPassword })
      toast.success(res?.data?.message || 'Password updated')
      navigate('/login')
    } catch (err) {
      toast.error(getRequestErrorMessage(err, passthroughT, 'Failed to reset password'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50 dark:bg-gray-950 px-4 py-6 sm:py-8">
      <div className="flex justify-end gap-2 mb-4 max-w-sm mx-auto w-full">
        <button
          type="button"
          onClick={toggleTheme}
          className="text-xs border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
        >
          {theme === 'dark' ? '☀' : '☾'}
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <h1 className="font-serif text-4xl text-gray-900 dark:text-gray-100 mb-1">
              Whisp<span className="text-green-600">Flow</span>
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">Reset your password with a code sent to your email</p>
          </div>

          <div className="card p-6 sm:p-8">
            {step === 1 ? (
              <form onSubmit={sendCode} className="space-y-4">
                <div>
                  <label htmlFor="reset-email" className="label">Email</label>
                  <input
                    id="reset-email"
                    name="email"
                    type="email"
                    className="input"
                    placeholder="you@company.com"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
                  {loading ? 'Sending...' : 'Send reset code'}
                </button>
              </form>
            ) : (
              <form onSubmit={resetPassword} className="space-y-4">
                <div>
                  <label htmlFor="reset-email-verify" className="label">Email</label>
                  <input
                    id="reset-email-verify"
                    name="email"
                    type="email"
                    className="input"
                    value={email}
                    autoComplete="email"
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="reset-code" className="label">Verification code</label>
                  <input
                    id="reset-code"
                    name="verificationCode"
                    type="text"
                    className="input"
                    placeholder="6-digit code"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </div>
                <div>
                  <label htmlFor="reset-new-password" className="label">New password</label>
                  <input
                    id="reset-new-password"
                    name="newPassword"
                    type="password"
                    className="input"
                    placeholder="At least 6 characters"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                </div>

                <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
                  {loading ? 'Resetting...' : 'Reset password'}
                </button>

                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="w-full text-sm text-gray-500 dark:text-gray-400"
                >
                  Send code again
                </button>
              </form>
            )}
          </div>

          <p className="text-center text-sm text-gray-500 dark:text-gray-400 mt-4">
            <Link to="/login" className="text-green-600 hover:text-green-700 font-medium">
              Back to login
            </Link>
          </p>
        </div>
      </div>
    </div>
  )
}
