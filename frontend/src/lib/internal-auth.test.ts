import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { requireInternalCaller } from './internal-auth'

const PROXY_CALLER = 'proxcenter-ws-proxy'

function makeReq(headers: Record<string, string>): Request {
  return new Request('http://localhost/api/internal/shell/consume', {
    method: 'POST',
    headers,
    body: JSON.stringify({ sessionId: 'x' }),
  })
}

describe('requireInternalCaller', () => {
  const originalSecret = process.env.APP_SECRET

  beforeEach(() => {
    process.env.APP_SECRET = 'shared-secret-for-tests'
  })

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.APP_SECRET
    } else {
      process.env.APP_SECRET = originalSecret
    }
  })

  it('returns null (allowed) when caller fingerprint and secret both match', async () => {
    const req = makeReq({
      'x-internal-caller': PROXY_CALLER,
      'x-internal-secret': 'shared-secret-for-tests',
    })
    expect(requireInternalCaller(req)).toBeNull()
  })

  it('returns 403 when the caller fingerprint header is missing', async () => {
    const req = makeReq({
      'x-internal-secret': 'shared-secret-for-tests',
    })
    const res = requireInternalCaller(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('returns 403 when the caller fingerprint header has the wrong value', async () => {
    const req = makeReq({
      'x-internal-caller': 'someone-else',
      'x-internal-secret': 'shared-secret-for-tests',
    })
    const res = requireInternalCaller(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('returns 403 when the shared secret is missing', async () => {
    const req = makeReq({
      'x-internal-caller': PROXY_CALLER,
    })
    const res = requireInternalCaller(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('returns 403 when the shared secret does not match', async () => {
    const req = makeReq({
      'x-internal-caller': PROXY_CALLER,
      'x-internal-secret': 'wrong-secret',
    })
    const res = requireInternalCaller(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('returns 403 when the provided secret is shorter than the expected one', async () => {
    // Different-length inputs exercise the early-return branch of the
    // constant-time compare. The function still must not throw.
    const req = makeReq({
      'x-internal-caller': PROXY_CALLER,
      'x-internal-secret': 'short',
    })
    const res = requireInternalCaller(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(403)
  })

  it('returns 500 when APP_SECRET is unset on the server', async () => {
    delete process.env.APP_SECRET
    const req = makeReq({
      'x-internal-caller': PROXY_CALLER,
      'x-internal-secret': 'anything',
    })
    const res = requireInternalCaller(req)
    expect(res).not.toBeNull()
    expect(res!.status).toBe(500)
  })
})
