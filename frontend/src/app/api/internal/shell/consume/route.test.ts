import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const consumeMock = vi.fn()

vi.mock('@/app/api/v1/connections/[id]/nodes/[node]/terminal/route', () => ({
  consumeTerminalSession: (...args: unknown[]) => consumeMock(...args),
}))

import { POST } from './route'

const PROXY_CALLER = 'proxcenter-ws-proxy'

function makeReq(headers: Record<string, string>, body: unknown = { sessionId: 'abc' }) {
  return new Request('http://localhost/api/internal/shell/consume', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

const originalSecret = process.env.APP_SECRET

beforeEach(() => {
  consumeMock.mockReset()
  process.env.APP_SECRET = 'shell-test-secret'
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.APP_SECRET
  else process.env.APP_SECRET = originalSecret
})

describe('POST /api/internal/shell/consume', () => {
  it('rejects with 403 when the caller fingerprint is missing', async () => {
    const res = await POST(makeReq({ 'X-Internal-Secret': 'shell-test-secret' }))
    expect(res.status).toBe(403)
    expect(consumeMock).not.toHaveBeenCalled()
  })

  it('rejects with 403 when the shared secret is wrong', async () => {
    const res = await POST(
      makeReq({ 'X-Internal-Caller': PROXY_CALLER, 'X-Internal-Secret': 'wrong' })
    )
    expect(res.status).toBe(403)
    expect(consumeMock).not.toHaveBeenCalled()
  })

  it('returns 400 when the body has no sessionId', async () => {
    const res = await POST(
      makeReq(
        { 'X-Internal-Caller': PROXY_CALLER, 'X-Internal-Secret': 'shell-test-secret' },
        {}
      )
    )
    expect(res.status).toBe(400)
    expect(consumeMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the session lookup misses', async () => {
    consumeMock.mockReturnValueOnce(null)
    const res = await POST(
      makeReq({ 'X-Internal-Caller': PROXY_CALLER, 'X-Internal-Secret': 'shell-test-secret' })
    )
    expect(res.status).toBe(404)
    expect(consumeMock).toHaveBeenCalledWith('abc')
  })

  it('returns the full session payload on a hit, including the per-connection insecure flag', async () => {
    consumeMock.mockReturnValueOnce({
      baseUrl: 'https://pve.example:8006',
      host: 'pve.example',
      pvePort: 8006,
      apiToken: 'pve!tok=secret',
      insecure: true,
      node: 'pve1',
      port: 5900,
      ticket: 'PVE:ticket',
      user: 'root@pam!root',
      upid: 'UPID:1',
      expiresAt: Date.now() + 10_000,
    })

    const res = await POST(
      makeReq({ 'X-Internal-Caller': PROXY_CALLER, 'X-Internal-Secret': 'shell-test-secret' })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      baseUrl: 'https://pve.example:8006',
      host: 'pve.example',
      pvePort: 8006,
      apiToken: 'pve!tok=secret',
      insecure: true,
      node: 'pve1',
      port: 5900,
      ticket: 'PVE:ticket',
      user: 'root@pam!root',
      upid: 'UPID:1',
    })
  })

  it('preserves insecure=false so ws-proxy enables strict TLS', async () => {
    consumeMock.mockReturnValueOnce({
      baseUrl: 'https://pve.example:8006',
      host: 'pve.example',
      pvePort: 8006,
      apiToken: 'pve!tok=secret',
      insecure: false,
      node: 'pve1',
      port: 5900,
      ticket: 'PVE:ticket',
      user: 'root@pam!root',
      upid: 'UPID:1',
      expiresAt: Date.now() + 10_000,
    })
    const res = await POST(
      makeReq({ 'X-Internal-Caller': PROXY_CALLER, 'X-Internal-Secret': 'shell-test-secret' })
    )
    const body = await res.json()
    expect(body.insecure).toBe(false)
  })
})
