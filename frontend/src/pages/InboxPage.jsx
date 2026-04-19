import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useSocket } from '../hooks/useSocket'

function fmtTime(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  const today = new Date()
  const sameDay = dt.toDateString() === today.toDateString()
  if (sameDay) return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  return dt.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
function fmtFull(d) {
  if (!d) return ''
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleString([], { hour: '2-digit', minute: '2-digit' })
}
function initials(s) {
  const v = String(s || '').trim()
  if (!v) return '?'
  const parts = v.split(/\s+/).slice(0, 2)
  return parts.map(p => p[0]).join('').toUpperCase()
}

function StatusTick({ status }) {
  if (status === 'replied' || status === 'read')
    return <span className="text-blue-500 text-xs ml-1">✓✓</span>
  if (status === 'delivered') return <span className="text-gray-400 text-xs ml-1">✓✓</span>
  if (status === 'sent')      return <span className="text-gray-400 text-xs ml-1">✓</span>
  if (status === 'failed')    return <span className="text-red-500 text-xs ml-1" title="Failed">!</span>
  return null
}

function ThreadRow({ thread, active, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={[
        'w-full text-left px-3 py-3 flex items-start gap-3 border-l-2 transition-colors',
        active
          ? 'bg-green-50 dark:bg-green-900/20 border-green-500'
          : 'bg-white dark:bg-gray-900 border-transparent hover:bg-gray-50 dark:hover:bg-gray-800/60',
      ].join(' ')}
    >
      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
        {initials(thread.contactName || thread.phone)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
            {thread.contactName || thread.phone}
          </p>
          <span className="text-[11px] text-gray-400 flex-shrink-0">{fmtTime(thread.lastAt)}</span>
        </div>
        <div className="flex items-center justify-between gap-2 mt-0.5">
          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
            {thread.lastDirection === 'out' && <span className="text-gray-400">You: </span>}
            {thread.lastMessage || <span className="italic text-gray-300">No content</span>}
          </p>
          {thread.unreadCount > 0 && (
            <span className="bg-green-500 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5 min-w-[18px] text-center flex-shrink-0">
              {thread.unreadCount}
            </span>
          )}
        </div>
        {thread.contactName && thread.contactName !== thread.phone && (
          <p className="text-[10px] text-gray-400 font-mono truncate mt-0.5">{thread.phone}</p>
        )}
      </div>
    </button>
  )
}

function Bubble({ item }) {
  const isOut = item.direction === 'out'
  return (
    <div className={`flex ${isOut ? 'justify-end' : 'justify-start'} mb-1`}>
      <div
        className={[
          'max-w-[75%] px-3 py-2 rounded-2xl text-sm shadow-sm',
          isOut
            ? 'bg-green-500 text-white rounded-br-sm'
            : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-100 dark:border-gray-700 rounded-bl-sm',
        ].join(' ')}
      >
        {item.mediaUrl && item.mediaType === 'image' && (
          <img src={item.mediaUrl} alt="" className="rounded-lg mb-1 max-h-48" />
        )}
        {item.mediaUrl && item.mediaType !== 'image' && (
          <a href={item.mediaUrl} target="_blank" rel="noreferrer"
             className={isOut ? 'underline text-white/90' : 'underline text-blue-600'}>
            Open attachment
          </a>
        )}
        {item.body && <p className="whitespace-pre-wrap break-words">{item.body}</p>}
        <div className={`text-[10px] mt-1 ${isOut ? 'text-white/70' : 'text-gray-400'} text-right flex items-center justify-end`}>
          {fmtFull(item.at)}
          {isOut && <StatusTick status={item.status} />}
        </div>
      </div>
    </div>
  )
}

export default function InboxPage() {
  const socket = useSocket()
  const [threads,    setThreads]    = useState([])
  const [search,     setSearch]     = useState('')
  const [unreadOnly, setUnreadOnly] = useState(false)
  const [active,     setActive]     = useState(null)   // phone string
  const [thread,     setThread]     = useState(null)   // { phone, contactName, items: [] }
  const [loading,    setLoading]    = useState(true)
  const [loadingThread, setLoadingThread] = useState(false)
  const [reply,      setReply]      = useState('')
  const [sending,    setSending]    = useState(false)
  const [sessions,   setSessions]   = useState([])
  const [sessionId,  setSessionId]  = useState('')
  const scrollRef = useRef(null)

  const debouncedSearch = useDebounce(search, 350)

  const loadThreads = useCallback(async () => {
    try {
      const params = {}
      if (debouncedSearch) params.search = debouncedSearch
      if (unreadOnly) params.unread = '1'
      const r = await api.get('/inbox/threads', { params })
      setThreads(r.data.threads || [])
    } catch (err) {
      // silent — keep current view
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, unreadOnly])

  useEffect(() => { loadThreads() }, [loadThreads])

  useEffect(() => {
    api.get('/whatsapp/sessions').then(r => {
      const ready = (r.data.sessions || []).filter(s => s.status === 'ready')
      setSessions(ready)
      if (ready.length > 0) setSessionId(ready[0].sessionId)
    }).catch(() => {})
  }, [])

  const loadThread = useCallback(async (phone) => {
    if (!phone) return
    setLoadingThread(true)
    try {
      const r = await api.get(`/inbox/threads/${encodeURIComponent(phone)}`)
      setThread(r.data)
      // Mark as read
      api.post(`/inbox/threads/${encodeURIComponent(phone)}/read`).catch(() => {})
      setThreads(ts => ts.map(t => t.phone === phone ? { ...t, unreadCount: 0 } : t))
    } catch (err) {
      toast.error('Could not load conversation')
    } finally {
      setLoadingThread(false)
    }
  }, [])

  useEffect(() => {
    if (active) loadThread(active)
    else setThread(null)
  }, [active, loadThread])

  // Auto-scroll to bottom of conversation
  useEffect(() => {
    if (scrollRef.current && thread?.items?.length) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [thread?.items?.length, active])

  // Live socket updates
  useEffect(() => {
    if (!socket) return
    const onReply = (d) => {
      if (!d?.phone) return
      // If this thread is open, append
      if (active && d.phone === active) {
        setThread(t => t ? {
          ...t,
          items: [...t.items, {
            _id: `live-${Date.now()}`,
            direction: 'in',
            body: d.body || '',
            mediaType: d.mediaType || null,
            at: new Date(),
            read: true,
          }],
        } : t)
        api.post(`/inbox/threads/${encodeURIComponent(d.phone)}/read`).catch(() => {})
      }
      // Always refresh thread list (cheap, gives us new ordering & unread count)
      loadThreads()
    }
    socket.on('wa:reply', onReply)
    return () => socket.off('wa:reply', onReply)
  }, [socket, active, loadThreads])

  async function send() {
    if (!reply.trim()) return
    if (!active) return
    if (!sessionId) return toast.error('No connected WhatsApp session')

    setSending(true)
    const text = reply.trim()
    setReply('')
    // Optimistic bubble
    const optimistic = {
      _id: `tmp-${Date.now()}`,
      direction: 'out',
      body: text,
      status: 'sent',
      at: new Date(),
    }
    setThread(t => t ? { ...t, items: [...t.items, optimistic] } : t)

    try {
      await api.post(`/inbox/threads/${encodeURIComponent(active)}/reply`, {
        sessionId, message: text,
      })
      loadThreads()
    } catch (err) {
      const msg = err.response?.data?.error || 'Failed to send'
      toast.error(msg === 'INSUFFICIENT_CREDITS'
        ? 'Not enough credits — top up your wallet'
        : msg)
      // Mark optimistic message as failed
      setThread(t => t ? {
        ...t,
        items: t.items.map(i => i._id === optimistic._id ? { ...i, status: 'failed' } : i),
      } : t)
    } finally {
      setSending(false)
    }
  }

  const totalUnread = useMemo(
    () => threads.reduce((s, t) => s + (t.unreadCount || 0), 0),
    [threads],
  )

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 sm:px-6 py-3 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="font-serif text-xl sm:text-2xl text-gray-900 dark:text-gray-100">Inbox</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {threads.length} conversation{threads.length !== 1 ? 's' : ''} ·{' '}
            {totalUnread > 0
              ? <span className="text-green-600 font-medium">{totalUnread} unread</span>
              : 'All read'}
          </p>
        </div>
        {sessions.length === 0 && (
          <Link to="/sessions" className="text-xs text-amber-600 hover:underline">
            No connected number — connect one →
          </Link>
        )}
      </div>

      <div className="flex-1 flex overflow-hidden">
        {/* Left pane: thread list */}
        <aside className={[
          'w-full sm:w-80 lg:w-96 border-r border-gray-100 dark:border-gray-800 flex flex-col flex-shrink-0',
          active ? 'hidden sm:flex' : 'flex',
        ].join(' ')}>
          <div className="p-3 border-b border-gray-100 dark:border-gray-800 space-y-2">
            <input
              type="search"
              placeholder="Search by name, phone or message…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input text-sm"
            />
            <label className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 cursor-pointer">
              <input
                type="checkbox"
                checked={unreadOnly}
                onChange={e => setUnreadOnly(e.target.checked)}
                className="rounded"
              />
              Show only unread
            </label>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-gray-50 dark:divide-gray-800">
            {loading ? (
              <div className="p-6 text-center text-gray-400 text-sm">Loading…</div>
            ) : threads.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">
                No conversations yet.<br/>
                Replies to your WhatsApp messages will appear here.
              </div>
            ) : (
              threads.map(t => (
                <ThreadRow
                  key={t.phone}
                  thread={t}
                  active={active === t.phone}
                  onClick={() => setActive(t.phone)}
                />
              ))
            )}
          </div>
        </aside>

        {/* Right pane: conversation */}
        <section className={[
          'flex-1 flex flex-col bg-gray-50 dark:bg-gray-950',
          !active ? 'hidden sm:flex' : 'flex',
        ].join(' ')}>
          {!active ? (
            <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
              Select a conversation to view messages
            </div>
          ) : (
            <>
              {/* Thread header */}
              <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center gap-3 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => setActive(null)}
                  className="sm:hidden p-1.5 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100"
                  aria-label="Back"
                >
                  ←
                </button>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-green-500 to-emerald-600 flex items-center justify-center text-white text-xs font-semibold flex-shrink-0">
                  {initials(thread?.contactName || active)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                    {thread?.contactName || active}
                  </p>
                  <p className="text-xs text-gray-400 font-mono truncate">+{active}</p>
                </div>
                {thread?.lead?._id && (
                  <Link to="/leads" className="text-xs text-green-600 hover:underline whitespace-nowrap">
                    View lead →
                  </Link>
                )}
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6">
                {loadingThread ? (
                  <p className="text-center text-gray-400 text-sm">Loading…</p>
                ) : !thread?.items?.length ? (
                  <p className="text-center text-gray-400 text-sm">No messages in this conversation yet.</p>
                ) : (
                  thread.items.map(item => <Bubble key={item._id} item={item} />)
                )}
              </div>

              {/* Reply composer */}
              <div className="border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 p-3 flex items-end gap-2 flex-shrink-0">
                {sessions.length > 1 && (
                  <select
                    value={sessionId}
                    onChange={e => setSessionId(e.target.value)}
                    className="text-xs border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-2 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200"
                  >
                    {sessions.map(s => (
                      <option key={s.sessionId} value={s.sessionId}>+{s.phone}</option>
                    ))}
                  </select>
                )}
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                  }}
                  rows={1}
                  placeholder={sessions.length === 0 ? 'Connect a WhatsApp session first…' : 'Type a reply… (Enter to send, Shift+Enter for newline)'}
                  disabled={sessions.length === 0 || sending}
                  className="input flex-1 resize-none text-sm py-2 max-h-32"
                />
                <button
                  onClick={send}
                  disabled={!reply.trim() || sending || sessions.length === 0}
                  className="btn-primary px-4 py-2 text-sm flex-shrink-0 disabled:opacity-50"
                >
                  {sending ? '…' : 'Send'}
                </button>
              </div>
              <p className="text-[10px] text-gray-400 text-center px-3 pb-2 -mt-1">
                Each reply costs 0.5 credits
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

function useDebounce(value, delay) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), delay)
    return () => clearTimeout(id)
  }, [value, delay])
  return v
}
