import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('next-auth/jwt', () => ({
  getToken: vi.fn().mockResolvedValue(null),
}))

function makeRequest(url: string, host: string) {
  return {
    nextUrl: new URL(url),
    headers: new Map([['host', host]]),
    url,
    cookies: { get: () => undefined },
  }
}

describe('VIP redirect', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('redirects non-VIP host to http://VIP:3000', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '10.24.24.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://10.24.24.101/home', '10.24.24.101')
    const res = await middleware(req as any)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://10.24.24.100:3000/home')
  })

  it('does not redirect when host matches VIP', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '10.24.24.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://10.24.24.100/home', '10.24.24.100')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('strips port from Host header before comparing', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '10.24.24.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://10.24.24.100:3000/home', '10.24.24.100:3000')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts /api/health from redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '10.24.24.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://10.24.24.101/api/health', '10.24.24.101')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts /api/v1/ha/* from redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '10.24.24.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://10.24.24.101/api/v1/ha/cluster', '10.24.24.101')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts localhost from redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '10.24.24.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://localhost/home', 'localhost')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('respects HA_REDIRECT_DISABLED break-glass', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '10.24.24.100')
    vi.stubEnv('HA_REDIRECT_DISABLED', 'true')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://10.24.24.101/home', '10.24.24.101')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('does not redirect when HA_ENABLED is not set', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://10.24.24.101/home', '10.24.24.101')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('preserves query string in redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '10.24.24.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://10.24.24.101/settings?tab=ha', '10.24.24.101')
    const res = await middleware(req as any)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://10.24.24.100:3000/settings?tab=ha')
  })
})
