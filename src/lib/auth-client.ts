import { createAuthClient } from 'better-auth/client'
import { API_BASE_URL } from './constants'
import { getToken } from './token-storage'

const fetchWithToken: typeof fetch = (url, init) => {
  const token = getToken()
  if (token) {
    const headers = new Headers(init?.headers)
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }
    return fetch(url, { ...init, headers })
  }
  return fetch(url, init)
}

const _baseClient = createAuthClient({
  baseURL: API_BASE_URL,
  fetchOptions: {
    customFetchImpl: fetchWithToken,
  },
})

/** 自定义 OAuth 登录方法，支持 wechat / alipay */
async function signInWithProvider(
  provider: 'google' | 'github' | 'wechat' | 'alipay',
  options?: { callbackURL?: string }
): Promise<{ authUrl: string }> {
  const callbackURL = options?.callbackURL ?? `${API_BASE_URL}/api/auth/callback`
  const response = await fetch(
    `${API_BASE_URL}/api/auth/desktop-oauth?provider=${provider}&callbackURL=${encodeURIComponent(callbackURL)}`
  )
  const data = await response.json()
  if (data?.authUrl) {
    return { authUrl: data.authUrl as string }
  }
  throw new Error(data?.error?.message ?? 'Failed to get auth URL')
}

/** 统一导出的 authClient，包含自定义 OAuth 方法 */
export const authClient = _baseClient as typeof _baseClient & {
  signInWithProvider: typeof signInWithProvider
}

;(authClient as any).signInWithProvider = signInWithProvider

/** 向后兼容的别名，供 authStore 使用 */
export const authClientWithOAuth = authClient
