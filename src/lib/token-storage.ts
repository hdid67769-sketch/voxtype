/**
 * Token 存储管理工具
 * 统一管理 localStorage/sessionStorage 的 token 读写，供 authStore 和 auth-client 共用
 */

export const TOKEN_STORAGE_KEY = 'session_token'
export const REMEMBER_ME_KEY = 'remember_me'
export const OAUTH_REMEMBER_ME_KEY = 'oauth_remember_me'

/** 根据 rememberMe 选择存储位置保存 token */
export function saveToken(token: string, rememberMe: boolean): void {
  console.log('[DIAG] saveToken: rememberMe=' + rememberMe + ' tokenLength=' + token.length)
  if (rememberMe) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token)
    localStorage.setItem(REMEMBER_ME_KEY, 'true')
  } else {
    sessionStorage.setItem(TOKEN_STORAGE_KEY, token)
    localStorage.setItem(REMEMBER_ME_KEY, 'false')
  }
}

/** 清除所有存储中的 token 和 rememberMe 状态 */
export function clearTokens(): void {
  console.log('[DIAG] clearTokens: called')
  localStorage.removeItem(TOKEN_STORAGE_KEY)
  sessionStorage.removeItem(TOKEN_STORAGE_KEY)
  localStorage.removeItem(REMEMBER_ME_KEY)
}

/** 获取 token：优先 localStorage（持久），再 sessionStorage（临时） */
export function getToken(): string | null {
  const lt = localStorage.getItem(TOKEN_STORAGE_KEY)
  const st = sessionStorage.getItem(TOKEN_STORAGE_KEY)
  console.log('[DIAG] getToken: localStorage=' + (lt ? 'present(' + lt.length + 'chars)' : 'null') + ' sessionStorage=' + (st ? 'present(' + st.length + 'chars)' : 'null'))
  return lt ?? st
}
