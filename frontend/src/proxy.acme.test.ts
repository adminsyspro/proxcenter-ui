import { describe, it, expect, afterEach, vi } from 'vitest'

const { getTokenMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

import { NextRequest } from 'next/server'

import { proxy } from './proxy'

afterEach(() => vi.clearAllMocks())

const req = (path: string) => new NextRequest(new URL(`http://h:3000${path}`))

// A certificate authority fetches the ACME challenge unauthenticated, from
// the public internet: no JWT can ever exist on that request. Pin both the
// page path a CA actually fetches (rewritten by next.config.mjs) and the
// route it is rewritten onto, plus a control on each list showing the
// exemption is not over-broad.
describe('proxy exempts the ACME HTTP-01 challenge from authentication', () => {
  it('does not redirect /.well-known/acme-challenge/:token to /login', async () => {
    getTokenMock.mockResolvedValue(null)

    const res = await proxy(req('/.well-known/acme-challenge/sometoken'))

    expect(res?.headers.get('location')).toBeNull()
  })

  it('does not 401 /api/acme/challenge/:token, the rewritten target', async () => {
    getTokenMock.mockResolvedValue(null)

    const res = await proxy(req('/api/acme/challenge/sometoken'))

    expect(res?.status).not.toBe(401)
  })

  it('control: an unrelated page is still redirected to /login', async () => {
    getTokenMock.mockResolvedValue(null)

    const res = await proxy(req('/dashboard'))

    expect(res?.status).toBe(307)
    expect(res?.headers.get('location')).toContain('/login')
  })

  it('control: an unrelated API route still gets 401', async () => {
    getTokenMock.mockResolvedValue(null)

    const res = await proxy(req('/api/v1/settings/tls'))

    expect(res?.status).toBe(401)
  })
})
