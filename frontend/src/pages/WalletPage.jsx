// ─── WalletPage / SettingsPage / AdminPage ─────────────────────────────────
import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import api from '../api/client'
import { useAuth } from '../hooks/useAuth'

// Common helpers ------------------------------------------------------------

const PAYMENT_METHODS = [
  { id: 'bank_transfer', label: 'Bank transfer' },
  { id: 'd17',           label: 'D17 mobile payment' },
  { id: 'wise',          label: 'Wise / Revolut' },
  { id: 'cash',          label: 'Cash on delivery' },
]

function fmtDate(d) {
  if (!d) return ''
  try { return new Date(d).toLocaleString() } catch { return String(d) }
}

function StatusBadge({ status }) {
  const map = {
    pending:   'bg-amber-100 text-amber-800',
    approved:  'bg-green-100 text-green-700',
    rejected:  'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-600',
  }
  return (
    <span className={`text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${map[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  )
}

// ─── BuyPlanModal ─────────────────────────────────────────────────────────
function BuyPlanModal({ plan, onClose, onSubmitted }) {
  const isCustom = !!plan?.isCustom || plan?.code === 'enterprise'
  const [paymentMethod, setPaymentMethod]       = useState('bank_transfer')
  const [paymentReference, setPaymentReference] = useState('')
  const [notes, setNotes]                       = useState('')
  const [submitting, setSubmitting]             = useState(false)

  if (!plan) return null

  async function handleSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    try {
      const { data } = await api.post('/orders', {
        planCode:        plan.code,
        paymentMethod:   isCustom ? 'manual' : paymentMethod,
        paymentReference,
        notes,
      })
      toast.success(isCustom ? 'Request received — our team will contact you.' : 'Order submitted — awaiting admin approval.')
      onSubmitted?.(data.order)
      onClose()
    } catch (err) {
      toast.error(err?.response?.data?.error || err.message || 'Failed to submit order')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 rounded-2xl max-w-md w-full p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <p className="text-xs text-gray-400 uppercase tracking-wide font-mono">{isCustom ? 'Contact us' : 'Order plan'}</p>
            <h3 className="font-serif text-2xl text-gray-900 dark:text-gray-100 mt-1">{plan.label}</h3>
            <p className="text-sm text-gray-500 mt-1">
              {isCustom
                ? 'Tell us about your needs — our team will get back within 24h.'
                : `${plan.priceTnd} TND ≈ $${plan.priceUsd} USD · grants ${plan.credits?.toLocaleString?.() || plan.credits} credits`}
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">×</button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          {!isCustom && (
            <>
              <div>
                <label className="label">Payment method</label>
                <select className="input" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)}>
                  {PAYMENT_METHODS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Payment reference</label>
                <input
                  className="input"
                  placeholder="Transfer ID, D17 phone, last 4 digits…"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                />
                <p className="text-[11px] text-gray-400 mt-1">Helps the admin match your transfer to this order.</p>
              </div>
            </>
          )}

          <div>
            <label className="label">{isCustom ? 'Tell us about your project' : 'Notes (optional)'}</label>
            <textarea
              className="input min-h-[80px]"
              placeholder={isCustom ? 'Volume, country, integrations needed…' : ''}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              required={isCustom}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-outline flex-1">Cancel</button>
            <button type="submit" disabled={submitting} className="btn-primary flex-1">
              {submitting ? 'Submitting…' : isCustom ? 'Send request' : 'Submit order'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── WalletPage ────────────────────────────────────────────────────────────
export function WalletPage() {
  const { user, refreshUser } = useAuth()
  const [search]              = useSearchParams()
  const [walletData, setWalletData] = useState({ credits: 0, plan: null, recent: [], pending: [] })
  const [transactions, setTransactions] = useState([])
  const [plans, setPlans]               = useState([])
  const [orders, setOrders]             = useState([])
  const [loading, setLoading]           = useState(true)
  const [buyingPlan, setBuyingPlan]     = useState(null)

  const reload = useCallback(() => {
    Promise.all([
      api.get('/me/wallet').catch(() => ({ data: { credits: 0, plan: null, recent: [], pending: [] } })),
      api.get('/me/transactions?limit=50').catch(() => ({ data: { items: [] } })),
      api.get('/plans').catch(() => ({ data: { plans: [] } })),
      api.get('/orders').catch(() => ({ data: { orders: [] } })),
    ]).then(([w, t, p, o]) => {
      setWalletData(w.data || {})
      setTransactions(t.data?.items || [])
      setPlans(p.data?.plans || [])
      setOrders(o.data?.orders || [])
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  // Auto-open buy modal when ?plan= is in URL (coming from landing).
  useEffect(() => {
    const target = search.get('plan')
    if (!target || !plans.length) return
    const match = plans.find(p => p.code === target)
    if (match && !buyingPlan) setBuyingPlan(match)
  }, [search, plans, buyingPlan])

  const credits = walletData.credits ?? user?.credits ?? 0
  const plan    = walletData.plan
  const planLabel = plan?.label || (user?.plan ? user.plan : 'Free Trial')

  return (
    <div className="p-4 sm:p-8 max-w-5xl">
      <div className="mb-6 sm:mb-8">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900 dark:text-gray-100">Wallet</h2>
        <p className="text-sm text-gray-500 mt-1">1 extraction = 1 credit · 1 message = 0.5 credit</p>
      </div>

      {/* Balance / plan summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="card p-4 sm:p-6 col-span-2">
          <p className="stat-label">Credits remaining</p>
          <p className="font-serif text-4xl sm:text-5xl text-green-600 mt-1">{Number(credits).toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-1 font-mono">≈ {Math.floor(credits)} extractions or {Math.floor(credits / 0.5)} messages</p>
        </div>
        <div className="card p-4 sm:p-6">
          <p className="stat-label">Current plan</p>
          <p className="font-serif text-xl sm:text-2xl text-gray-900 dark:text-gray-100 mt-1 capitalize">{planLabel}</p>
        </div>
        <div className="card p-4 sm:p-6">
          <p className="stat-label">Pending orders</p>
          <p className="font-serif text-xl sm:text-2xl text-gray-900 dark:text-gray-100 mt-1">{orders.filter(o => o.status === 'pending').length}</p>
        </div>
      </div>

      {/* Plan upgrade */}
      <div className="card p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="font-serif text-lg mb-1">Buy credits</h3>
        <p className="text-xs text-gray-500 mb-4">
          After you submit, an admin reviews your transfer and credits land in your wallet automatically.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {plans.map(p => {
            const isFree    = p.code === 'free_trial'
            const isCustom  = !!p.isCustom || p.code === 'enterprise'
            const isPopular = p.code === 'pro'
            return (
              <div
                key={p.code}
                className={`relative border rounded-xl p-4 transition-colors ${
                  isPopular ? 'border-green-400 ring-1 ring-green-100' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                {isPopular && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-green-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                    Popular
                  </span>
                )}
                <p className="font-medium text-sm text-gray-900 dark:text-gray-100">{p.label}</p>
                <p className="font-serif text-2xl text-gray-900 dark:text-gray-100 mt-1">
                  {isCustom ? 'Custom' : isFree ? 'Free' : `${p.priceTnd}`}
                  {!isCustom && !isFree && <span className="text-xs font-sans text-gray-500"> TND</span>}
                </p>
                <p className="text-[11px] text-gray-400 font-mono">
                  {isCustom ? 'tailored pack' : isFree ? 'one-time' : `${p.credits.toLocaleString()} credits`}
                </p>
                <p className="text-xs text-gray-500 mt-2 leading-snug">{p.blurb}</p>
                {isFree ? (
                  <p className="text-xs text-green-600 mt-3 font-medium">Granted on signup</p>
                ) : (
                  <button
                    onClick={() => setBuyingPlan(p)}
                    className="btn-primary w-full mt-3 py-1.5 text-xs justify-center"
                  >
                    {isCustom ? 'Contact us' : `Get ${p.label}`}
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* My orders */}
      <div className="card overflow-hidden mb-6 sm:mb-8">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
          <h3 className="font-serif text-lg">My orders</h3>
          <span className="text-xs text-gray-400 font-mono">{orders.length} total</span>
        </div>
        {orders.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No orders yet.</div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {orders.map(o => (
              <div key={o._id} className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{o.planLabel || o.planCode}</p>
                    <StatusBadge status={o.status} />
                  </div>
                  <p className="text-xs text-gray-400 font-mono mt-0.5">
                    {fmtDate(o.createdAt)}{o.paymentReference ? ` · ref ${o.paymentReference}` : ''}
                  </p>
                  {o.rejectionReason && <p className="text-xs text-red-500 mt-1">Reason: {o.rejectionReason}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  {!!o.creditsToGrant && <p className="font-mono text-sm text-green-600">+{o.creditsToGrant.toLocaleString()} cr</p>}
                  {!!o.priceTnd && <p className="text-xs text-gray-500 font-mono">{o.priceTnd} TND</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Transaction history */}
      <div className="card overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-800">
          <h3 className="font-serif text-lg">Transaction history</h3>
        </div>
        {loading ? (
          <div className="p-6 text-gray-400 text-sm">Loading…</div>
        ) : transactions.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No transactions yet.</div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {transactions.map(t => (
              <div key={t._id} className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 dark:text-gray-200 truncate">{t.description || `${t.source} ${t.type}`}</p>
                  <p className="text-xs text-gray-400 font-mono">{fmtDate(t.createdAt)} · {t.source}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  {t.credits !== 0 && (
                    <p className={`text-sm font-mono font-medium ${t.credits > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {t.credits > 0 ? '+' : ''}{t.credits} cr
                    </p>
                  )}
                  {t.balanceAfter != null && (
                    <p className="text-[10px] text-gray-400 font-mono">bal {Number(t.balanceAfter).toLocaleString()}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {buyingPlan && (
        <BuyPlanModal
          plan={buyingPlan}
          onClose={() => setBuyingPlan(null)}
          onSubmitted={() => { reload(); refreshUser?.() }}
        />
      )}
    </div>
  )
}

// ─── SettingsPage ──────────────────────────────────────────────────────────

export function SettingsPage() {
  const { user }   = useAuth()
  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: { name: user?.name, company: user?.company, phone: user?.phone }
  })
  const [saving, setSaving] = useState(false)

  async function onSubmit(data) {
    setSaving(true)
    try {
      await api.put('/users/profile', data)
      toast.success('Profile updated')
    } catch {
      toast.error('Failed to update')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-4 sm:p-8 max-w-xl">
      <div className="mb-6 sm:mb-8">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900 dark:text-gray-100">Settings</h2>
      </div>

      <div className="card p-4 sm:p-6">
        <h3 className="font-serif text-lg mb-4">Profile</h3>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div>
            <label className="label">Full name</label>
            <input className="input" {...register('name', { required: true })} />
            {errors.name && <p className="text-red-500 text-xs mt-1">Name is required</p>}
          </div>
          <div>
            <label className="label">Company</label>
            <input className="input" {...register('company')} placeholder="Optional" />
          </div>
          <div>
            <label className="label">Phone</label>
            <input className="input" {...register('phone')} placeholder="+216 …" />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input bg-gray-50 text-gray-400" value={user?.email} disabled readOnly />
          </div>
          <button type="submit" disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ─── AdminPage ─────────────────────────────────────────────────────────────

const ADMIN_TABS = [
  { id: 'orders',       label: 'Pending orders' },
  { id: 'users',        label: 'Users' },
  { id: 'transactions', label: 'Transactions' },
  { id: 'audit',        label: 'Audit log' },
]

export function AdminPage() {
  const [tab, setTab] = useState('orders')
  const [stats,  setStats]  = useState(null)
  const [users,  setUsers]  = useState([])
  const [txns,   setTxns]   = useState([])
  const [orders, setOrders] = useState([])
  const [audit,  setAudit]  = useState([])
  const [loading,setLoading]= useState(true)
  const [creditsInput, setCreditsInput] = useState({})
  const [rejectReason, setRejectReason] = useState({})

  const reload = useCallback(() => {
    Promise.all([
      api.get('/admin/stats').catch(() => ({ data: {} })),
      api.get('/admin/users?limit=100').catch(() => ({ data: { users: [] } })),
      api.get('/admin/transactions?limit=50').catch(() => ({ data: { transactions: [] } })),
      api.get('/admin/orders?limit=100').catch(() => ({ data: { orders: [] } })),
      api.get('/admin/audit?limit=50').catch(() => ({ data: { items: [] } })),
    ]).then(([s, u, t, o, a]) => {
      setStats(s.data)
      setUsers(u.data?.users || [])
      setTxns(t.data?.transactions || [])
      setOrders(o.data?.orders || [])
      setAudit(a.data?.items || [])
    }).finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  async function approveOrder(orderId) {
    try {
      await api.post(`/admin/orders/${orderId}/approve`)
      toast.success('Order approved — credits granted to user')
      reload()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to approve')
    }
  }

  async function rejectOrder(orderId) {
    const reason = (rejectReason[orderId] || '').trim()
    if (!reason) { toast.error('Please provide a reason'); return }
    try {
      await api.post(`/admin/orders/${orderId}/reject`, { reason })
      toast.success('Order rejected — user notified')
      setRejectReason(prev => ({ ...prev, [orderId]: '' }))
      reload()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to reject')
    }
  }

  async function addCredits(userId) {
    const amt = Number(creditsInput[userId] || 0)
    if (!amt) return
    try {
      await api.post(`/admin/users/${userId}/topup`, { credits: amt, description: 'Admin top-up' })
      toast.success(`${amt} credits ${amt > 0 ? 'added' : 'removed'}`)
      setCreditsInput(prev => ({ ...prev, [userId]: '' }))
      reload()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update credits')
    }
  }

  async function toggleUser(userId, isActive) {
    try {
      await api.put(`/admin/users/${userId}`, { isActive: !isActive })
      reload()
    } catch (err) {
      toast.error(err?.response?.data?.error || 'Failed to update')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full py-24 text-gray-400 text-sm">Loading…</div>
  )

  const pendingOrders = orders.filter(o => o.status === 'pending')

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <div className="mb-6 sm:mb-8">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900 dark:text-gray-100">Admin</h2>
      </div>

      {/* Platform stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {[
          { label: 'Users',          value: stats?.users },
          { label: 'Leads',          value: stats?.leads },
          { label: 'Messages',       value: stats?.messages },
          { label: 'Active today',   value: stats?.activeToday },
          { label: 'Pending orders', value: stats?.pendingOrders, accent: stats?.pendingOrders > 0 },
        ].map(s => (
          <div key={s.label} className={`stat-card ${s.accent ? 'ring-1 ring-amber-300' : ''}`}>
            <span className="stat-value">{s.value?.toLocaleString() || 0}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 dark:border-gray-800 mb-4 overflow-x-auto">
        {ADMIN_TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-green-500 text-green-700 font-medium'
                : 'border-transparent text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
            }`}
          >
            {t.label}
            {t.id === 'orders' && pendingOrders.length > 0 && (
              <span className="ml-2 inline-flex items-center justify-center text-[10px] font-bold bg-amber-100 text-amber-800 rounded-full px-2 py-0.5">
                {pendingOrders.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Pending orders tab */}
      {tab === 'orders' && (
        <div className="card overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h3 className="font-serif text-lg">Orders awaiting review</h3>
          </div>
          {pendingOrders.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No pending orders right now.</div>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {pendingOrders.map(o => (
                <div key={o._id} className="px-4 sm:px-6 py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
                        {o.userId?.name} <span className="text-gray-400 font-normal">· {o.userId?.email}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        Wants <span className="font-medium text-gray-800 dark:text-gray-200">{o.planLabel || o.planCode}</span>
                        {o.priceTnd ? ` for ${o.priceTnd} TND` : ''}
                        {o.creditsToGrant ? ` (+${o.creditsToGrant.toLocaleString()} credits)` : ''}
                      </p>
                      <p className="text-xs text-gray-400 mt-1 font-mono">
                        {fmtDate(o.createdAt)} · {o.paymentMethod}{o.paymentReference ? ` · ref ${o.paymentReference}` : ''}
                      </p>
                      {o.notes && <p className="text-xs text-gray-600 dark:text-gray-300 mt-2 italic">"{o.notes}"</p>}
                    </div>
                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      <button onClick={() => approveOrder(o._id)} className="btn-primary py-1.5 px-3 text-xs">
                        Approve & grant credits
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      className="input flex-1 text-xs py-1.5"
                      placeholder="Rejection reason (visible to user)"
                      value={rejectReason[o._id] || ''}
                      onChange={(e) => setRejectReason(prev => ({ ...prev, [o._id]: e.target.value }))}
                    />
                    <button onClick={() => rejectOrder(o._id)} className="btn-outline py-1.5 px-3 text-xs">
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Users tab */}
      {tab === 'users' && (
        <div className="card overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h3 className="font-serif text-lg">Users ({users.length})</h3>
          </div>
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800/40 border-b border-gray-100 dark:border-gray-800">
                <tr>
                  {['Name', 'Email', 'Plan', 'Credits', 'Status', 'Add credits', 'Action'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {users.map(u => (
                  <tr key={u._id} className="hover:bg-gray-50 dark:hover:bg-gray-800/30">
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{u.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                    <td className="px-4 py-3 capitalize text-gray-600 dark:text-gray-300">{u.plan}</td>
                    <td className="px-4 py-3 font-mono text-green-700">{u.credits?.toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <span className={u.isActive ? 'badge-green' : 'badge-red'}>{u.isActive ? 'active' : 'suspended'}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          className="input w-20 text-xs py-1"
                          placeholder="500"
                          value={creditsInput[u._id] || ''}
                          onChange={e => setCreditsInput(prev => ({ ...prev, [u._id]: e.target.value }))}
                        />
                        <button onClick={() => addCredits(u._id)} className="btn-primary py-1 px-2 text-xs">Apply</button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggleUser(u._id, u.isActive)} className="text-xs text-gray-400 hover:text-gray-700">
                        {u.isActive ? 'Suspend' : 'Activate'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lg:hidden divide-y divide-gray-50 dark:divide-gray-800">
            {users.map(u => (
              <div key={u._id} className="px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-gray-100 text-sm">{u.name}</p>
                    <p className="text-xs text-gray-400">{u.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={u.isActive ? 'badge-green' : 'badge-red'}>{u.isActive ? 'active' : 'suspended'}</span>
                    <button onClick={() => toggleUser(u._id, u.isActive)} className="text-xs text-gray-400 hover:text-gray-700">
                      {u.isActive ? 'Suspend' : 'Activate'}
                    </button>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono text-gray-500">
                  <span className="capitalize">{u.plan}</span>
                  <span className="text-green-700">{u.credits?.toLocaleString()} cr</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    className="input flex-1 text-xs py-1.5"
                    placeholder="Add / remove credits"
                    value={creditsInput[u._id] || ''}
                    onChange={e => setCreditsInput(prev => ({ ...prev, [u._id]: e.target.value }))}
                  />
                  <button onClick={() => addCredits(u._id)} className="btn-primary py-1.5 px-3 text-xs">Apply</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transactions tab */}
      {tab === 'transactions' && (
        <div className="card overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h3 className="font-serif text-lg">Recent transactions</h3>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-800">
            {txns.map(t => (
              <div key={t._id} className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-gray-900 dark:text-gray-100">{t.userId?.name || '—'}</span>
                  <span className="text-gray-400 mx-1.5">·</span>
                  <span className="text-gray-600 dark:text-gray-300 text-xs">{t.description || `${t.source} ${t.type}`}</span>
                </div>
                <div className="text-right flex-shrink-0">
                  <span className={`font-mono text-sm ${t.credits > 0 ? 'text-green-600' : t.credits < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                    {t.credits !== 0 ? (t.credits > 0 ? '+' : '') + t.credits + ' cr' : ''}
                  </span>
                  <p className="text-xs text-gray-400 font-mono">{fmtDate(t.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Audit log tab */}
      {tab === 'audit' && (
        <div className="card overflow-hidden">
          <div className="px-4 sm:px-6 py-4 border-b border-gray-100 dark:border-gray-800">
            <h3 className="font-serif text-lg">Admin actions</h3>
          </div>
          {audit.length === 0 ? (
            <div className="p-8 text-center text-gray-400 text-sm">No admin actions yet.</div>
          ) : (
            <div className="divide-y divide-gray-50 dark:divide-gray-800">
              {audit.map(a => (
                <div key={a._id} className="px-4 sm:px-6 py-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-gray-900 dark:text-gray-100">
                        <span className="font-medium">{a.adminId?.name || 'admin'}</span>
                        <span className="text-gray-400 mx-1">→</span>
                        <span className="font-mono text-xs">{a.action}</span>
                        {a.targetUserId && (
                          <>
                            <span className="text-gray-400 mx-1">·</span>
                            <span className="text-gray-500 text-xs">{a.targetUserId?.email || a.targetUserId}</span>
                          </>
                        )}
                      </p>
                      {a.reason && <p className="text-xs text-gray-500 italic mt-0.5">"{a.reason}"</p>}
                    </div>
                    <span className="text-xs text-gray-400 font-mono flex-shrink-0">{fmtDate(a.createdAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default WalletPage
