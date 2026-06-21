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

import { getConnectionById, getConnectionByIdOrNull, isConnectionNotFoundError } from './getConnection'

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

describe('isConnectionNotFoundError', () => {
  it('returns true for a PVE "Connection not found" error', () => {
    expect(isConnectionNotFoundError(new Error('Connection not found: c1'))).toBe(true)
  })

  it('returns true for a PBS "PBS Connection not found" error', () => {
    expect(isConnectionNotFoundError(new Error('PBS Connection not found: c1'))).toBe(true)
  })

  it('returns false for a config error (no baseUrl)', () => {
    expect(isConnectionNotFoundError(new Error('Connection c1 has no baseUrl'))).toBe(false)
  })

  it('returns false for a generic DB/infra error', () => {
    expect(isConnectionNotFoundError(new Error('DB exploded'))).toBe(false)
  })

  it('returns false for null', () => {
    expect(isConnectionNotFoundError(null)).toBe(false)
  })

  it('returns false for a non-Error value', () => {
    expect(isConnectionNotFoundError('Connection not found')).toBe(false)
  })
})

describe('getConnectionByIdOrNull', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFindFirst.mockResolvedValue(null)
  })

  it('returns the connection when it resolves', async () => {
    mockFindUnique.mockResolvedValue({ ...MSP_CONNECTION, id: 'c-ok', tenantId: 't-ok' })

    const result = await getConnectionByIdOrNull('c-ok', 't-ok')

    expect(result).not.toBeNull()
    expect(result?.id).toBe('c-ok')
  })

  it('returns null for a genuine not-found error', async () => {
    mockFindUnique.mockResolvedValue(null)

    const result = await getConnectionByIdOrNull('c-missing', 't-x')

    expect(result).toBeNull()
  })

  it('rethrows a non-not-found error (config/infra) instead of swallowing it', async () => {
    mockFindUnique.mockResolvedValue({ ...MSP_CONNECTION, id: 'c-nobase', tenantId: 't-nb', baseUrl: null })

    await expect(getConnectionByIdOrNull('c-nobase', 't-nb')).rejects.toThrow(/baseUrl/)
  })
})
