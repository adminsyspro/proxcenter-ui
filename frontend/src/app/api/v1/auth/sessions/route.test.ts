import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const {
  getServerSessionMock,
  getTokenMock,
  listSessionsMock,
  revokeSessionMock,
  revokeAllSessionsMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  getTokenMock: vi.fn(),
  listSessionsMock: vi.fn(),
  revokeSessionMock: vi.fn(),
  revokeAllSessionsMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('next-auth/jwt', () => ({ getToken: getTokenMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/auth/cookies', () => ({ sessionCookieName: () => 'next-auth.session-token' }))
vi.mock('@/lib/auth/sessions', () => ({
  listSessions: listSessionsMock,
  revokeSession: revokeSessionMock,
  revokeAllSessions: revokeAllSessionsMock,
}))
// deviceLabel is a small pure heuristic (no I/O) — exercised for real rather
// than mocked, so the browser/os fields in the response get a real assertion.

function row(overrides: Partial<{
  id: string
  ipAddress: string | null
  userAgent: string | null
}> = {}) {
  return {
    id: 'sess-1',
    userId: 'u1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    lastSeenAt: new Date('2026-01-02T00:00:00.000Z'),
    revokedAt: null,
    ipAddress: '10.0.0.1',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0 Safari/537.36',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getServerSessionMock.mockResolvedValue({ user: { id: 'u1', email: 'u1@x' } })
  getTokenMock.mockResolvedValue({ sid: 'sess-1' })
})

describe('GET /api/v1/auth/sessions', () => {
  async function importGET() {
    const mod = await import('./route')
    return mod.GET
  }

  it('returns 401 when there is no session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const GET = await importGET()
    const res = await callRoute(GET as any, { method: 'GET' })
    expect(res.status).toBe(401)
  })

  it("returns only the caller's sessions, with exactly one current:true and ISO date strings", async () => {
    listSessionsMock.mockResolvedValue([
      row({ id: 'sess-1' }),
      row({
        id: 'sess-2',
        ipAddress: '10.0.0.2',
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/119.0',
      }),
    ])

    const GET = await importGET()
    const res = await callRoute(GET as any, { method: 'GET' })
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    expect(listSessionsMock).toHaveBeenCalledWith('u1')
    expect(body.data).toHaveLength(2)

    const currentOnes = body.data.filter((s: any) => s.current)
    expect(currentOnes).toHaveLength(1)
    expect(currentOnes[0].id).toBe('sess-1')

    for (const s of body.data) {
      expect(typeof s.createdAt).toBe('string')
      expect(new Date(s.createdAt).toISOString()).toBe(s.createdAt)
      expect(typeof s.lastSeenAt).toBe('string')
      expect(new Date(s.lastSeenAt).toISOString()).toBe(s.lastSeenAt)
    }

    const other = body.data.find((s: any) => s.id === 'sess-2')
    expect(other.browser).toBe('Firefox')
    expect(other.os).toBe('Linux')
    expect(other.current).toBe(false)
  })

  it('does not crash and marks no session current when the token has no sid', async () => {
    getTokenMock.mockResolvedValue({}) // no sid: pre-hardening token, or a failed row insert at sign-in
    listSessionsMock.mockResolvedValue([row({ id: 'sess-1' }), row({ id: 'sess-2' })])

    const GET = await importGET()
    const res = await callRoute(GET as any, { method: 'GET' })
    expect(res.status).toBe(200)

    const body = await readJson<any>(res)
    expect(body.data).toHaveLength(2)
    expect(body.data.every((s: any) => s.current === false)).toBe(true)
  })
})

describe('DELETE /api/v1/auth/sessions/[sid]', () => {
  async function importDELETE() {
    const mod = await import('./[sid]/route')
    return mod.DELETE
  }

  it('returns 401 when there is no session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { sid: 'sess-1' } })
    expect(res.status).toBe(401)
  })

  it('returns 404, not 403, for a sid belonging to another user, and the body reveals nothing about it', async () => {
    revokeSessionMock.mockResolvedValue(false)
    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { sid: 'someone-elses-sid' },
    })
    expect(res.status).toBe(404)
    expect(res.status).not.toBe(403)

    const body = await readJson<any>(res)
    expect(JSON.stringify(body)).not.toMatch(/someone-elses-sid/)
    expect(revokeSessionMock).toHaveBeenCalledWith('someone-elses-sid', 'u1')
  })

  it("revokes the caller's own sid and succeeds", async () => {
    revokeSessionMock.mockResolvedValue(true)
    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { sid: 'sess-1' } })
    expect(res.status).toBe(200)
    expect(revokeSessionMock).toHaveBeenCalledWith('sess-1', 'u1')
  })
})

describe('DELETE /api/v1/auth/sessions (collection)', () => {
  async function importDELETE() {
    const mod = await import('./route')
    return mod.DELETE
  }

  it('returns 401 when there is no session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: 'DELETE' })
    expect(res.status).toBe(401)
  })

  it("passes the caller's own sid as the exception so the current session survives", async () => {
    revokeAllSessionsMock.mockResolvedValue(3)
    const DELETE = await importDELETE()
    const res = await callRoute(DELETE as any, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(revokeAllSessionsMock).toHaveBeenCalledWith('u1', 'sess-1')

    const body = await readJson<any>(res)
    expect(body.data.revoked).toBe(3)
  })
})
