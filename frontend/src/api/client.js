import axios from 'axios'

function getApiBaseURL() {
  if (typeof window === 'undefined') return '/api'
  if (!import.meta.env.DEV) return '/api'
  // In dev, target backend directly to avoid Vite proxy edge-cases.
  const host = window.location.hostname || 'localhost'
  return import.meta.env.VITE_API_URL || `http://${host}:5000/api`
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

      localStorage.removeItem('wf_token')
      localStorage.removeItem('wf_user')

      // Let login/register/google handlers display proper error messages.
      if (!isAuthSubmit && !isAuthScreen) {
        window.location.href = '/login'
      }
    }
    return Promise.reject(err)
  }
)

export default api
