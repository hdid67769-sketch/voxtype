import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ApiError } from '../api'
import { API_BASE_URL } from '../constants'

const API_BASE = API_BASE_URL

describe('ApiError', () => {
  it('stores status and message', () => {
    const err = new ApiError(404, 'Not found')
    expect(err.status).toBe(404)
    expect(err.message).toBe('Not found')
    expect(err.name).toBe('ApiError')
    expect(err).toBeInstanceOf(Error)
  })
})

describe('request() via getSubscriptionStatus', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            plan: 'pro',
            subscriptionEnd: '2025-12-31',
            sttSecondsUsed: 100,
            sttSecondsLimit: 36000,
            llmTokensUsed: 5000,
            llmTokensLimit: 5000000,
          }),
      }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls fetch with correct URL and options', async () => {
    const { getSubscriptionStatus } = await import('../api')
    await getSubscriptionStatus()

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/subscription/status`,
      expect.objectContaining({
        credentials: 'include',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
      }),
    )
  })

  it('returns parsed JSON on success', async () => {
    const { getSubscriptionStatus } = await import('../api')
    const result = await getSubscriptionStatus()
    expect(result.plan).toBe('pro')
    expect(result.sttSecondsLimit).toBe(36000)
  })
})

describe('request() error handling', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('throws ApiError with body.error on non-ok response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        json: () => Promise.resolve({ error: 'Subscription required' }),
      }),
    )

    const { getSubscriptionStatus } = await import('../api')
    await expect(getSubscriptionStatus()).rejects.toThrow('Subscription required')
    await expect(getSubscriptionStatus()).rejects.toBeInstanceOf(ApiError)
  })

  it('falls back to statusText when body has no error field', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
        json: () => Promise.resolve({}),
      }),
    )

    const { getSubscriptionStatus } = await import('../api')
    await expect(getSubscriptionStatus()).rejects.toThrow('Internal Server Error')
  })
})

describe('createPayOrder', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends POST with plan_type and pay_type', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            code: 0,
            message: 'success',
            data: {
              order_id: 'test_order_123',
              amount: 12,
              plan_type: 'monthly',
              pay_type: 'wechat',
              qr_url: 'https://api.dpweixin.com/pay/test',
              is_reused: false,
            },
          }),
      }),
    )

    const { createPayOrder } = await import('../api')
    const result = await createPayOrder('monthly', 'wechat')

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/pay/create`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ plan_type: 'monthly', pay_type: 'wechat' }),
      }),
    )
    expect(result.data.order_id).toBe('test_order_123')
  })
})

describe('proxyLlm', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('sends messages array as POST body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ text: 'polished text' }),
      }),
    )

    const { proxyLlm } = await import('../api')
    const messages = [{ role: 'user', content: 'hello' }]
    const result = await proxyLlm(messages)

    expect(fetch).toHaveBeenCalledWith(
      `${API_BASE}/api/proxy/llm`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ messages }),
      }),
    )
    expect(result.text).toBe('polished text')
  })
})
