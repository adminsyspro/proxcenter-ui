import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above this file's top-level `const` bindings, so the
// mock object itself must come from vi.hoisted (same convention as
// src/lib/tls/store.test.ts and src/lib/tls/settings.test.ts) or the factory
// below reads `prismaMock` while it is still in the TDZ.
const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    tlsAcmeChallenge: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))

import { CHALLENGE_TTL_MS, dropChallenge, purgeExpiredChallenges, putChallenge, takeChallenge } from '@/lib/tls/challengeStore'

beforeEach(() => vi.clearAllMocks())

describe('putChallenge', () => {
  it('stores the key authorization with an expiry in the future', async () => {
    prismaMock.tlsAcmeChallenge.upsert.mockResolvedValue({})

    await putChallenge('tok', 'tok.thumb', 'pc.lab')

    const { create } = prismaMock.tlsAcmeChallenge.upsert.mock.calls[0][0]

    expect(create.keyAuth).toBe('tok.thumb')
    expect(create.expiresAt.getTime()).toBeGreaterThan(Date.now())
    expect(create.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + CHALLENGE_TTL_MS)
  })
})

describe('takeChallenge', () => {
  it('returns the key authorization of a live challenge', async () => {
    prismaMock.tlsAcmeChallenge.findUnique.mockResolvedValue({
      token: 'tok', keyAuth: 'tok.thumb', expiresAt: new Date(Date.now() + 60_000),
    })

    await expect(takeChallenge('tok')).resolves.toBe('tok.thumb')
  })

  it('treats an expired challenge as absent', async () => {
    prismaMock.tlsAcmeChallenge.findUnique.mockResolvedValue({
      token: 'tok', keyAuth: 'tok.thumb', expiresAt: new Date(Date.now() - 1),
    })

    await expect(takeChallenge('tok')).resolves.toBeNull()
  })

  it('returns null on an unknown token', async () => {
    prismaMock.tlsAcmeChallenge.findUnique.mockResolvedValue(null)

    await expect(takeChallenge('nope')).resolves.toBeNull()
  })
})

describe('dropChallenge', () => {
  it('deletes the challenge by token', async () => {
    prismaMock.tlsAcmeChallenge.delete.mockResolvedValue({})

    await dropChallenge('tok')

    expect(prismaMock.tlsAcmeChallenge.delete).toHaveBeenCalledWith({ where: { token: 'tok' } })
  })

  it('does not throw when the row is already gone', async () => {
    prismaMock.tlsAcmeChallenge.delete.mockRejectedValue(new Error('Record to delete does not exist.'))

    await expect(dropChallenge('nope')).resolves.toBeUndefined()
  })
})

describe('purgeExpiredChallenges', () => {
  it('deletes only the rows already past their expiry', async () => {
    prismaMock.tlsAcmeChallenge.deleteMany.mockResolvedValue({ count: 3 })

    await expect(purgeExpiredChallenges()).resolves.toBe(3)
    expect(prismaMock.tlsAcmeChallenge.deleteMany.mock.calls[0][0].where.expiresAt.lt).toBeInstanceOf(Date)
  })
})
