import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'
import { useAuth } from './useAuth'

let socket = null

const noopSocket = {
  on: () => noopSocket,
  off: () => noopSocket,
  emit: () => noopSocket
}

const baseOptions = {
  path: '/socket.io',
  autoConnect: true
}

function getSocketOptions() {
  if (typeof window === 'undefined') return { url: '', options: baseOptions }

  const origin = window.location.origin
  const port = window.location.port

  // Production build (npm start → public/ on :5000): Socket.IO must use same origin as the page
  if (!import.meta.env.DEV) {
    return {
      url: origin,
      // In production behind reverse proxies, polling is more resilient than direct websocket upgrades.
      options: {
        ...baseOptions,
        transports: ['polling'],
        upgrade: false,
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 1000,
      }
    }
  }

  // Vite dev: UI is on :5173 (or similar), API + Socket.IO on :5000
  if (port && port !== '5000') {
    const host = window.location.hostname || 'localhost'
    const url = import.meta.env.VITE_SOCKET_URL || `http://${host}:5000`
    return {
      url,
      options: {
        ...baseOptions,
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 8,
        reconnectionDelay: 1000
      }
    }
  }

  // Dev with UI already on :5000 (unusual)
  return {
    url: origin,
    options: {
      ...baseOptions,
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1000,
    }
  }
}

function getSocket() {
  if (!socket) {
    const { url, options } = getSocketOptions()
    socket = io(url, options)
    socket.on('connect', () => {
      try {
        const u = JSON.parse(localStorage.getItem('wf_user') || '{}')
        if (u._id) socket.emit('join', String(u._id))
      } catch (_) {}
    })
    socket.on('connect_error', (err) => {
      console.warn('[socket] connect_error:', err?.message || err)
    })
  }
  return socket
}

export function useSocket() {
  const { user } = useAuth()
  const [instance, setInstance] = useState(null)

  useEffect(() => {
    const s = getSocket()
    setInstance(s)
    try {
      const u = user || JSON.parse(localStorage.getItem('wf_user') || '{}')
      if (u._id) s.emit('join', String(u._id))
    } catch (_) {}
  }, [user?._id])

  return instance || noopSocket
}
