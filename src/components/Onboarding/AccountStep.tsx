import { useState } from 'react'
import { motion } from 'framer-motion'
import { Loader2, UserCircle, CheckCircle2 } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

type Tab = 'signin' | 'signup'

export function AccountStep() {
  const { user, loading, error, signIn, signUp } =
    useAuthStore()
  const [tab, setTab] = useState<Tab>('signin')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const [localError, setLocalError] = useState<string | null>(null)
  const [rememberMe, setRememberMe] = useState(true)

  const displayError = localError ?? error

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLocalError(null)
    try {
      if (tab === 'signin') {
        await signIn(phone, password, rememberMe)
      } else {
        await signUp(phone, password, rememberMe)
      }
    } catch {
      // Error already set in store
    }
  }

  // ── Post-login confirmation ──
  if (user) {
    const maskedPhone = user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')
    return (
      <div className="max-w-[280px] mx-auto flex flex-col items-center gap-6 py-4">
        <motion.div
          className="w-20 h-20 rounded-full bg-success/10 flex items-center justify-center"
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 500, damping: 20 }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 500, damping: 20 }}
          >
            <CheckCircle2 size={36} className="text-success" />
          </motion.div>
        </motion.div>
        <div className="text-center">
          <p className="text-[13px] text-text-secondary">已登录为</p>
          <p className="text-[15px] font-medium text-text-primary mt-1">{maskedPhone}</p>
        </div>
        <div className="bg-bg-secondary rounded-[14px] p-4 w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-[10px] bg-accent/10 flex items-center justify-center">
              <UserCircle size={18} className="text-accent" />
            </div>
            <div>
              <p className="text-[13px] font-medium text-text-primary">Free Plan</p>
              <p className="text-[12px] text-text-secondary">15分钟语音 + 100K tokens</p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── Sign in / Sign up form ──
  return (
    <div className="max-w-[280px] mx-auto space-y-4">
      {/* Hero icon — matching DoneStep circle style */}
      <div className="flex justify-center py-2">
        <div className="w-16 h-16 rounded-full bg-accent/10 flex items-center justify-center">
          <UserCircle size={28} className="text-accent" />
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex border border-border rounded-[10px] overflow-hidden">
        <button
          onClick={() => { setTab('signin'); setLocalError(null) }}
          className={`flex-1 py-2 text-[13px] font-medium border-none cursor-pointer transition-colors ${
            tab === 'signin'
              ? 'bg-bg-secondary text-text-primary'
              : 'bg-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          登录
        </button>
        <button
          onClick={() => { setTab('signup'); setLocalError(null) }}
          className={`flex-1 py-2 text-[13px] font-medium border-none cursor-pointer transition-colors ${
            tab === 'signup'
              ? 'bg-bg-secondary text-text-primary'
              : 'bg-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          注册
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-[13px] font-medium text-text-secondary mb-2">手机号</label>
          <input
            type="tel"
            placeholder="138 0000 0000"
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 11))}
            maxLength={11}
            className="w-full px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-primary outline-none focus:border-border-focus transition-colors"
            required
          />
        </div>
        <div>
          <label className="block text-[13px] font-medium text-text-secondary mb-2">密码</label>
          <input
            type="password"
            placeholder="••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={6}
            className="w-full px-3 py-2.5 bg-bg-secondary border border-border rounded-[10px] text-[13px] text-text-primary outline-none focus:border-border-focus transition-colors"
            required
          />
        </div>

        <div className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            id="rememberMe"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="w-4 h-4 rounded border-border text-accent focus:ring-accent focus:ring-offset-0"
          />
          <label htmlFor="rememberMe" className="text-[13px] text-text-secondary cursor-pointer">
            记住登录状态
          </label>
        </div>
        {displayError && <p className="text-error text-[12px]">{displayError}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 rounded-[10px] bg-accent text-white text-[13px] font-medium cursor-pointer border-none hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-1.5"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {tab === 'signin' ? '登录' : '注册'}
        </button>
      </form>


    </div>
  )
}
