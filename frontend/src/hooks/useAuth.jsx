import { createContext, useContext, useState, useEffect } from 'react'
import api from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const stored = localStorage.getItem('wf_user')
    const token  = localStorage.getItem('wf_token')
    if (stored && token) {
      setUser(JSON.parse(stored))
      // Refresh user data from server
      api.get('/auth/me').then(r => {
        setUser(r.data.user)
        localStorage.setItem('wf_user', JSON.stringify(r.data.user))
      }).catch(() => logout())
    }
    setLoading(false)
  }, [])

  function login(token, userData) {
    localStorage.setItem('wf_token', token)
    localStorage.setItem('wf_user',  JSON.stringify(userData))
    setUser(userData)
  }

  function logout() {
    localStorage.removeItem('wf_token')
    localStorage.removeItem('wf_user')
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
