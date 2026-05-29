import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const pveFetchMock = vi.fn()
const getConnectionByIdMock = vi.fn()
const checkPermissionMock = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: (...args: unknown[]) => pveFetchMock(...args),
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: (...args: unknown[]) => getConnectionByIdMock(...args),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: { NODE_CONSOLE: 'node.console' },
}))

import { POST, consumeTerminalSession } from './route'

function makeCtx(id: string, node: string) {
  return { params: Promise.resolve({ id, node }) }
}

beforeEach(() => {
  pveFetchMock.mockReset()
  getConnectionByIdMock.mockReset()
  checkPermissionMock.mockReset()
  checkPermissionMock.mockResolvedValue(null) // allow by default
})

describe('POST /api/v1/connections/[id]/nodes/[node]/terminal', () => {
  it('forwards an RBAC denial without calling the orchestrator', async () => {
    const deniedResponse = NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    checkPermissionMock.mockResolvedValueOnce(deniedResponse)
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'pve1'))
    expect(res.status).toBe(403)
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the connection is unknown', async () => {
    getConnectionByIdMock.mockResolvedValueOnce(null)
    const res = await POST(new Request('http://localhost'), makeCtx('unknown', 'pve1'))
    expect(res.status).toBe(404)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns 500 when baseUrl cannot be parsed to a host', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({
      baseUrl: 'not-a-url-at-all',
      apiToken: 'token',
    })
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'pve1'))
    expect(res.status).toBe(500)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns 500 when termproxy responds without a ticket', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({
      baseUrl: 'https://pve.example:8006',
      apiToken: 'token',
    })
    pveFetchMock.mockResolvedValueOnce({ port: 5900 })
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'pve1'))
    expect(res.status).toBe(500)
  })

  it('returns 500 when pveFetch throws', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({
      baseUrl: 'https://pve.example:8006',
      apiToken: 'token',
    })
    pveFetchMock.mockRejectedValueOnce(new Error('connection refused'))
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'pve1'))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toContain('connection refused')
  })

  it('returns a sessionId + display payload on success and stores the upstream session server-side', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({
      baseUrl: 'https://pve.example:8006',
      apiToken: 'token-secret',
    })
    pveFetchMock.mockResolvedValueOnce({
      ticket: 'PVE:ticket',
      port: 5900,
      user: 'root@pam!root',
      upid: 'UPID:1',
    })

    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'pve1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toMatchObject({
      sessionId: expect.any(String),
      host: 'pve.example',
      node: 'pve1',
      expiresAt: expect.any(Number),
    })
    // Critical: apiToken must not be in the browser-facing payload.
    expect(body.data).not.toHaveProperty('apiToken')
    expect(body.data).not.toHaveProperty('ticket')

    // The corresponding upstream session is reachable via the
    // server-only helper.
    const stored = consumeTerminalSession(body.data.sessionId)
    expect(stored).toMatchObject({
      apiToken: 'token-secret',
      ticket: 'PVE:ticket',
      host: 'pve.example',
      pvePort: 8006,
      node: 'pve1',
      port: 5900,
      user: 'root@pam!root',
      upid: 'UPID:1',
    })
  })

  it('defaults pvePort to 8006 when baseUrl has no explicit port', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({
      baseUrl: 'https://pve.example',
      apiToken: 'token',
    })
    pveFetchMock.mockResolvedValueOnce({
      ticket: 'PVE:t',
      port: 5900,
      user: 'u',
      upid: 'UPID:1',
    })
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'pve1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    const stored = consumeTerminalSession(body.data.sessionId)
    expect(stored?.pvePort).toBe(8006)
  })
})

describe('consumeTerminalSession', () => {
  it('returns null for an unknown sessionId', () => {
    expect(consumeTerminalSession('does-not-exist')).toBeNull()
  })

  it('is single-use: a second consume of the same id returns null', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({
      baseUrl: 'https://pve.example:8006',
      apiToken: 'token',
    })
    pveFetchMock.mockResolvedValueOnce({
      ticket: 'PVE:t',
      port: 5900,
      user: 'u',
      upid: 'UPID:1',
    })
    const res = await POST(new Request('http://localhost'), makeCtx('c1', 'pve1'))
    const { data: { sessionId } } = await res.json()
    expect(consumeTerminalSession(sessionId)).not.toBeNull()
    expect(consumeTerminalSession(sessionId)).toBeNull()
  })

  it('returns null for a session that has already expired by the time it is consumed', async () => {
    getConnectionByIdMock.mockResolvedValueOnce({
      baseUrl: 'https://pve.example:8006',
      apiToken: 'token',
    })
    pveFetchMock.mockResolvedValueOnce({
      ticket: 'PVE:t',
      port: 5900,
      user: 'u',
      upid: 'UPID:1',
    })

    // Freeze "now" past the 30 s TTL between session creation and the
    // consume call so the expiry branch runs deterministically.
    const realNow = Date.now
    const t0 = realNow()
    Date.now = () => t0
    try {
      const res = await POST(new Request('http://localhost'), makeCtx('c1', 'pve1'))
      const { data: { sessionId } } = await res.json()
      Date.now = () => t0 + 60_000 // 60 s later
      expect(consumeTerminalSession(sessionId)).toBeNull()
    } finally {
      Date.now = realNow
    }
  })
})
