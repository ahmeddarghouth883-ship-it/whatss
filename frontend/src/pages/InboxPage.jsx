import { useState, useEffect } from 'react'
import api from '../api/client'
import { useSocket } from '../hooks/useSocket'

export default function InboxPage() {
  const socket = useSocket()
  const [messages, setMessages] = useState([])
  const [total,    setTotal]    = useState(0)
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    api.get('/messages/replies?limit=100')
      .then(r => { setMessages(r.data.messages); setTotal(r.data.total) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onReply = d => {
      setMessages(prev => [{
        phone: d.phone, status: 'replied', repliedAt: new Date(),
        message: d.body, _id: Math.random()
      }, ...prev])
    }
    socket.on('wa:reply', onReply)
    return () => socket.off('wa:reply', onReply)
  }, [socket])

  if (loading) return (
    <div className="flex items-center justify-center h-full py-24 text-gray-400 text-sm">Loading…</div>
  )

  return (
    <div className="p-4 sm:p-8 max-w-4xl">
      <div className="mb-6 sm:mb-8">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900">Inbox</h2>
        <p className="text-sm text-gray-500 mt-1">{total} total replies</p>
      </div>

      {messages.length === 0 ? (
        <div className="card p-10 sm:p-12 text-center text-gray-400 text-sm">
          No replies yet. Replies appear here in real time once your campaigns are sent.
        </div>
      ) : (
        <div className="space-y-2">
          {messages.map(m => (
            <div key={m._id} className="card p-3 sm:p-4 flex items-start gap-3 hover:shadow-md transition-shadow">
              <div className="w-9 h-9 rounded-full bg-green-600 flex items-center justify-center text-white text-sm font-semibold flex-shrink-0">
                {m.phone?.slice(-2)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                  <span className="font-medium text-sm text-gray-900 font-mono">{m.phone}</span>
                  {m.leadId?.name && (
                    <span className="text-xs text-gray-500">· {m.leadId.name}</span>
                  )}
                </div>
                <p className="text-sm text-gray-600 truncate">{m.message || 'Replied to your message'}</p>
                {m.campaignId?.name && (
                  <p className="text-xs text-gray-400 mt-0.5">Campaign: {m.campaignId.name}</p>
                )}
              </div>
              <div className="text-xs text-gray-400 flex-shrink-0 text-right">
                {m.repliedAt ? new Date(m.repliedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
                <p className="text-[10px] text-gray-300">
                  {m.repliedAt ? new Date(m.repliedAt).toLocaleDateString() : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
