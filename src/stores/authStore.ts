import { create } from 'zustand'
import { invoke } from '@tauri-apps/api/core'
import { authClient, authClientWithOAuth } from '../lib/auth-client'
import { getSubscriptionStatus } from '../lib/api'
import { toast } from '../components/Toast'
import { generateOAuthState } from '../lib/deep-link'
import { API_BASE_URL } from '../lib/constants'
import { saveToken, clearTokens, getToken, OAUTH_REMEMBER_ME_KEY } from '../lib/token-storage'

let sttWarningShown = false
let llmWarningShown = false

// 错误码 → 用户友好消息映射（兜底，当服务端未返回 message 时使用）
const ERROR_MESSAGES: Record<string, string> = {
  // 注册/登录
  USER_ALREADY_EXISTS: '该手机号已注册，请直接登录',
  EMAIL_ALREADY_EXISTS: '该邮箱已被其他账号使用',
  INVALID_CREDENTIALS: '手机号或密码错误',
  MISSING_FIELDS: '请填写所有必填项',
  INVALID_PHONE: '请输入正确的11位手机号码',
  INVALID_EMAIL: '请输入正确的邮箱地址',
  PASSWORD_TOO_SHORT: '密码至少需要6个字符',
  UNAUTHORIZED: '登录已失效，请重新登录',
  WRONG_PASSWORD: '原密码不正确',
  // 验证码
  INVALID_CODE: '验证码无效或已过期，请重新获取',
  TOO_MANY_REQUESTS: '操作过于频繁，请60秒后再试',
  USER_NOT_FOUND: '该邮箱尚未绑定账号，请先注册',
  MISSING_PHONE: '请输入手机号',
  MISSING_EMAIL: '请输入邮箱地址',
  // 通用
  INTERNAL_ERROR: '服务器繁忙，请稍后重试',
}

/** 从任意错误中提取用户可读的消息 */
/**
 * 从异常中提取可读的错误消息。
 *
 * better-auth/client 在服务端返回非 2xx 时，会把整个响应体包装为：
 *   { statusCode: 409, error: { code: 'USER_ALREADY_EXISTS', message: '该手机号已注册' } }
 * 所以 e 可能是一个普通对象，而非 Error 实例。
 */
function extractErrorMessage(e: unknown, fallback: string): string {
  // 1) Error 实例（我们手动 throw new Error(...) 的情况）
  if (e instanceof Error) return e.message || fallback

  // 2) better-auth/client 返回的嵌套对象 { statusCode, error: { code, message } }
  if (e && typeof e === 'object') {
    const obj = e as Record<string, any>

    // 尝试直接取 message
    const msg = obj.message ?? null

    // 尝试从内层 error 对象取
    const inner = obj.error as Record<string, any> | null | undefined
    const innerMsg = inner?.message ?? null
    const innerCode = inner?.code ?? null

    // 优先级：内层 message > 外层 message > 内层 code 查表 > 兜底
    if (innerMsg) return innerMsg
    if (msg) return msg
    if (innerCode && ERROR_MESSAGES[innerCode]) return ERROR_MESSAGES[innerCode]
  }

  // 3) 纯字符串
  if (typeof e === 'string') return e

  return fallback
}

export interface AuthUser {
  id: string
  phone: string
  email: string | null
  name: string | null
}

interface AuthState {
  // User
  user: AuthUser | null
  plan: 'free' | 'pro'
  subscriptionEnd: string | null

  // Quotas
  sttSecondsUsed: number
  sttSecondsLimit: number
  llmTokensUsed: number
  llmTokensLimit: number

  // Loading
  loading: boolean
  error: string | null

  // Checkout flow
  checkoutPending: boolean
  initialize: () => Promise<void>
  signIn: (phone: string, password: string, rememberMe?: boolean) => Promise<void>
  signUp: (phone: string, password: string, rememberMe?: boolean) => Promise<void>
  signInWithProvider: (provider: 'google' | 'github' | 'wechat' | 'alipay', rememberMe?: boolean) => Promise<void>
  signOut: () => Promise<void>
  refreshSubscription: () => Promise<void>
  handleDeepLinkToken: (token: string, rememberMe?: boolean) => Promise<void>

  // Email & Password (忘记密码用邮箱验证码)
  sendEmailCode: (email: string) => Promise<void>
  resetPasswordByEmail: (email: string, code: string, newPassword: string) => Promise<void>
  changePassword: (oldPassword: string, newPassword: string) => Promise<void>
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  plan: 'free',
  subscriptionEnd: null,
  sttSecondsUsed: 0,
  sttSecondsLimit: 0,
  llmTokensUsed: 0,
  llmTokensLimit: 0,
  loading: false,
  error: null,
  checkoutPending: false,

  initialize: async () => {
    try {
      set({ loading: true, error: null })

      const savedToken = getToken()
      console.log('[DIAG] initialize: savedToken=' + (savedToken ? 'present(' + savedToken.length + 'chars)' : 'null'))
      if (!savedToken) {
        console.log('[DIAG] initialize: no token, skipping')
        set({ loading: false })
        return
      }

      console.log('[DIAG] initialize: calling authClient.getSession()...')
      const { data: session } = await authClient.getSession()
      console.log('[DIAG] initialize: getSession result', JSON.stringify(session))
      if (session?.user) {
        const u = session.user as any
        set({
          user: {
            id: session.user.id,
            phone: u.phone ?? u.email,
            email: u.email ?? null,
            name: (session.user as any).name ?? null,
          },
        })
        await invoke('set_session_token', { token: savedToken }).catch((e) => {
          console.error('Failed to sync session token to backend:', e)
        })
        await get().refreshSubscription()
      } else {
        clearTokens()
        await invoke('set_session_token', { token: '' }).catch(() => {})
      }
    } catch (e) {
      console.warn('[Auth] initialize failed:', e instanceof Error ? e.message : e)
    } finally {
      set({ loading: false })
    }
  },

  signIn: async (phone, password, rememberMe = true) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await authClient.signIn.email(
        { phone, password } as never,
        {
          onSuccess: async (ctx) => {
            let token = ctx.response.headers.get('set-auth-token')
            if (!token && data?.token) {
              token = data.token
            }
            if (token) {
              saveToken(token, rememberMe)
              await invoke('set_session_token', { token }).catch((e: unknown) => {
                console.error('Failed to sync session token to backend:', e)
              })
            }
          },
        },
      )
      if (error) {
        // 直接抛出原始错误对象（可能是嵌套结构 { statusCode, error: { code, message } }）
        // extractErrorMessage 会正确解析内层 message
        throw error
      }
      if (data?.user) {
        const u = data.user as any
        set({
          user: { id: data.user.id, phone: u.phone ?? u.email, email: u.email ?? null, name: u.name ?? null },
        })
        await get().refreshSubscription()
      }
    } catch (e) {
      const msg = extractErrorMessage(e, '登录失败，请稍后重试')
      set({ error: msg })
      throw e
    } finally {
      set({ loading: false })
    }
  },

  signInWithProvider: async (provider, rememberMe = true) => {
    set({ loading: true, error: null })
    try {
      const state = generateOAuthState()
      const callbackURL = `${API_BASE_URL}/auth/callback?from=desktop&state=${state}`
      const { authUrl } = await authClientWithOAuth.signInWithProvider(provider, { callbackURL })

      await import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(authUrl))

      localStorage.setItem(OAUTH_REMEMBER_ME_KEY, String(rememberMe))
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Sign in with provider failed'
      set({ error: msg })
      throw e
    } finally {
      set({ loading: false })
    }
  },

  signUp: async (phone, password, rememberMe = true) => {
    set({ loading: true, error: null })
    try {
      const { data, error } = await authClient.signUp.email(
        { phone, password } as never,
        {
          onSuccess: async (ctx) => {
            let token = ctx.response.headers.get('set-auth-token')
            if (!token && data?.token) {
              token = data.token
            }
            if (token) {
              saveToken(token, rememberMe)
              await invoke('set_session_token', { token }).catch((e: unknown) => {
                console.error('Failed to sync session token to backend:', e)
              })
            }
          },
        },
      )
      if (error) {
        // 直接抛出原始错误对象（可能是嵌套结构 { statusCode, error: { code, message } }）
        throw error
      }

      if (data?.user) {
        const u = data.user as any
        set({
          user: { id: data.user.id, phone: u.phone ?? u.email, email: u.email ?? null, name: u.name ?? null },
        })
        await get().refreshSubscription()
      }
    } catch (e) {
      const msg = extractErrorMessage(e, '注册失败，请稍后重试')
      set({ error: msg })
      throw e
    } finally {
      set({ loading: false })
    }
  },

  resendVerification: async () => {
    // No-op: SMS verification replaces email verification
  },

  signOut: async () => {
    try {
      await authClient.signOut()
    } finally {
      clearTokens()
      localStorage.removeItem(OAUTH_REMEMBER_ME_KEY)
      await invoke('set_session_token', { token: '' }).catch((e: unknown) => {
        console.error('Failed to clear session token in backend:', e)
      })
      set({
        user: null,
        plan: 'free',
        subscriptionEnd: null,
        sttSecondsUsed: 0,
        sttSecondsLimit: 0,
        llmTokensUsed: 0,
        llmTokensLimit: 0,
        error: null,
        checkoutPending: false,
      })
      sttWarningShown = false
      llmWarningShown = false
    }
  },

  refreshSubscription: async () => {
    try {
      const status = await getSubscriptionStatus()
      set({
        plan: status.plan,
        subscriptionEnd: status.subscriptionEnd,
        sttSecondsUsed: status.sttSecondsUsed,
        sttSecondsLimit: status.sttSecondsLimit,
        llmTokensUsed: status.llmTokensUsed,
        llmTokensLimit: status.llmTokensLimit,
      })
      if (get().checkoutPending) {
        set({ checkoutPending: false })
      }
      if (
        status.sttSecondsLimit > 0 &&
        status.sttSecondsUsed / status.sttSecondsLimit >= 0.9 &&
        !sttWarningShown
      ) {
        toast('STT quota is above 90%. Consider switching to BYOK mode.', 'error')
        sttWarningShown = true
      }
      if (
        status.llmTokensLimit > 0 &&
        status.llmTokensUsed / status.llmTokensLimit >= 0.9 &&
        !llmWarningShown
      ) {
        toast('LLM quota is above 90%. Consider switching to BYOK mode.', 'error')
        llmWarningShown = true
      }
    } catch (e) {
      console.warn('Failed to refresh subscription status:', e instanceof Error ? e.message : e)
    }
  },

  handleDeepLinkToken: async (token, rememberMe = true) => {
    try {
      set({ loading: true, error: null })

      const oauthRememberMe = localStorage.getItem(OAUTH_REMEMBER_ME_KEY)
      if (oauthRememberMe !== null) {
        rememberMe = oauthRememberMe === 'true'
        localStorage.removeItem(OAUTH_REMEMBER_ME_KEY)
      }

      saveToken(token, rememberMe)
      await invoke('set_session_token', { token }).catch((e: unknown) => {
        console.error('Failed to sync session token to backend:', e)
      })
      const { data: session } = await authClient.getSession({
        fetchOptions: {
          headers: { Authorization: `Bearer ${token}` },
        },
      })
      if (session?.user) {
        const u = session.user as any
        set({
          user: { id: session.user.id, phone: u.phone ?? u.email, email: u.email ?? null, name: (session.user as any).name ?? null },
        })
        await get().refreshSubscription()
      }
    } catch {
      set({ error: 'Failed to authenticate with token' })
    } finally {
      set({ loading: false })
    }
  },

  // ===== Email & Password Actions =====

  sendEmailCode: async (email) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/send-email-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { code: '', message: '' } }))
      const serverMsg = body.error?.message
      const fallbackMsg = ERROR_MESSAGES[body.error?.code] || '发送验证码失败'
      throw new Error(serverMsg || fallbackMsg)
    }
  },

  resetPasswordByEmail: async (email, code, newPassword) => {
    const res = await fetch(`${API_BASE_URL}/api/auth/reset-password-by-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, code, newPassword }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { code: '', message: '' } }))
      const serverMsg = body.error?.message
      const fallbackMsg = ERROR_MESSAGES[body.error?.code] || '重置密码失败'
      throw new Error(serverMsg || fallbackMsg)
    }
  },

  changePassword: async (oldPassword, newPassword) => {
    const token = getToken()
    const res = await fetch(`${API_BASE_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ oldPassword, newPassword }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({ error: { code: '', message: '' } }))
      const serverMsg = body.error?.message
      const fallbackMsg = ERROR_MESSAGES[body.error?.code] || '修改密码失败'
      throw new Error(serverMsg || fallbackMsg)
    }
  },
}))
