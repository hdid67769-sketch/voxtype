import { useState, useEffect, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, Crown, Loader2, Shield, Zap, Clock, X, QrCode } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { useAuthStore } from '../../stores/authStore'
import { PRO_PLANS, type PlanPeriod } from '../../lib/constants'
import { createPayOrder, checkPayStatus } from '../../lib/api'
import { useRoute } from '../../lib/router'

const PLAN_LABELS: Record<PlanPeriod, string> = {
  monthly: '月度',
  quarterly: '季度',
  yearly: '年度',
}

const PLAN_DESCRIPTIONS: Record<PlanPeriod, string> = {
  monthly: '适合体验 Pro 功能',
  quarterly: '最受欢迎的选择',
  yearly: '性价比最高',
}

const PLAN_ICONS: Record<PlanPeriod, typeof Clock> = {
  monthly: Clock,
  quarterly: Shield,
  yearly: Zap,
}

export function UpgradePage() {
  const { user, plan, sttSecondsUsed, sttSecondsLimit, llmTokensUsed, llmTokensLimit } =
    useAuthStore()
  const { t } = useTranslation()
  const { navigate } = useRoute()
  const [selectedPlan, setSelectedPlan] = useState<PlanPeriod>('monthly')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [payOrderId, setPayOrderId] = useState<string | null>(null)
  const [polling, setPolling] = useState(false)
  const [paymentSuccess, setPaymentSuccess] = useState(false)
  const [selectedPayType, setSelectedPayType] = useState<'wechat' | 'alipay'>('wechat')
  const [qrUrl, setQrUrl] = useState<string | null>(null)

  const isPro = plan === 'pro'

  const handleSubscribe = async (payType: 'wechat' | 'alipay') => {
    if (!user) return
    setSelectedPayType(payType)
    setLoading(true)
    setError(null)
    try {
      const result = await createPayOrder(selectedPlan, payType)
      if (result.code === 0 && result.data?.qr_url) {
        setPayOrderId(result.data.order_id)
        setQrUrl(result.data.qr_url)
        setPolling(true)
        setPaymentSuccess(false)
      } else {
        // 注意：result.message 可能是 'success'（服务端通用响应），不能直接显示给用户
        const errorMsg = result.code !== 0 ? (result.message || '创建订单失败') : '获取支付链接失败，请重试'
        setError(errorMsg)
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '创建订单失败'
      if (msg.includes('Aborted') || msg.includes('Timeout') || msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
        setError('网络连接失败，请检查网络后重试')
      } else {
        setError(msg)
      }
    } finally {
      setLoading(false)
    }
  }

  const pollPayment = useCallback(async () => {
    if (!payOrderId || !polling) return
    try {
      const result = await checkPayStatus(payOrderId)
      if (result.code === 0 && result.data?.paid) {
        setPolling(false)
        setPaymentSuccess(true)
        await useAuthStore.getState().refreshSubscription()
        setTimeout(() => {
          setPayOrderId(null)
          navigate('home')
        }, 2000)
      }
    } catch {
      // 继续轮询
    }
  }, [payOrderId, polling, navigate])

  useEffect(() => {
    if (!polling) return
    const timer = setInterval(pollPayment, 3000)
    return () => clearInterval(timer)
  }, [polling, pollPayment])

  const handleCancelPayment = () => {
    setPolling(false)
    setPayOrderId(null)
    setQrUrl(null)
    setPaymentSuccess(false)
  }

  const planData = PRO_PLANS[selectedPlan]

  return (
    <div className="max-w-[520px] mx-auto py-6 px-5 text-[13px]">
      {/* Header with gradient */}
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 mb-3">
          <Crown size={24} className="text-white" />
        </div>
        <h1 className="text-[22px] font-bold text-text-primary mb-1">升级到 Pro</h1>
        <p className="text-text-secondary text-[13px]">
          解锁全部功能，语音输入体验再升级
        </p>
      </div>

      {/* Current plan badge */}
      <div className="flex items-center justify-center mb-5">
        <span
          className={`px-3 py-1 rounded-full text-[12px] font-medium ${
            isPro ? 'bg-amber-500/10 text-amber-600' : 'bg-bg-secondary text-text-secondary'
          }`}
        >
          当前方案：{isPro ? 'Pro' : 'Free'}
        </span>
      </div>

      {/* Pro quota progress */}
      {isPro && (
        <div className="border border-border rounded-xl overflow-hidden mb-5">
          <div className="px-4 py-2.5 bg-gradient-to-r from-amber-500/5 to-orange-500/5 border-b border-border">
            <h3 className="text-[13px] font-medium text-text-primary">
              本月用量
            </h3>
          </div>
          <div className="px-4 py-3 space-y-3">
            <QuotaBar
              label={t('upgrade.stt', '语音识别')}
              used={sttSecondsUsed}
              limit={sttSecondsLimit}
              unit="hours"
              divisor={3600}
            />
            <QuotaBar
              label={t('upgrade.llm', '文本润色')}
              used={llmTokensUsed}
              limit={llmTokensLimit}
              unit="k tokens"
              divisor={1000}
            />
          </div>
        </div>
      )}

      {/* Plan selection cards */}
      {!isPro && (
        <div className="grid grid-cols-3 gap-2.5 mb-5">
          {(['monthly', 'quarterly', 'yearly'] as PlanPeriod[]).map((p) => {
            const pd = PRO_PLANS[p]
            const PlanIcon = PLAN_ICONS[p]
            const isSelected = selectedPlan === p
            return (
              <button
                key={p}
                onClick={() => setSelectedPlan(p)}
                className={`relative rounded-xl border-2 p-3 cursor-pointer transition-all text-left ${
                  isSelected
                    ? 'border-accent bg-accent/5 shadow-sm'
                    : 'border-border bg-transparent hover:border-accent/30 hover:bg-bg-secondary/50'
                }`}
              >
                {'save' in pd && pd.save && (
                  <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-green-500 text-white text-[9px] font-medium px-1.5 py-0.5 rounded-full">
                    {pd.save}
                  </span>
                )}
                <PlanIcon
                  size={18}
                  className={isSelected ? 'text-accent mb-1.5' : 'text-text-tertiary mb-1.5'}
                />
                <p className={`text-[11px] mb-1 ${isSelected ? 'text-text-primary font-medium' : 'text-text-secondary'}`}>
                  {PLAN_LABELS[p]}
                </p>
                <p className={`text-[18px] font-bold leading-tight ${isSelected ? 'text-accent' : 'text-text-primary'}`}>
                  {pd.price}
                </p>
                <p className="text-[11px] text-text-tertiary mt-0.5">
                  {pd.period}
                </p>
              </button>
            )
          })}
        </div>
      )}

      {/* Selected plan detail */}
      {!isPro && (
        <div className="border border-border rounded-xl overflow-hidden mb-5">
          <div className="px-4 py-3 bg-bg-secondary/30 border-b border-border">
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-medium text-text-primary">
                {PLAN_LABELS[selectedPlan]}方案
              </span>
              <span className="text-[11px] text-text-tertiary">· {PLAN_DESCRIPTIONS[selectedPlan]}</span>
            </div>
          </div>
          <div className="px-4 py-2.5">
            {planData.features.map((f, i) => (
              <div key={i} className="flex items-center gap-2 py-1.5">
                <Check size={13} className="text-green-500 shrink-0" />
                <span className="text-text-secondary">
                  {f.label}
                  {f.detail && (
                    <span className="text-text-tertiary ml-1">— {f.detail}</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action buttons / Pro thank you */}
      {isPro ? (
        <div className="text-center py-4">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-green-500/10 mb-2">
            <Crown size={18} className="text-amber-500" />
          </div>
          <p className="text-text-secondary text-[13px]">
            {t('upgrade.thankYou', '感谢你的支持！')}
          </p>
          <p className="text-text-tertiary text-[12px] mt-1">
            {plan === 'pro' && useAuthStore.getState().subscriptionEnd
              ? `有效期至 ${new Date(useAuthStore.getState().subscriptionEnd!).toLocaleDateString('zh-CN')}`
              : ''}
          </p>
        </div>
      ) : !user ? (
        <p className="text-text-tertiary text-[12px] text-center py-3">
          {t('upgrade.signInFirst', '请先登录后再订阅')}
        </p>
      ) : (
        <div className="space-y-2">
          <button
            onClick={() => handleSubscribe('wechat')}
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-[#07C160] text-white text-[13px] font-medium cursor-pointer border-none hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <span className="text-[15px]">微</span>}
            {loading ? '创建订单中...' : `微信支付 · ${planData.price}`}
          </button>
          <button
            onClick={() => handleSubscribe('alipay')}
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-[#1677FF] text-white text-[13px] font-medium cursor-pointer border-none hover:opacity-90 transition-opacity disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <span className="text-[15px]">支</span>}
            {loading ? '创建订单中...' : `支付宝 · ${planData.price}`}
          </button>
        </div>
      )}

      {error && (
        <p className="text-red-500 text-[12px] mt-2 text-center">{error}</p>
      )}

      {/* Payment polling overlay */}
      {polling && !paymentSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-bg-primary border border-border rounded-2xl shadow-xl max-w-[360px] w-full mx-4 overflow-hidden">
            {/* Modal header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    selectedPayType === 'wechat' ? 'bg-[#07C160]/10' : 'bg-[#1677FF]/10'
                  }`}
                >
                  <QrCode
                    size={16}
                    className={selectedPayType === 'wechat' ? 'text-[#07C160]' : 'text-[#1677FF]'}
                  />
                </div>
                <span className="text-[14px] font-medium text-text-primary">
                  扫码支付
                </span>
              </div>
              <button
                onClick={handleCancelPayment}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-tertiary hover:text-text-primary hover:bg-bg-secondary cursor-pointer border-none transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            {/* QR Code + Order info */}
            <div className="px-5 py-5">
              {/* QR Code */}
              <div className="flex justify-center mb-4">
                <div className="bg-white rounded-2xl p-4 shadow-sm">
                  {qrUrl && (
                    <QRCodeSVG
                      value={qrUrl}
                      size={180}
                      level="M"
                      includeMargin={false}
                    />
                  )}
                </div>
              </div>

              {/* Scan tip */}
              <div className="text-center mb-4">
                <p className="text-[13px] font-medium text-text-primary mb-1">
                  请使用微信或支付宝扫码支付
                </p>
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/5 border border-accent/20">
                  <Loader2 size={12} className="animate-spin text-accent" />
                  <span className="text-text-tertiary text-[12px]">
                    等待支付完成...
                  </span>
                </div>
              </div>

              {/* Order detail */}
              <div className="bg-bg-secondary/50 rounded-xl p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary text-[12px]">订阅方案</span>
                  <span className="text-text-primary text-[13px] font-medium">
                    {PLAN_LABELS[selectedPlan]} Pro
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary text-[12px]">有效期</span>
                  <span className="text-text-primary text-[13px]">
                    {selectedPlan === 'monthly' ? '30 天' : selectedPlan === 'quarterly' ? '90 天' : '365 天'}
                  </span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary text-[12px]">支付金额</span>
                  <span className="text-[18px] font-bold text-accent">{planData.price}</span>
                </div>
                <div className="h-px bg-border" />
                <div className="flex items-center justify-between">
                  <span className="text-text-secondary text-[12px]">订单号</span>
                  <span className="text-text-tertiary text-[11px] font-mono">
                    {payOrderId}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Payment success overlay */}
      {paymentSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-bg-primary border border-border rounded-2xl shadow-xl max-w-[320px] w-full mx-4 p-8 text-center">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-green-500/10 mb-4">
              <Check size={28} className="text-green-500" />
            </div>
            <h2 className="text-[18px] font-bold text-text-primary mb-1">支付成功</h2>
            <p className="text-text-secondary text-[13px] mb-1">
              已开通 {PLAN_LABELS[selectedPlan]} Pro
            </p>
            <p className="text-text-tertiary text-[12px]">
              正在跳转...
            </p>
          </div>
        </div>
      )}
    </div>
  )
}

function QuotaBar({
  label,
  used,
  limit,
  unit,
  divisor,
}: {
  label: string
  used: number
  limit: number
  unit: string
  divisor: number
}) {
  const pct = limit > 0 ? Math.min((used / limit) * 100, 100) : 0
  const usedDisplay = (used / divisor).toFixed(1)
  const limitDisplay = (limit / divisor).toFixed(1)

  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[12px]">
        <span className="text-text-secondary">{label}</span>
        <span className="text-text-tertiary">
          {usedDisplay} / {limitDisplay} {unit}
        </span>
      </div>
      <div
        className="h-1.5 bg-bg-secondary rounded-full overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${label} usage: ${usedDisplay} of ${limitDisplay} ${unit}`}
      >
        <div
          className={`h-full rounded-full transition-all ${pct > 90 ? 'bg-red-500' : 'bg-accent'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
