// ─── WalletPage ────────────────────────────────────────────────────────────
import { useState, useEffect } from 'react'
import api from '../api/client'
import { useAuth } from '../hooks/useAuth'

export function WalletPage() {
  const { user }               = useAuth()
  const [txns,    setTxns]     = useState([])
  const [loading, setLoading]  = useState(true)

  useEffect(() => {
    api.get('/wallet/transactions').then(r => setTxns(r.data.transactions)).finally(() => setLoading(false))
  }, [])

  const PLANS = [
    { id: 'free',    label: 'Free',    credits: 50,    price: 0,   note: 'forever free' },
    { id: 'starter', label: 'Starter', credits: 500,   price: 49,  note: '/month' },
    { id: 'pro',     label: 'Pro',     credits: 5000,  price: 149, note: '/month' },
    { id: 'agency',  label: 'Agency',  credits: 25000, price: 349, note: '/month' },
  ]

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="mb-6 sm:mb-8">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900">Wallet</h2>
      </div>

      {/* Balance */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6 sm:mb-8">
        <div className="card p-4 sm:p-6">
          <p className="stat-label">Credits remaining</p>
          <p className="font-serif text-3xl sm:text-4xl text-green-600 mt-1">{user?.credits?.toLocaleString()}</p>
          <p className="text-xs text-gray-400 mt-1">1 credit = 1 message</p>
        </div>
        <div className="card p-4 sm:p-6">
          <p className="stat-label">Current plan</p>
          <p className="font-serif text-xl sm:text-2xl text-gray-900 mt-1 capitalize">{user?.plan}</p>
        </div>
      </div>

      {/* Plan upgrade */}
      <div className="card p-4 sm:p-6 mb-6 sm:mb-8">
        <h3 className="font-serif text-lg mb-4">Upgrade plan</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
          {PLANS.map(p => (
            <div
              key={p.id}
              className={`border rounded-xl p-3 sm:p-4 relative ${
                user?.plan === p.id
                  ? 'border-green-400 bg-green-50'
                  : 'border-gray-200 hover:border-gray-300 transition-colors'
              }`}
            >
              {p.id === 'pro' && user?.plan !== 'pro' && (
                <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-green-600 text-white text-[9px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                  Popular
                </span>
              )}
              <p className="font-medium text-sm text-gray-900">{p.label}</p>
              <p className="font-serif text-xl sm:text-2xl text-gray-900 mt-1">
                {p.price === 0 ? 'Free' : `${p.price}`}
                {p.price !== 0 && <span className="text-xs font-sans text-gray-500"> TND</span>}
              </p>
              <p className="text-[10px] text-gray-400 font-mono">{p.note}</p>
              <p className="text-xs text-gray-500 mt-1 font-mono">{p.credits.toLocaleString()} credits</p>
              {user?.plan !== p.id ? (
                <button className="btn-primary w-full mt-3 py-1.5 text-xs justify-center">
                  {p.id === 'agency' ? 'Contact us' : 'Upgrade'}
                </button>
              ) : (
                <p className="text-xs text-green-600 mt-3 font-medium">Current plan</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Transaction history */}
      <div className="card overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
          <h3 className="font-serif text-lg">Transaction history</h3>
        </div>
        {loading ? (
          <div className="p-6 text-gray-400 text-sm">Loading…</div>
        ) : txns.length === 0 ? (
          <div className="p-8 text-center text-gray-400 text-sm">No transactions yet.</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {txns.map(t => (
              <div key={t._id} className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm text-gray-800 truncate">{t.description}</p>
                  <p className="text-xs text-gray-400 font-mono">{new Date(t.createdAt).toLocaleString()}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  {t.credits !== 0 && (
                    <p className={`text-sm font-mono font-medium ${t.credits > 0 ? 'text-green-600' : 'text-red-500'}`}>
                      {t.credits > 0 ? '+' : ''}{t.credits} cr
                    </p>
                  )}
                  {t.amount !== 0 && (
                    <p className="text-xs text-gray-500 font-mono">{t.amount > 0 ? '+' : ''}{t.amount} TND</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── SettingsPage ──────────────────────────────────────────────────────────
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'

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
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900">Settings</h2>
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
export function AdminPage() {
  const [stats,  setStats]  = useState(null)
  const [users,  setUsers]  = useState([])
  const [txns,   setTxns]   = useState([])
  const [loading,setLoading]= useState(true)
  const [creditsInput, setCreditsInput] = useState({})

  useEffect(() => {
    Promise.all([
      api.get('/admin/stats'),
      api.get('/admin/users?limit=50'),
      api.get('/admin/transactions?limit=20')
    ]).then(([s, u, t]) => {
      setStats(s.data)
      setUsers(u.data.users)
      setTxns(t.data.transactions)
    }).finally(() => setLoading(false))
  }, [])

  async function addCredits(userId) {
    const amt = Number(creditsInput[userId] || 0)
    if (!amt) return
    await api.post(`/admin/users/${userId}/topup`, { credits: amt, description: 'Admin top-up' })
    toast.success(`${amt} credits added`)
    setCreditsInput(prev => ({ ...prev, [userId]: '' }))
    setUsers(prev => prev.map(u => u._id === userId ? { ...u, credits: u.credits + amt } : u))
  }

  async function toggleUser(userId, isActive) {
    await api.put(`/admin/users/${userId}`, { isActive: !isActive })
    setUsers(prev => prev.map(u => u._id === userId ? { ...u, isActive: !isActive } : u))
  }

  if (loading) return (
    <div className="flex items-center justify-center h-full py-24 text-gray-400 text-sm">Loading…</div>
  )

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <div className="mb-6 sm:mb-8">
        <h2 className="font-serif text-2xl sm:text-3xl text-gray-900">Admin</h2>
      </div>

      {/* Platform stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
        {[
          { label: 'Users',        value: stats?.users },
          { label: 'Leads',        value: stats?.leads },
          { label: 'Messages',     value: stats?.messages },
          { label: 'Active today', value: stats?.activeToday },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <span className="stat-value">{s.value?.toLocaleString() || 0}</span>
            <span className="stat-label">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Users table */}
      <div className="card mb-6 sm:mb-8 overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
          <h3 className="font-serif text-lg">Users</h3>
        </div>

        {/* Desktop table */}
        <div className="hidden lg:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-100">
              <tr>
                {['Name', 'Email', 'Plan', 'Credits', 'Status', 'Add credits', 'Action'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map(u => (
                <tr key={u._id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{u.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{u.email}</td>
                  <td className="px-4 py-3 capitalize text-gray-600">{u.plan}</td>
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
                      <button onClick={() => addCredits(u._id)} className="btn-primary py-1 px-2 text-xs">Add</button>
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

        {/* Mobile user cards */}
        <div className="lg:hidden divide-y divide-gray-50">
          {users.map(u => (
            <div key={u._id} className="px-4 py-3 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-gray-900 text-sm">{u.name}</p>
                  <p className="text-xs text-gray-400">{u.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={u.isActive ? 'badge-green' : 'badge-red'}>
                    {u.isActive ? 'active' : 'suspended'}
                  </span>
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
                  placeholder="Add credits (e.g. 500)"
                  value={creditsInput[u._id] || ''}
                  onChange={e => setCreditsInput(prev => ({ ...prev, [u._id]: e.target.value }))}
                />
                <button onClick={() => addCredits(u._id)} className="btn-primary py-1.5 px-3 text-xs">Add</button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Recent transactions */}
      <div className="card overflow-hidden">
        <div className="px-4 sm:px-6 py-4 border-b border-gray-100">
          <h3 className="font-serif text-lg">Recent transactions</h3>
        </div>
        <div className="divide-y divide-gray-50">
          {txns.map(t => (
            <div key={t._id} className="px-4 sm:px-6 py-3 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <span className="font-medium text-gray-900">{t.userId?.name}</span>
                <span className="text-gray-400 mx-1.5">·</span>
                <span className="text-gray-600 text-xs">{t.description}</span>
              </div>
              <div className="text-right flex-shrink-0">
                <span className={`font-mono text-sm ${t.credits > 0 ? 'text-green-600' : t.credits < 0 ? 'text-red-500' : 'text-gray-500'}`}>
                  {t.credits !== 0 ? (t.credits > 0 ? '+' : '') + t.credits + ' cr' : ''}
                </span>
                <p className="text-xs text-gray-400 font-mono">{new Date(t.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default WalletPage
