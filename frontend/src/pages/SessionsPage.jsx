import { useState, useEffect } from 'react'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useSocket } from '../hooks/useSocket'

function StatusDot({ status }) {
  const statusMap = {
    ready:       'bg-green-500',
    connecting:  'bg-yellow-400 animate-pulse',
    qr:          'bg-blue-400 animate-pulse',
    disconnected:'bg-gray-300',
    banned:      'bg-red-500'
  }
  return <span className={`inline-block w-2 h-2 rounded-full flex-shrink-0 ${statusMap[status] || 'bg-gray-300'}`} />
}

export default function SessionsPage() {
  const socket  = useSocket()
  const [sessions,  setSessions]  = useState([])
  const [qrData,    setQrData]    = useState({})
  const [creating,  setCreating]  = useState(false)
  const [loading,   setLoading]   = useState(true)
  const [newName,   setNewName]   = useState('')

  useEffect(() => {
    api
      .get('/whatsapp/sessions')
      .then((r) => {
        const list = r.data.sessions || []
        setSessions(list)
        // QR is also stored server-side — show it even if the socket missed wa:qr (race / refresh).
        setQrData((prev) => {
          const next = { ...prev }
          for (const s of list) {
            if (s.sessionId && s.qrCode) next[s.sessionId] = s.qrCode
          }
          return next
        })
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onQR = d => {
      setQrData(prev => ({ ...prev, [d.sessionId]: d.qr }))
      setSessions(prev => prev.map(s => s.sessionId === d.sessionId ? { ...s, status: 'qr' } : s))
    }
    const onReady = d => {
      setQrData(prev => { const n = { ...prev }; delete n[d.sessionId]; return n })
      setSessions(prev => prev.map(s => s.sessionId === d.sessionId ? { ...s, status: 'ready', phone: d.phone, name: d.name || s.name } : s))
      toast.success(`WhatsApp connected: ${d.phone}`)
    }
    const onDisconnected = d => {
      setSessions(prev => prev.map(s => s.sessionId === d.sessionId ? { ...s, status: 'disconnected' } : s))
    }
    const onError = d => {
      toast.error(d.message || 'WhatsApp session error')
      setSessions(prev =>
        prev.map(s => (s.sessionId === d.sessionId ? { ...s, status: 'disconnected' } : s))
      )
    }
    socket.on('wa:qr',           onQR)
    socket.on('wa:ready',        onReady)
    socket.on('wa:disconnected', onDisconnected)
    socket.on('wa:error',       onError)
    return () => {
      socket.off('wa:qr', onQR)
      socket.off('wa:ready', onReady)
      socket.off('wa:disconnected', onDisconnected)
      socket.off('wa:error', onError)
    }
  }, [socket])

  // Poll while a session is still pairing — picks up qrCode from Mongo if socket missed wa:qr.
  useEffect(() => {
    const needsPoll = sessions.some((s) => s.status === 'connecting' || s.status === 'qr')
    if (!needsPoll) return undefined
    const tick = () => {
      api
        .get('/whatsapp/sessions')
        .then((r) => {
          const list = r.data.sessions || []
          setSessions(list)
          setQrData((prev) => {
            const next = { ...prev }
            for (const s of list) {
              if (s.sessionId && s.qrCode) next[s.sessionId] = s.qrCode
            }
            return next
          })
        })
        .catch(() => {})
    }
    tick()
    const id = window.setInterval(tick, 2500)
    return () => window.clearInterval(id)
  }, [sessions])

  async function createSession() {
    setCreating(true)
    try {
      const res = await api.post('/whatsapp/sessions', { name: newName || undefined })
      const created = res.data.session
      if (!created?.sessionId) {
        toast.error('Invalid server response — try again.')
        return
      }
      const row = {
        ...created,
        name: created.name || newName || created.sessionId,
      }
      setSessions((prev) => [row, ...prev.filter((s) => s.sessionId !== row.sessionId)])
      setNewName('')
      toast.success('Session starting — scan QR when it appears')
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create session')
    } finally {
      setCreating(false)
    }
  }

  async function deleteSession(sessionId) {
    if (!confirm('Disconnect this session?')) return
    await api.delete(`/whatsapp/sessions/${sessionId}`)
    setSessions(prev => prev.filter(s => s.sessionId !== sessionId))
    toast.success('Session disconnected')
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full py-24 text-gray-400 text-sm">Loading…</div>
  )

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="mb-6 sm:mb-8">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900">WhatsApp sessions</h2>
        <p className="text-sm text-gray-500 mt-1">Each session = one connected WhatsApp number for sending.</p>
      </div>

      {/* Add session */}
      <div className="card p-4 sm:p-5 mb-5 flex flex-col sm:flex-row gap-3">
        <input
          className="input flex-1"
          placeholder="Session name (optional)"
          value={newName}
          onChange={e => setNewName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && createSession()}
        />
        <button onClick={createSession} disabled={creating} className="btn-primary justify-center sm:px-6">
          {creating ? 'Starting…' : '+ Add session'}
        </button>
      </div>

      {/* Session list */}
      {sessions.length === 0 ? (
        <div className="card p-10 text-center text-gray-400 text-sm">
          No sessions yet. Add your first WhatsApp number above.
        </div>
      ) : (
        <div className="space-y-4">
          {sessions.map((session, idx) => (
            <div key={session.sessionId || `session-${idx}`} className="card p-4 sm:p-5">
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <StatusDot status={session.status} />
                  <span className="font-medium text-gray-900 text-sm">{session.name || session.sessionId}</span>
                  <span className="text-xs text-gray-400 capitalize font-mono">{session.status}</span>
                  {session.phone && <span className="text-xs text-gray-500 font-mono">+{session.phone}</span>}
                </div>
                <button
                  onClick={() => deleteSession(session.sessionId)}
                  className="text-xs text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                >
                  Disconnect
                </button>
              </div>

              {qrData[session.sessionId] && (
                <div className="border border-gray-100 rounded-xl p-4 bg-gray-50 flex flex-col items-center gap-3">
                  <p className="text-sm text-gray-600 text-center">Scan with WhatsApp on your phone</p>
                  <img src={qrData[session.sessionId]} alt="QR code" className="w-48 h-48 sm:w-52 sm:h-52 rounded-lg" />
                  <p className="text-xs text-gray-400 text-center">WhatsApp → Settings → Linked Devices → Link a device</p>
                </div>
              )}

              {session.status === 'connecting' && !qrData[session.sessionId] && (
                <div className="text-xs text-gray-400 font-mono animate-pulse">Initializing session…</div>
              )}

              {session.status === 'ready' && (
                <div className="flex items-center gap-4 text-xs text-gray-400 font-mono flex-wrap">
                  <span className="text-green-600">✓ Connected and ready to send</span>
                  {session.sentToday > 0 && <span>{session.sentToday} sent today</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
