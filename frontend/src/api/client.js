import axios from 'axios'

/** Build full /api base; supports https://backend.com or https://backend.com/api */
function apiBaseFromEnv(raw) {
  const s = String(raw || '').trim().replace(/\/$/, '')
  if (!s) return ''
  return s.endsWith('/api') ? s : `${s}/api`
}

function getApiBaseURL() {
  const fromEnv = apiBaseFromEnv(import.meta.env.VITE_API_URL)
  if (fromEnv) return fromEnv

  if (typeof window === 'undefined') return '/api'

  // Production (same-origin): Express serves both SPA and /api — leave relative.
  if (!import.meta.env.DEV) return '/api'

  // Dev: call backend directly unless VITE_API_URL was set above.
  const host = window.location.hostname || 'localhost'
  return `http://${host}:5000/api`
}

const api = axios.create({
  baseURL: getApiBaseURL(),
  timeout: 30000
})

// Attach JWT token to every request
api.interceptors.request.use(config => {
  const token = localStorage.getItem('wf_token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

// Handle 401 globally — redirect to login
api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      const reqUrl = String(err.config?.url || '')
      const isAuthSubmit = /\/auth\/(login|register|google|forgot-password|reset-password)(\?|$)/.test(reqUrl)
      const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
      const isAuthScreen = currentPath === '/login' || currentPath === '/register' || currentPath === '/forgot-password'
      const hasToken = !!localStorage.getItem('wf_token')
      const apiError = String(err.response?.data?.error || err.response?.data?.message || '').toLowerCase()
      const looksLikeExpiredSession =
        reqUrl.includes('/auth/me') ||
        apiError.includes('invalid or expired token') ||
        apiError.includes('no token provided') ||
        apiError.includes('user not found') ||
        apiError.includes('jwt')

      // Avoid kicking users out for every 401 (e.g. role-gated/optional endpoints).
      // Only force logout when the server indicates the session/token is invalid.
      if (hasToken && looksLikeExpiredSession) {
        localStorage.removeItem('wf_token')
        localStorage.removeItem('wf_user')

        // Let login/register/google handlers display proper error messages.
        if (!isAuthSubmit && !isAuthScreen) {
          window.location.href = '/login'
        }
      }
    }
    return Promise.reject(err)
  }
)

export default api
