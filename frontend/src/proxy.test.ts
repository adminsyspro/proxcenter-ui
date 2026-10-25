import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getTokenMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

// Simulates the exact scenario the demo-mode strip guards against: a
// /api/v1/* path for which the demo interceptor has no mock (returns null),
// so the request falls through to the pass-through branch that used to
// forward client headers unsanitized.
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))

import { NextRequest } from 'next/server'

// Static instance: module-scope env constants (HA_ENABLED, VIP, ...) are baked
// at file load, BEFORE any vi.stubEnv from the VIP describes below runs.
import { proxy } from './proxy'

function makeRequest(url: string, host: string) {
  return {
    nextUrl: new URL(url),
    headers: new Map([['host', host]]),
    url,
    cookies: { get: () => undefined },
  }
}

function apiRequest(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://test.local${path}`, {
    method: init.method ?? 'GET',
    headers: init.headers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  getTokenMock.mockResolvedValue(null)
  delete process.env.DEMO_MODE
})

describe('VIP redirect', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
  })

  it('redirects non-VIP host to http://VIP:3000', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.101/home', '192.0.2.101')
    const res = await proxy(req as any)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://192.0.2.100:3000/home')
  })

  // The host must stay the VIP; only the scheme and the port follow APP_URL.
  // Hard-coded http://VIP:3000 drops an HTTPS session out of TLS, and with
  // HSTS on the browser rewrites it to https://VIP:3000 where nothing listens.
  describe('target scheme and port follow what is actually served', () => {
    async function redirectTargetFor(appUrl: string | undefined) {
      vi.stubEnv('HA_ENABLED', 'true')
      vi.stubEnv('VIP', '192.0.2.100')
      vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')
      vi.stubEnv('APP_URL', appUrl)

      const { proxy } = await import('./proxy')
      const res = await proxy(makeRequest('http://192.0.2.101/home?a=1', '192.0.2.101') as any)

      expect(res.status).toBe(302)

      return res.headers.get('location')
    }

    it('keeps the explicit HTTPS port of APP_URL', async () => {
      expect(await redirectTargetFor('https://pcx.lab:8443')).toBe('https://192.0.2.100:8443/home?a=1')
    })

    it('omits the port when APP_URL is HTTPS on the default one', async () => {
      expect(await redirectTargetFor('https://pcx.lab')).toBe('https://192.0.2.100/home?a=1')
    })

    it('omits the port for an explicit :443 too', async () => {
      expect(await redirectTargetFor('https://pcx.lab:443')).toBe('https://192.0.2.100/home?a=1')
    })

    it('keeps the legacy target for a plain-http APP_URL, so a non-TLS HA install is unchanged', async () => {
      expect(await redirectTargetFor('http://pcx.lab:3000')).toBe('http://192.0.2.100:3000/home?a=1')
    })

    it('keeps the legacy target when APP_URL is unset', async () => {
      expect(await redirectTargetFor(undefined)).toBe('http://192.0.2.100:3000/home?a=1')
    })

    it('keeps the legacy target when APP_URL does not parse', async () => {
      expect(await redirectTargetFor('not a url')).toBe('http://192.0.2.100:3000/home?a=1')
    })

    it('control: a request already addressed to the VIP is passed through, never redirected onto itself', async () => {
      vi.stubEnv('HA_ENABLED', 'true')
      vi.stubEnv('VIP', '192.0.2.100')
      vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')
      vi.stubEnv('APP_URL', 'https://pcx.lab:8443')

      const { proxy } = await import('./proxy')

      // Both the bare VIP and the VIP carrying the HTTPS port: the loop guard
      // strips the port before comparing, and a redirect that can fire on its
      // own target is an infinite loop in a browser.
      for (const host of ['192.0.2.100', '192.0.2.100:8443']) {
        const res = await proxy(makeRequest(`https://${host}/home`, host) as any)

        expect(res.status).not.toBe(302)
      }
    })
  })

  it('does not redirect when host matches VIP', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.100/home', '192.0.2.100')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  it('strips port from Host header before comparing', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.100:3000/home', '192.0.2.100:3000')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts /api/health from redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.101/api/health', '192.0.2.101')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts /api/v1/ha/* from redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.101/api/v1/ha/cluster', '192.0.2.101')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  // A certificate for any name other than the NEXTAUTH_URL host arrives on a
  // host the exempt list does not cover, and the CA fetches it from the public
  // internet. Redirected to the VIP it never reaches the handler, so the order
  // fails validation and no certificate is ever issued on an HA install.
  it('exempts the ACME HTTP-01 challenge from redirect, whatever name it is fetched on', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { proxy } = await import('./proxy')

    for (const path of ['/.well-known/acme-challenge/tok3n', '/api/acme/challenge/tok3n']) {
      const res = await proxy(makeRequest(`http://pcx.lab${path}`, 'pcx.lab') as any)

      expect(res.status, path).not.toBe(302)
    }
  })

  it('control: another well-known path on the same host is still redirected', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { proxy } = await import('./proxy')
    const res = await proxy(makeRequest('http://pcx.lab/.well-known/security.txt', 'pcx.lab') as any)

    expect(res.status).toBe(302)
  })

  it('exempts localhost from redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://localhost/home', 'localhost')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  it('respects HA_REDIRECT_DISABLED break-glass', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('HA_REDIRECT_DISABLED', 'true')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.101/home', '192.0.2.101')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  it('does not redirect when HA_ENABLED is not set', async () => {
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.101/home', '192.0.2.101')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  it('preserves query string in redirect', async () => {
    vi.stubEnv('HA_ENABLED', 'true')
    vi.stubEnv('VIP', '192.0.2.100')
    vi.stubEnv('NEXTAUTH_SECRET', 'test-secret')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.101/settings?tab=ha', '192.0.2.101')
    const res = await proxy(req as any)

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

    const { proxy } = await import('./proxy')
    const req = makeRequest('https://proxcenter.example.com/home', 'proxcenter.example.com')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  it('matches the exempt host case-insensitively and ignores the port', async () => {
    stubHaEnv()
    vi.stubEnv('NEXTAUTH_URL', 'https://proxcenter.example.com')

    const { proxy } = await import('./proxy')
    const req = makeRequest('https://proxcenter.example.com/home', 'ProxCenter.Example.com:443')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  it('still redirects an unknown host when NEXTAUTH_URL is set', async () => {
    stubHaEnv()
    vi.stubEnv('NEXTAUTH_URL', 'https://proxcenter.example.com')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.101/home', '192.0.2.101')
    const res = await proxy(req as any)

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://192.0.2.100:3000/home')
  })

  it('never redirects the VIP host itself (loop guard)', async () => {
    stubHaEnv()
    vi.stubEnv('NEXTAUTH_URL', 'https://proxcenter.example.com')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.100:3000/home', '192.0.2.100:3000')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts hosts listed in HA_REDIRECT_EXEMPT_HOSTS', async () => {
    stubHaEnv()
    vi.stubEnv('HA_REDIRECT_EXEMPT_HOSTS', ' proxy-a.internal , Proxy-B.internal ')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://proxy-b.internal/home', 'proxy-b.internal')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  it('ignores an unparseable NEXTAUTH_URL without crashing', async () => {
    stubHaEnv()
    vi.stubEnv('NEXTAUTH_URL', 'not a url at all')

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.101/home', '192.0.2.101')
    const res = await proxy(req as any)

    expect(res.status).toBe(302)
  })

  it('exempts /api/health/live on a non-exempt host (liveness path)', async () => {
    stubHaEnv()

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.101/api/health/live', '192.0.2.101')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })

  it('exempts /api/health?live=1 on a non-exempt host', async () => {
    stubHaEnv()

    const { proxy } = await import('./proxy')
    const req = makeRequest('http://192.0.2.101/api/health?live=1', '192.0.2.101')
    const res = await proxy(req as any)

    expect(res.status).not.toBe(302)
  })
})

describe('gesture 1: unconditional x-pxc-* strip on /api/*', () => {
  it('strips forged x-pxc-* headers on the storage upload bypass path', async () => {
    const res = await proxy(
      apiRequest('/api/v1/connections/c1/nodes/n1/storage/local/upload', {
        method: 'POST',
        headers: { 'x-pxc-entry': 'vms-list', 'x-pxc-path': '/api/v1/vms', 'x-pxc-method': 'GET' },
      }),
    )
    // NextResponse.next({request}) encodes forwarded request headers. The
    // override list must exist (proof the strip ran on the bypass path, a
    // bare NextResponse.next() would forward the forged headers untouched)
    // and must not carry any x-pxc-* name.
    const overridden = res.headers.get('x-middleware-override-headers')
    expect(overridden).not.toBeNull()
    expect(overridden).not.toContain('x-pxc-entry')
    expect(overridden).not.toContain('x-pxc-path')
    expect(overridden).not.toContain('x-pxc-method')
  })

  it('strips forged x-pxc-* on an authenticated API pass-through', async () => {
    getTokenMock.mockResolvedValue({ sub: 'u1' })
    const res = await proxy(
      apiRequest('/api/v1/users', { headers: { cookie: 'x', 'x-pxc-entry': 'evil' } }),
    )
    const overridden = res.headers.get('x-middleware-override-headers')
    expect(overridden).not.toBeNull()
    expect(overridden).not.toContain('x-pxc-entry')
  })
})

describe('gesture 3: bounded derogation', () => {
  it('answers 405 to OPTIONS on an allowlisted path with the entry methods (+HEAD), with or without Bearer', async () => {
    for (const headers of [{}, { authorization: 'Bearer pxc_x'.padEnd(50, 'a') }]) {
      const res = await proxy(apiRequest('/api/v1/vms', { method: 'OPTIONS', headers }))
      expect(res.status).toBe(405)
      expect(res.headers.get('Allow')).toBe('GET, HEAD')
      expect(await res.json()).toEqual({
        error: 'Preflight not supported: API tokens are server to server',
        method: 'OPTIONS',
      })
    }
  })

  it('answers 405 Allow: GET, HEAD itself to a Bearer POST on a GET-only allowlisted path', async () => {
    const res = await proxy(
      apiRequest('/api/v1/vms', { method: 'POST', headers: { authorization: 'Bearer pxc_abcdefgh123' } }),
    )
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET, HEAD')
    expect(await res.json()).toEqual({ error: 'Method not allowed for this API token route', method: 'POST' })
    expect(getTokenMock).not.toHaveBeenCalled()
  })

  it('derogates a Bearer pxc_ on an allowlisted path and stamps the three internal headers', async () => {
    const res = await proxy(
      apiRequest('/api/v1/pbs/conn-9/backups', { headers: { authorization: 'Bearer pxc_abcdefgh123' } }),
    )
    expect(res.status).toBe(200) // NextResponse.next()
    expect(res.headers.get('x-middleware-request-x-pxc-method')).toBe('GET')
    expect(res.headers.get('x-middleware-request-x-pxc-path')).toBe('/api/v1/pbs/conn-9/backups')
    expect(res.headers.get('x-middleware-request-x-pxc-entry')).toBe('pbs-backups')
    expect(getTokenMock).not.toHaveBeenCalled()
  })

  it('gives NO derogation to a Bearer on a non-allowlisted path: existing cookie 401', async () => {
    const res = await proxy(
      apiRequest('/api/v1/license/status', { headers: { authorization: 'Bearer pxc_abcdefgh123' } }),
    )
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Not authenticated' })
  })

  it('gives NO derogation without a Bearer on an allowlisted path', async () => {
    const res = await proxy(apiRequest('/api/v1/vms'))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Not authenticated' })
  })

  it('rejected paths (trailing slash, dotdot, %2F) never derogate', async () => {
    for (const path of ['/api/v1/vms/', '/api/v1/pbs/..%2Fx/backups', '/api/v1/pbs/a%2Fb/backups']) {
      const res = await proxy(
        apiRequest(path, { headers: { authorization: 'Bearer pxc_abcdefgh123' } }),
      )
      expect(res.status).toBe(401)
    }
  })

  it('keeps the existing behavior of public API routes', async () => {
    const res = await proxy(apiRequest('/api/health'))
    expect(res.status).toBe(200)
  })

  it('answers the existing cookie 401 to an OPTIONS preflight on a non-allowlisted path', async () => {
    const res = await proxy(apiRequest('/api/v1/users', { method: 'OPTIONS' }))
    expect(res.status).toBe(401)
    expect(await res.json()).toEqual({ error: 'Not authenticated' })
  })
})

describe('demo mode: x-pxc-* strip on the API pass-through', () => {
  it('strips forged x-pxc-* headers on a /api/v1/* path the demo interceptor has no mock for', async () => {
    process.env.DEMO_MODE = 'true'
    const res = await proxy(
      apiRequest('/api/v1/public/metrics', {
        headers: { 'x-pxc-entry': 'public-metrics', 'x-pxc-path': '/api/v1/public/metrics', 'x-pxc-method': 'GET' },
      }),
    )
    // Same proof shape as gesture 1 above: the override list must exist
    // (proof the strip ran — a bare NextResponse.next() forwards forged
    // headers untouched) and must not carry any x-pxc-* name.
    const overridden = res.headers.get('x-middleware-override-headers')
    expect(overridden).not.toBeNull()
    expect(overridden).not.toContain('x-pxc-entry')
    expect(overridden).not.toContain('x-pxc-path')
    expect(overridden).not.toContain('x-pxc-method')
    expect(res.headers.get('x-middleware-request-x-pxc-entry')).toBeNull()
    expect(res.headers.get('x-middleware-request-x-pxc-path')).toBeNull()
    expect(res.headers.get('x-middleware-request-x-pxc-method')).toBeNull()
    // The demo header itself still rides through: the strip must not
    // clobber the rest of the demo-mode pass-through.
    expect(res.headers.get('x-middleware-request-x-demo-mode')).toBe('true')
  })

  it('strips forged x-pxc-* headers on a non-v1 API path in demo mode', async () => {
    process.env.DEMO_MODE = 'true'
    const res = await proxy(
      apiRequest('/api/internal/some-route', { headers: { 'x-pxc-entry': 'evil' } }),
    )
    const overridden = res.headers.get('x-middleware-override-headers')
    expect(overridden).not.toBeNull()
    expect(overridden).not.toContain('x-pxc-entry')
  })
})

describe('cookie-authenticated behavior unchanged', () => {
  it('keeps the 2FA enrollment gate for cookie-authenticated API requests', async () => {
    getTokenMock.mockResolvedValue({ sub: 'u1', mustEnroll2fa: true })
    const res = await proxy(apiRequest('/api/v1/users', { headers: { cookie: 'x' } }))
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({
      error: 'ENROLLMENT_REQUIRED',
      redirect: '/profile/2fa/enrollment',
    })
  })
})
