import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LogOut, Loader2 } from 'lucide-react'
import { useAuthStore } from '../../stores/authStore'

type Tab = 'signin' | 'signup'

export function AccountPage() {
  const { user, loading } = useAuthStore()

  if (loading && !user) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={20} className="animate-spin text-text-tertiary" />
      </div>
    )
  }

  if (!user) {
    return <AuthForm />
  }

  return <AccountDetails />
}

function AuthForm() {
  const [tab, setTab] = useState<Tab>('signin')
  const [phone, setPhone] = useState('')
  const [password, setPassword] = useState('')
  const { signIn, signUp, loading, error } = useAuthStore()
  const [localError, setLocalError] = useState<string | null>(null)
  const [rememberMe, setRememberMe] = useState(true)
  const { t } = useTranslation()

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
      // Error 已由 authStore 设置到 store.error 或在此处通过 localError 展示
    }
  }

  return (
    <div className="max-w-[340px] mx-auto py-8 px-6 space-y-5 text-[13px]">
      <div className="text-center mb-2">
        <h1 className="text-[18px] font-semibold text-text-primary">{t('account.title')}</h1>
        <p className="text-text-secondary mt-1">{t('account.subtitle')}</p>
      </div>

      {/* Tab switcher */}
      <div className="flex border border-border rounded-[8px] overflow-hidden">
        <button
          onClick={() => {
            setTab('signin')
            setLocalError(null)
          }}
          className={`flex-1 py-2 text-[13px] font-medium border-none cursor-pointer transition-colors ${
            tab === 'signin'
              ? 'bg-bg-secondary text-text-primary'
              : 'bg-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          {t('account.signIn')}
        </button>
        <button
          onClick={() => {
            setTab('signup')
            setLocalError(null)
          }}
          className={`flex-1 py-2 text-[13px] font-medium border-none cursor-pointer transition-colors ${
            tab === 'signup'
              ? 'bg-bg-secondary text-text-primary'
              : 'bg-transparent text-text-secondary hover:text-text-primary'
          }`}
        >
          {t('account.signUp')}
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
            className="w-full px-3 py-2 rounded-[8px] border border-border bg-bg-secondary text-text-primary text-[13px] outline-none focus:border-accent transition-colors"
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
            className="w-full px-3 py-2 rounded-[8px] border border-border bg-bg-secondary text-text-primary text-[13px] outline-none focus:border-accent transition-colors"
            required
          />
        </div>

        {/* "记住我" 复选框 */}
        <div className="flex items-center gap-2 mb-2">
          <input
            type="checkbox"
            id="rememberMe"
            checked={rememberMe}
            onChange={(e) => setRememberMe(e.target.checked)}
            className="w-4 h-4 rounded border-border text-accent focus:ring-accent focus:ring-offset-0"
          />
          <label htmlFor="rememberMe" className="text-[13px] text-text-secondary cursor-pointer">
            记住我
          </label>
        </div>
        {displayError && <p className="text-red-500 text-[12px]">{displayError}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full py-2 rounded-[8px] bg-accent text-white text-[13px] font-medium cursor-pointer border-none hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading && <Loader2 size={14} className="animate-spin" />}
          {tab === 'signin' ? t('account.signIn') : t('account.signUp')}
        </button>
      </form>
    </div>
  )
}
function AccountDetails() {
  const {
    user,
    plan,
    subscriptionEnd,
    signOut,
    changePassword,
  } = useAuthStore()
  const { t } = useTranslation()

  // Change password states
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmNewPassword, setConfirmNewPassword] = useState('')
  const [changePwLoading, setChangePwLoading] = useState(false)
  const [changePwMsg, setChangePwMsg] = useState<string | null>(null)

  const isPro = plan === 'pro'

  const handleChangePassword = async () => {
    if (newPassword !== confirmNewPassword) {
      setChangePwMsg('两次密码不一致')
      return
    }
    setChangePwLoading(true)
    setChangePwMsg(null)
    try {
      await changePassword(oldPassword, newPassword)
      setChangePwMsg('密码更新成功')
      setOldPassword('')
      setNewPassword('')
      setConfirmNewPassword('')
    } catch (e) {
      setChangePwMsg(e instanceof Error ? e.message : '修改密码失败')
    } finally {
      setChangePwLoading(false)
    }
  }

  const maskedPhone = user!.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2')

  return (
    <div className="max-w-[400px] mx-auto py-8 px-6 space-y-5 text-[13px]">
      <div className="text-center mb-2">
        <h1 className="text-[18px] font-semibold text-text-primary">{t('account.title')}</h1>
      </div>

      {/* User info */}
      <div className="border border-border rounded-[10px] overflow-hidden">
        <InfoRow label="手机号" value={maskedPhone} />
        {user!.name && <InfoRow label={t('account.name')} value={user!.name} />}
        <InfoRow label={t('account.plan')} value={isPro ? t('upgrade.pro') : t('upgrade.free')} />
        {isPro && subscriptionEnd && (
          <InfoRow
            label={t('account.renews')}
            value={new Date(subscriptionEnd).toLocaleDateString()}
          />
        )}
      </div>

      {/* Change password */}
      <div className="border border-border rounded-[10px] overflow-hidden">
        <div className="px-3 py-2.5 bg-bg-secondary/50 border-b border-border">
          <h3 className="text-[13px] font-medium text-text-primary">修改密码</h3>
        </div>
        <div className="px-3 py-3 space-y-2.5">
          <input
            type="password"
            placeholder="输入当前密码"
            value={oldPassword}
            onChange={(e) => setOldPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-[8px] border border-border bg-bg-secondary text-[12px] text-text-primary outline-none focus:border-accent transition-colors"
          />
          <input
            type="password"
            placeholder="输入新密码（至少6位）"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            minLength={6}
            className="w-full px-3 py-2 rounded-[8px] border border-border bg-bg-secondary text-[12px] text-text-primary outline-none focus:border-accent transition-colors"
          />
          <input
            type="password"
            placeholder="再次输入新密码"
            value={confirmNewPassword}
            onChange={(e) => setConfirmNewPassword(e.target.value)}
            minLength={6}
            className="w-full px-3 py-2 rounded-[8px] border border-border bg-bg-secondary text-[12px] text-text-primary outline-none focus:border-accent transition-colors"
          />
          <button
            onClick={handleChangePassword}
            disabled={changePwLoading || !oldPassword || !newPassword || !confirmNewPassword || newPassword.length < 6}
            className="w-full py-2 rounded-[8px] bg-accent text-white text-[13px] font-medium cursor-pointer border-none hover:opacity-90 transition-opacity disabled:opacity-40 flex items-center justify-center gap-1.5"
          >
            {changePwLoading && <Loader2 size={14} className="animate-spin" />}
            {changePwLoading ? '更新中...' : '更新密码'}
          </button>
          {changePwMsg && (
            <p className={`text-[12px] text-center ${changePwMsg.includes('成功') ? 'text-green-500' : 'text-red-500'}`}>
              {changePwMsg}
            </p>
          )}
        </div>
      </div>

      {/* Sign out */}
      <button
        onClick={signOut}
        className="w-full py-2 rounded-[8px] border border-border bg-transparent text-red-500 text-[13px] font-medium cursor-pointer hover:bg-red-500/5 transition-colors flex items-center justify-center gap-1.5"
      >
        <LogOut size={14} />
        {t('account.signOut')}
      </button>
    </div>
  )
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-3 py-2.5 border-b border-border last:border-b-0">
      <span className="text-text-secondary">{label}</span>
      <span className="text-text-primary">{value}</span>
    </div>
  )
}
