import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.hoisted() so the mock factories run before any module import
const { mockFindUnique, mockFindFirst, mockDecryptSecret } = vi.hoisted(() => {
  const mockFindUnique = vi.fn()
  const mockFindFirst = vi.fn()
  const mockDecryptSecret = vi.fn((s: string) => s)
  return { mockFindUnique, mockFindFirst, mockDecryptSecret }
})

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    connection: { findUnique: mockFindUnique },
    vdc: { findFirst: mockFindFirst },
  },
}))

vi.mock('@/lib/crypto/secret', () => ({
  decryptSecret: mockDecryptSecret,
}))

// getCurrentTenantId should not be called — we pass tenantId explicitly
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn(() => { throw new Error('getCurrentTenantId must not be called in these tests') }),
}))

import { getConnectionById } from './getConnection'

const MSP_CONNECTION = {
  id: 'c-msp',
  name: 'MSP Connection',
  baseUrl: 'https://pve.example.com:8006',
  behindProxy: false,
  insecureTLS: false,
  apiTokenEnc: 'enc-token',
  tenantId: 't-msp',
}

describe('getConnectionById — MSP direct tenant ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirst.mockResolvedValue(null)
  })

  it('(a) owning tenant can read the connection directly', async () => {
    mockFindUnique.mockResolvedValue(MSP_CONNECTION)

    const result = await getConnectionById('c-msp', 't-msp')

    expect(result.id).toBe('c-msp')
    expect(result.name).toBe('MSP Connection')
    expect(result.baseUrl).toBe('https://pve.example.com:8006')
    // vdc.findFirst must NOT have been called — ownership match skips it
    expect(mockFindFirst).not.toHaveBeenCalled()
  })

  it('(b) different tenant is denied when no vDC binding exists', async () => {
    mockFindUnique.mockResolvedValue(MSP_CONNECTION)
    // vdc.findFirst already returns null via beforeEach

    await expect(getConnectionById('c-msp', 't-other')).rejects.toThrow(
      'Connection not found: c-msp',
    )
    // vdc.findFirst must have been consulted
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId: 't-other', connectionId: 'c-msp' }),
      }),
    )
  })
})
