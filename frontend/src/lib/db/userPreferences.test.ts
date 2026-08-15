import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findUnique, upsert } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    userPreference: { findUnique, upsert },
  },
}))

import { getUserAppearance, setUserAppearance } from './userPreferences'

beforeEach(() => {
  vi.clearAllMocks()
  upsert.mockResolvedValue({})
})

describe('getUserAppearance', () => {
  it('returns null for a missing row and uses the composite tenant/user key', async () => {
    findUnique.mockResolvedValue(null)

    await expect(getUserAppearance('tenant-1', 'user-1')).resolves.toBeNull()
    expect(findUnique).toHaveBeenCalledWith({
      where: { tenantId_userId: { tenantId: 'tenant-1', userId: 'user-1' } },
      select: { appearance: true },
    })
  })

  it('sanitizes a hostile stored row before returning it', async () => {
    findUnique.mockResolvedValue({
      appearance: { primaryColor: 'not-a-colour', fontSize: 99, mode: 'dark' },
    })

    await expect(getUserAppearance('tenant-1', 'user-1')).resolves.toEqual({ mode: 'dark' })
  })
})

describe('setUserAppearance', () => {
  it('merges an incoming partial update over the stored appearance', async () => {
    findUnique.mockResolvedValue({ appearance: { mode: 'dark', primaryColor: '#E57000' } })

    const result = await setUserAppearance('tenant-1', 'user-1', { primaryColor: '#FFD200' })
    const appearance = { mode: 'dark', primaryColor: '#FFD200' }

    expect(upsert).toHaveBeenCalledWith({
      where: { tenantId_userId: { tenantId: 'tenant-1', userId: 'user-1' } },
      create: { tenantId: 'tenant-1', userId: 'user-1', appearance },
      update: { appearance },
    })
    expect(result).toEqual(appearance)
  })

  it('drops invalid incoming keys before writing', async () => {
    findUnique.mockResolvedValue({ appearance: { mode: 'dark' } })

    await setUserAppearance('tenant-1', 'user-1', {
      mode: 'sepia',
      primaryColor: 'javascript:alert(1)',
      evil: true,
    })

    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ appearance: { mode: 'dark' } }),
        update: { appearance: { mode: 'dark' } },
      }),
    )
  })

  it('creates the first stored appearance when no row exists', async () => {
    findUnique.mockResolvedValue(null)
    const appearance = { mode: 'light', primaryColor: '#FFD200' }

    await expect(setUserAppearance('tenant-2', 'user-2', appearance)).resolves.toEqual(appearance)
    expect(upsert).toHaveBeenCalledWith({
      where: { tenantId_userId: { tenantId: 'tenant-2', userId: 'user-2' } },
      create: { tenantId: 'tenant-2', userId: 'user-2', appearance },
      update: { appearance },
    })
  })
})
