import { API_BASE_URL } from './constants'
import { getToken } from './token-storage'

const DEFAULT_TIMEOUT_MS = 30_000

function authHeaders(): Record<string, string> {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function request<T>(
  path: string,
  options?: RequestInit & { timeoutMs?: number },
): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options ?? {}
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${API_BASE_URL}${path}`, {
      ...fetchOptions,
      credentials: 'include',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
        ...fetchOptions?.headers,
      },
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new ApiError(res.status, body.error ?? res.statusText)
    }

    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

// Subscription
export interface SubscriptionStatus {
  plan: 'free' | 'pro'
  subscriptionEnd: string | null
  sttSecondsUsed: number
  sttSecondsLimit: number
  llmTokensUsed: number
  llmTokensLimit: number
}

export function getSubscriptionStatus(): Promise<SubscriptionStatus> {
  return request('/api/subscription/status')
}

// Payment (虎皮椒)
export interface CreatePayResponse {
  code: number
  message: string
  data: {
    order_id: string
    amount: number
    plan_type: string
    pay_type: string
    qr_url: string
    is_reused: boolean
  }
}

export function createPayOrder(
  planType: 'monthly' | 'quarterly' | 'yearly',
  payType: 'wechat' | 'alipay',
): Promise<CreatePayResponse> {
  return request('/api/pay/create', {
    method: 'POST',
    body: JSON.stringify({ plan_type: planType, pay_type: payType }),
  })
}

export interface CheckPayResponse {
  code: number
  message: string
  data: {
    paid: boolean
    order_id?: string
    amount?: number
    plan_type?: string
    paid_at?: string
  }
}

export function checkPayStatus(orderId: string): Promise<CheckPayResponse> {
  return request('/api/pay/check', {
    method: 'POST',
    body: JSON.stringify({ order_id: orderId }),
  })
}

// Proxy STT
export async function proxyStt(audioBlob: Blob, language: string): Promise<{ text: string }> {
  const formData = new FormData()
  formData.append('audio', audioBlob)
  formData.append('language', language)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)

  try {
    const res = await fetch(`${API_BASE_URL}/api/proxy/stt`, {
      method: 'POST',
      credentials: 'include',
      signal: controller.signal,
      headers: authHeaders(),
      body: formData,
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: res.statusText }))
      throw new ApiError(res.status, body.error ?? res.statusText)
    }

    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

// Proxy LLM
export function proxyLlm(
  messages: Array<{ role: string; content: string }>,
): Promise<{ text: string }> {
  return request('/api/proxy/llm', {
    method: 'POST',
    body: JSON.stringify({ messages }),
  })
}

// Backup
export function uploadBackup(data: {
  history?: unknown
  dictionary?: unknown
  settings?: unknown
}): Promise<{ success: boolean }> {
  return request('/api/backup/upload', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function downloadBackup(): Promise<{
  history?: unknown
  dictionary?: unknown
  settings?: unknown
}> {
  return request('/api/backup/download')
}

// Scenes
export interface ScenePack {
  id: string
  name: string
  description: string
  category: string
  promptTemplate: string
  dictionaryTerms: Array<{ word: string; pronunciation?: string }>
  isPro: boolean
}

export function getScenes(): Promise<ScenePack[]> {
  return request('/api/scenes')
}

// Product info (pricing from server)
export interface ServerPricingPeriod {
  price: number
  label: string
  duration_days: number
}

export interface ServerPricing {
  monthly: ServerPricingPeriod
  quarterly: ServerPricingPeriod
  yearly: ServerPricingPeriod
}

export interface ProductInfo {
  // Server wraps everything inside `data`
  data: {
    pricing: ServerPricing
    [key: string]: unknown
  }
  [key: string]: unknown
}

export function getProductInfo(): Promise<ProductInfo> {
  // This endpoint returns public info (no auth required for pricing)
  return request('/api/user/info')
}

// Subscription portal
export function createPortalSession(): Promise<{ url: string }> {
  return request('/api/subscription/portal', { method: 'POST' })
}
