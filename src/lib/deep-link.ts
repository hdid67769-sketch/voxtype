import { onOpenUrl } from '@tauri-apps/plugin-deep-link'
import { useAuthStore } from '../stores/authStore'
import { API_BASE_URL } from './constants'

/** Pending OAuth state for CSRF validation. */
let pendingOAuthState: string | null = null
let pendingOAuthTimer: ReturnType<typeof setTimeout> | null = null

/** Generate and store a random state string for OAuth CSRF protection. */
export function generateOAuthState(): string {
  clearOAuthState()
  const state = crypto.randomUUID()
  pendingOAuthState = state
  // Auto-expire after 5 minutes to prevent stale state
  pendingOAuthTimer = setTimeout(clearOAuthState, 5 * 60 * 1000)
  return state
}

/** Clear pending OAuth state (e.g. user cancelled or timed out). */
export function clearOAuthState(): void {
  pendingOAuthState = null
  if (pendingOAuthTimer) {
    clearTimeout(pendingOAuthTimer)
    pendingOAuthTimer = null
  }
}

export async function initDeepLinkListener() {
  try {
    await onOpenUrl(async (urls) => {
      for (const rawUrl of urls) {
        await handleDeepLinkUrl(rawUrl)
      }
    })
  } catch {
    // Deep link plugin not available (e.g. web dev mode)
  }
}

/** Basic sanity check: token must be a non-empty alphanumeric/JWT-like string. */
function isValidToken(token: string): boolean {
  return /^[\w\-._~+/]+=*$/.test(token) && token.length >= 10 && token.length <= 4096
}

async function handleDeepLinkUrl(rawUrl: string) {
  console.log('[deep-link] received URL:', rawUrl.replace(/token=[^&]+/, 'token=***'))
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return
  }

  // Only accept our custom scheme
  if (url.protocol !== 'voxtype:') return

  const path = url.hostname + url.pathname
  const params = url.searchParams

  // voxtype://auth/callback?token=xxx&state=yyy
  if (path === 'auth/callback' || path === 'auth/callback/') {
    const token = params.get('token')
    const state = params.get('state')

    // Reject tokens when no OAuth flow was initiated (prevents external injection)
    if (!pendingOAuthState) {
      return
    }
    // Validate CSRF state
    if (state !== pendingOAuthState) {
      pendingOAuthState = null
      return
    }
    pendingOAuthState = null

    if (token && isValidToken(token)) {
      await useAuthStore.getState().handleDeepLinkToken(token)
      window.location.hash = '#/account'
    }
    return
  }

  // 支持微信和支付宝的 OAuth 回调
  // voxtype://wechat/callback?code=xxx&state=yyy
  // voxtype://alipay/callback?code=xxx&state=yyy
  if (path.startsWith('wechat/callback') || path.startsWith('alipay/callback')) {
    const code = params.get('code')
    const state = params.get('state')

    // Reject tokens when no OAuth flow was initiated (prevents external injection)
    if (!pendingOAuthState) {
      return
    }
    // Validate CSRF state
    if (state !== pendingOAuthState) {
      pendingOAuthState = null
      return
    }
    pendingOAuthState = null

    if (code) {
      // 处理微信/支付宝回调，需要在后端完成 OAuth 流程
      // 这里只是触发重定向到后端处理
      const provider = path.startsWith('wechat/') ? 'wechat' : 'alipay';
      const callbackUrl = `${API_BASE_URL}/api/auth/callback?code=${code}&state=${state}&provider=${provider}`;
      
      // 在桌面端打开浏览器进行 OAuth 流程
      try {
        await import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(callbackUrl));
      } catch (e) {
        console.error('Failed to open OAuth URL:', e);
      }
    }
    return
  }

  // voxtype://checkout/success
  if (path === 'checkout/success' || path === 'checkout/success/') {
    await useAuthStore.getState().refreshSubscription()
    window.location.hash = '#/upgrade'
    return
  }
}
