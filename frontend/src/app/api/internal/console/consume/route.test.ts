import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'

const consumeMock = vi.fn()

vi.mock('@/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/console/route', () => ({
  consumeConsoleSession: (...args: unknown[]) => consumeMock(...args),
}))

import { POST } from './route'

const PROXY_CALLER = 'proxcenter-ws-proxy'

function makeReq(headers: Record<string, string>, body: unknown = { sessionId: 'abc' }) {
  return new Request('http://localhost/api/internal/console/consume', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

const originalSecret = process.env.APP_SECRET

beforeEach(() => {
  consumeMock.mockReset()
  process.env.APP_SECRET = 'console-test-secret'
})

afterEach(() => {
  if (originalSecret === undefined) delete process.env.APP_SECRET
  else process.env.APP_SECRET = originalSecret
})

describe('POST /api/internal/console/consume', () => {
  it('rejects with 403 when the caller fingerprint is missing', async () => {
    const res = await POST(makeReq({ 'X-Internal-Secret': 'console-test-secret' }))
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
        { 'X-Internal-Caller': PROXY_CALLER, 'X-Internal-Secret': 'console-test-secret' },
        {}
      )
    )
    expect(res.status).toBe(400)
    expect(consumeMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the session lookup misses', async () => {
    consumeMock.mockReturnValueOnce(null)
    const res = await POST(
      makeReq({ 'X-Internal-Caller': PROXY_CALLER, 'X-Internal-Secret': 'console-test-secret' })
    )
    expect(res.status).toBe(404)
    expect(consumeMock).toHaveBeenCalledWith('abc')
  })

  it('returns the VM console session payload on a hit', async () => {
    consumeMock.mockReturnValueOnce({
      baseUrl: 'https://pve.example:8006',
      apiToken: 'pve!tok=secret',
      node: 'pve1',
      type: 'qemu',
      vmid: '100',
      port: 5901,
      ticket: 'PVE:vncticket',
      expiresAt: Date.now() + 10_000,
    })

    const res = await POST(
      makeReq({ 'X-Internal-Caller': PROXY_CALLER, 'X-Internal-Secret': 'console-test-secret' })
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({
      baseUrl: 'https://pve.example:8006',
      apiToken: 'pve!tok=secret',
      node: 'pve1',
      type: 'qemu',
      vmid: '100',
      port: 5901,
      ticket: 'PVE:vncticket',
    })
  })
})
