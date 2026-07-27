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
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.101/home', '192.0.2.101')
    const res = await middleware(req as any)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://192.0.2.100:3000/home')
  })

  it('does not redirect when host matches VIP', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.100/home', '192.0.2.100')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('strips port from Host header before comparing', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.100:3000/home', '192.0.2.100:3000')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts /api/health from redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.101/api/health', '192.0.2.101')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts /api/v1/ha/* from redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.101/api/v1/ha/cluster', '192.0.2.101')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts localhost from redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://localhost/home', 'localhost')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('respects HA_REDIRECT_DISABLED break-glass', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('HA_REDIRECT_DISABLED', 'true')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.101/home', '192.0.2.101')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('does not redirect when HA_ENABLED is not set', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.101/home', '192.0.2.101')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('preserves query string in redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.101/settings?tab=ha', '192.0.2.101')
    const res = await middleware(req as any)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://192.0.2.100:3000/settings?tab=ha')
  })
})

describe('VIP redirect host exemptions', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  function stubHaEnv() {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')
  }

  it('exempts the NEXTAUTH_URL host (preserved external URL)', async () => {
    stubHaEnv()
    vi.stubEnv('NEXTAUTH_URL', 'https://proxcenter.example.com')

    const { middleware } = await import('./middleware')
    const req = makeRequest('https://proxcenter.example.com/home', 'proxcenter.example.com')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('matches the exempt host case-insensitively and ignores the port', async () => {
    stubHaEnv()
    vi.stubEnv('NEXTAUTH_URL', 'https://proxcenter.example.com')

    const { middleware } = await import('./middleware')
    const req = makeRequest('https://proxcenter.example.com/home', 'ProxCenter.Example.com:443')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('still redirects an unknown host when NEXTAUTH_URL is set', async () => {
    stubHaEnv()
    vi.stubEnv('NEXTAUTH_URL', 'https://proxcenter.example.com')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.101/home', '192.0.2.101')
    const res = await middleware(req as any)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://192.0.2.100:3000/home')
  })

  it('never redirects the VIP host itself (loop guard)', async () => {
    stubHaEnv()
    vi.stubEnv('NEXTAUTH_URL', 'https://proxcenter.example.com')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.100:3000/home', '192.0.2.100:3000')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts hosts listed in HA_REDIRECT_EXEMPT_HOSTS', async () => {
    stubHaEnv()
    vi.stubEnv('HA_REDIRECT_EXEMPT_HOSTS', ' proxy-a.internal , Proxy-B.internal ')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://proxy-b.internal/home', 'proxy-b.internal')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('ignores an unparseable NEXTAUTH_URL without crashing', async () => {
    stubHaEnv()
    vi.stubEnv('NEXTAUTH_URL', 'not a url at all')

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.101/home', '192.0.2.101')
    const res = await middleware(req as any)

    expect(res.status).toBe(302)
  })

  it('exempts /api/health/live on a non-exempt host (liveness path)', async () => {
    stubHaEnv()

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.101/api/health/live', '192.0.2.101')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts /api/health?live=1 on a non-exempt host', async () => {
    stubHaEnv()

    const { middleware } = await import('./middleware')
    const req = makeRequest('http://192.0.2.101/api/health?live=1', '192.0.2.101')
    const res = await middleware(req as any)

    expect(res.status).not.toBe(302)
  })
})
