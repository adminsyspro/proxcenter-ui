import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above this file's top-level `const` bindings, so the
// mock object itself must come from vi.hoisted (same convention as
// src/lib/tls/challengeStore.test.ts) or the factory below reads
// `challenges` while it is still in the TDZ.
const { challenges } = vi.hoisted(() => ({
  challenges: { takeChallenge: vi.fn() },
}))

vi.mock('@/lib/tls/challengeStore', () => challenges)

import { GET } from '@/app/api/acme/challenge/[token]/route'

beforeEach(() => vi.clearAllMocks())

function call(token: string) {
  return GET(new Request(`http://pc.lab/api/acme/challenge/${token}`), { params: Promise.resolve({ token }) })
}

describe('GET /api/acme/challenge/[token]', () => {
  it('serves the key authorization as plain text, unauthenticated', async () => {
    challenges.takeChallenge.mockResolvedValue('tok.thumbprint')

    const res = await call('tok')

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/plain')
    await expect(res.text()).resolves.toBe('tok.thumbprint')
  })

  it('answers 404 on an unknown or expired token', async () => {
    challenges.takeChallenge.mockResolvedValue(null)

    expect((await call('nope')).status).toBe(404)
  })

  it('never caches: a stale challenge would fail the next order', async () => {
    challenges.takeChallenge.mockResolvedValue('x')

    expect((await call('tok')).headers.get('cache-control')).toContain('no-store')
  })
})
