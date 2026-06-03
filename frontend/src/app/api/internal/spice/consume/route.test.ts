// .../internal/spice/consume/route.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

const requireInternalCallerMock = vi.fn()
const consumeSpiceSessionMock = vi.fn()

vi.mock('@/lib/internal-auth', () => ({
  requireInternalCaller: (...a: unknown[]) => requireInternalCallerMock(...a),
}))
vi.mock('@/app/api/v1/connections/[id]/guests/[type]/[node]/[vmid]/spice/route', () => ({
  consumeSpiceSession: (...a: unknown[]) => consumeSpiceSessionMock(...a),
}))

import { POST } from './route'

function req(body: any) {
  return new Request('http://localhost/api/internal/spice/consume', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  requireInternalCallerMock.mockReset()
  consumeSpiceSessionMock.mockReset()
  requireInternalCallerMock.mockReturnValue(null) // allow by default
})

describe('POST /api/internal/spice/consume', () => {
  it('rejects an unauthenticated caller', async () => {
    requireInternalCallerMock.mockReturnValueOnce(NextResponse.json({ error: 'no' }, { status: 401 }))
    const res = await POST(req({ sessionId: 's' }))
    expect(res.status).toBe(401)
    expect(consumeSpiceSessionMock).not.toHaveBeenCalled()
  })

  it('400 when sessionId is missing', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })

  it('404 for an unknown/expired session', async () => {
    consumeSpiceSessionMock.mockReturnValueOnce(null)
    const res = await POST(req({ sessionId: 'x' }))
    expect(res.status).toBe(404)
  })

  it('returns the bridge params', async () => {
    consumeSpiceSessionMock.mockReturnValueOnce({
      proxyticket: 'pt', proxyHost: '10.0.0.5', proxyPort: 3128, tlsPort: 61000,
      ca: 'CA', hostSubject: 'CN=pve1', insecure: false, node: 'pve1', vmid: '100',
    })
    const res = await POST(req({ sessionId: 's' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ proxyticket: 'pt', proxyHost: '10.0.0.5', tlsPort: 61000 })
  })
})
