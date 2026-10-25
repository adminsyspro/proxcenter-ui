import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above this file's top-level `const` bindings, so the
// mock object itself must come from vi.hoisted (same convention as
// src/lib/tls/challengeStore.test.ts) or the factory below reads
// `challenges` while it is still in the TDZ.
const { challenges } = vi.hoisted(() => ({
  challenges: { putChallenge: vi.fn(), dropChallenge: vi.fn() },
}))

vi.mock('@/lib/tls/challengeStore', () => challenges)

import { preflightHttp01 } from '@/lib/tls/preflight'

beforeEach(() => vi.clearAllMocks())

describe('preflightHttp01', () => {
  it('passes when the probe value comes back from every domain', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      const token = String(url).split('/').pop()
      const keyAuth = challenges.putChallenge.mock.calls.find(c => c[0] === token)?.[1]

      return new Response(keyAuth, { status: 200 })
    })

    await expect(preflightHttp01(['a.lab', 'b.lab'], fetchImpl as any)).resolves.toEqual({ ok: true, failures: [] })
  })

  it('names the domain that answered something else', async () => {
    const fetchImpl = vi.fn(async () => new Response('nginx default page', { status: 200 }))

    const result = await preflightHttp01(['a.lab'], fetchImpl as any)

    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatchObject({ domain: 'a.lab' })
  })

  it('reports an unreachable domain instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('ECONNREFUSED') })

    const result = await preflightHttp01(['a.lab'], fetchImpl as any)

    expect(result.ok).toBe(false)
    expect(result.failures[0].reason).toContain('ECONNREFUSED')
  })

  it('always removes its probe challenge, even when the fetch blows up', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('boom') })

    await preflightHttp01(['a.lab'], fetchImpl as any)

    expect(challenges.dropChallenge).toHaveBeenCalledTimes(1)
  })

  it('skips wildcards, which HTTP-01 can never validate', async () => {
    const fetchImpl = vi.fn(async () => new Response('x'))

    const result = await preflightHttp01(['*.lab'], fetchImpl as any)

    expect(result.ok).toBe(false)
    expect(result.failures[0].reason).toMatch(/wildcard/i)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
