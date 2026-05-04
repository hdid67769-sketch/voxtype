// App metadata
export const APP_NAME = 'VoxType'
export const APP_VERSION = 'v0.1.0'
export const APP_REPO_URL = 'https://github.com/hdid67769-sketch/voxtype'
export const APP_LICENSE_URL = 'https://github.com/hdid67769-sketch/voxtype/blob/main/LICENSE'
// Cloud API base URL — defaults to voxtype.net but can be overridden via VITE_API_BASE_URL env var.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'https://api.voxtype.net'

export const FREE_PLAN = {
  sttMinutes: 15,
  llmTokens: 100_000,
} as const

export type PlanPeriod = 'monthly' | 'quarterly' | 'yearly'

export const PRO_PLANS = {
  monthly: {
    price: '¥15',
    period: '/月',
    planType: 'monthly' as PlanPeriod,
    features: [
      { label: '专属润色模型', detail: '效果更优' },
      { label: '免配置 STT', detail: '开箱即用' },
      { label: '优先技术支持', detail: '' },
      { label: '多设备同步', detail: '即将上线' },
    ],
  },
  quarterly: {
    price: '¥36',
    period: '/季',
    planType: 'quarterly' as PlanPeriod,
    save: '省 20%',
    features: [
      { label: '专属润色模型', detail: '效果更优' },
      { label: '免配置 STT', detail: '开箱即用' },
      { label: '优先技术支持', detail: '' },
      { label: '多设备同步', detail: '即将上线' },
    ],
  },
  yearly: {
    price: '¥120',
    period: '/年',
    planType: 'yearly' as PlanPeriod,
    save: '省 33%',
    features: [
      { label: '专属润色模型', detail: '效果更优' },
      { label: '免配置 STT', detail: '开箱即用' },
      { label: '优先技术支持', detail: '' },
      { label: '多设备同步', detail: '即将上线' },
    ],
  },
} as const

// 兼容旧代码的默认引用
export const PRO_PLAN = {
  price: '¥15',
  period: '月',
  features: PRO_PLANS.monthly.features,
} as const

// STT providers: Local SenseVoice only
export const STT_PROVIDERS = [
  { value: 'local-sensevoice', label: 'Local SenseVoice (Offline)' },
] as const

// Cloud-only: only VoxType Cloud provider
export const LLM_PROVIDERS = [
  { value: 'cloud', label: 'VoxType Cloud' },
] as const

// Cloud-only mode — only default config for 'cloud'
export const LLM_DEFAULT_CONFIG: Record<string, { baseUrl: string; model: string }> = {
  cloud: { baseUrl: `${API_BASE_URL}/api/proxy`, model: 'default' },
}

export const LANGUAGES = [
  { value: 'multi', label: 'Auto Detect' },
  { value: 'zh', label: '中文 (Chinese)' },
  { value: 'en', label: 'English' },
  { value: 'ja', label: '日本語 (Japanese)' },
  { value: 'ko', label: '한국어 (Korean)' },
  { value: 'fr', label: 'Français (French)' },
  { value: 'de', label: 'Deutsch (German)' },
  { value: 'es', label: 'Español (Spanish)' },
  { value: 'pt', label: 'Português (Portuguese)' },
  { value: 'ru', label: 'Русский (Russian)' },
  { value: 'ar', label: 'العربية (Arabic)' },
  { value: 'hi', label: 'हिन्दी (Hindi)' },
  { value: 'th', label: 'ไทย (Thai)' },
  { value: 'vi', label: 'Tiếng Việt (Vietnamese)' },
  { value: 'it', label: 'Italiano (Italian)' },
  { value: 'nl', label: 'Nederlands (Dutch)' },
  { value: 'tr', label: 'Türkçe (Turkish)' },
  { value: 'pl', label: 'Polski (Polish)' },
  { value: 'uk', label: 'Українська (Ukrainian)' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'ms', label: 'Bahasa Melayu (Malay)' },
] as const

export const TARGET_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'zh', label: '中文 (Chinese)' },
  { value: 'ja', label: '日本語 (Japanese)' },
  { value: 'ko', label: '한국어 (Korean)' },
  { value: 'fr', label: 'Français (French)' },
  { value: 'de', label: 'Deutsch (German)' },
  { value: 'es', label: 'Español (Spanish)' },
  { value: 'pt', label: 'Português (Portuguese)' },
  { value: 'ru', label: 'Русский (Russian)' },
  { value: 'ar', label: 'العربية (Arabic)' },
  { value: 'hi', label: 'हिन्दी (Hindi)' },
  { value: 'th', label: 'ไทย (Thai)' },
  { value: 'vi', label: 'Tiếng Việt (Vietnamese)' },
  { value: 'it', label: 'Italiano (Italian)' },
  { value: 'nl', label: 'Nederlands (Dutch)' },
  { value: 'tr', label: 'Türkçe (Turkish)' },
  { value: 'pl', label: 'Polski (Polish)' },
  { value: 'uk', label: 'Українська (Ukrainian)' },
  { value: 'id', label: 'Bahasa Indonesia' },
  { value: 'ms', label: 'Bahasa Melayu (Malay)' },
] as const
