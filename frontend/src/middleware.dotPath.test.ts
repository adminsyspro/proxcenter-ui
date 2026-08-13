import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getTokenMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))

import { NextRequest } from 'next/server'

import { middleware } from './middleware'

function request(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return new NextRequest(`http://test.local${path}`, {
    method: init.method ?? 'GET',
    headers: init.headers,
  })
}

/** A middleware pass-through, i.e. the handler behind the path will run. */
function passedThrough(res: Response): boolean {
  return res.headers.get('x-middleware-next') === '1'
}

beforeEach(() => {
  vi.clearAllMocks()
  getTokenMock.mockResolvedValue(null)
  delete process.env.DEMO_MODE
})

// GHSA-79j6-v2r5-5pw5: isAsset classified ANY path containing a dot as a
// static asset, so a dotted /api path was forwarded to its route handler
// before the JWT check ran. Proxmox node names accept dots (assertNodeName in
// lib/ssh/validate.ts), and several guest routes embed the node name in their
// dynamic segment, so a dot in an API path is a normal shape here, not an
// exotic one an attacker has to force.
describe('dotted API paths never bypass authentication', () => {
  const dotted = [
    '/api/v1/guests/conn1:qemu:pve1.internal:100/notes',
    '/api/v1/guests/conn1:qemu:pve1.internal:100/tasks',
    '/api/v1/guests/conn1:lxc:pve1.internal:100/features',
    '/api/v1/nodes/pve1.internal/storage',
    '/api/v1/storage/conn1:local/content/local:iso/debian-12.iso',
  ]

  for (const path of dotted) {
    it(`answers 401 to an unauthenticated GET ${path}`, async () => {
      const res = await middleware(request(path) as any)

      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'Not authenticated' })
    })
  }

  it('answers 401 to an unauthenticated write on a dotted API path', async () => {
    const res = await middleware(
      request('/api/v1/guests/conn1:qemu:pve1.internal:100/notes', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
      }) as any
    )

    expect(res.status).toBe(401)
  })

  it('lets an authenticated caller through a dotted API path', async () => {
    getTokenMock.mockResolvedValue({ sub: 'u1', authAt: Date.now() })

    const res = await middleware(request('/api/v1/guests/conn1:qemu:pve1.internal:100/notes') as any)

    expect(passedThrough(res)).toBe(true)
  })
})

// The dot rule still has a job to do OUTSIDE /api: it is what keeps static
// files off the login redirect. Narrowing it must not cost that.
describe('static assets and public routes keep passing', () => {
  const assets = ['/logo.png', '/fonts/inter.woff2', '/_next/static/chunk.js', '/favicon.ico']

  for (const path of assets) {
    it(`passes ${path} through unauthenticated`, async () => {
      const res = await middleware(request(path) as any)

      expect(passedThrough(res)).toBe(true)
    })
  }

  const publicApi = [
    '/api/auth/session',
    '/api/health',
    '/api/v1/auth/setup',
    '/api/v1/settings/branding/uploads/logo.png',
    '/api/v1/settings/login-background/serve?name=bg.jpg',
  ]

  for (const path of publicApi) {
    it(`keeps the public API route ${path} reachable unauthenticated`, async () => {
      const res = await middleware(request(path) as any)

      expect(passedThrough(res)).toBe(true)
    })
  }
})
