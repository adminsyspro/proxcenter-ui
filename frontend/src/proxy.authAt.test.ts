import { describe, it, expect, afterEach, vi } from 'vitest'

const { getTokenMock } = vi.hoisted(() => ({
  getTokenMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))

import { NextRequest } from 'next/server'

import { proxy } from './proxy'

afterEach(() => {
  vi.clearAllMocks()
  delete process.env.SESSION_ABSOLUTE_TIMEOUT
})

const req = (path: string) => new NextRequest(new URL(`http://h:3000${path}`))

describe('proxy enforces the absolute cap from authAt, with no DB access', () => {
  it('redirects to /login when authAt is past the cap', async () => {
    process.env.SESSION_ABSOLUTE_TIMEOUT = '3600'
    getTokenMock.mockResolvedValue({ id: 'u1', sid: 's1', authAt: Date.now() - 7200_000 })

    const res = await proxy(req('/dashboard'))

    expect(res?.status).toBe(307)
    expect(res?.headers.get('location')).toContain('/login')
  })

  it('lets a recent authAt through', async () => {
    process.env.SESSION_ABSOLUTE_TIMEOUT = '3600'
    getTokenMock.mockResolvedValue({ id: 'u1', sid: 's1', authAt: Date.now() - 60_000 })

    const res = await proxy(req('/dashboard'))

    expect(res?.headers.get('location')).toBeNull()
  })

  it('lets a token with no authAt through, leaving refusal to the read path', async () => {
    getTokenMock.mockResolvedValue({ id: 'u1', sid: 's1' })

    const res = await proxy(req('/dashboard'))

    expect(res?.headers.get('location')).toBeNull()
  })

  it('never redirects /login itself, so an expired session cannot loop', async () => {
    process.env.SESSION_ABSOLUTE_TIMEOUT = '3600'
    getTokenMock.mockResolvedValue({ id: 'u1', sid: 's1', authAt: Date.now() - 7200_000 })

    const res = await proxy(req('/login'))

    expect(res?.headers.get('location')).toBeNull()
  })

  // The two tests below pin ROUTING SEPARATION, not the authAt gate itself.
  // Both paths have isApiPath === true, so they short-circuit in the
  // public-route check (isPublicRoute / isPublicApiRoute) before the
  // page-navigation branch that holds the authAt check above is ever
  // reached — getToken is never even called for them. They exist to catch a
  // future refactor that accidentally merges the API and page branches and
  // lets the authAt redirect leak onto API routes (which expect JSON, not a
  // redirect).
  it('routes /api/auth/* through the public-route short-circuit, never reaching the authAt check', async () => {
    process.env.SESSION_ABSOLUTE_TIMEOUT = '3600'
    getTokenMock.mockResolvedValue({ id: 'u1', sid: 's1', authAt: Date.now() - 7200_000 })

    const res = await proxy(req('/api/auth/session'))

    expect(res?.headers.get('location')).toBeNull()
    expect(getTokenMock).not.toHaveBeenCalled()
  })

  it('routes the public API allowlist through the same short-circuit, never reaching the authAt check', async () => {
    process.env.SESSION_ABSOLUTE_TIMEOUT = '3600'
    getTokenMock.mockResolvedValue({ id: 'u1', sid: 's1', authAt: Date.now() - 7200_000 })

    const res = await proxy(req('/api/health'))

    expect(res?.headers.get('location')).toBeNull()
    expect(getTokenMock).not.toHaveBeenCalled()
  })
})
