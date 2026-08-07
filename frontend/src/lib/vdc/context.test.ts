/**
 * MOCK-based tests for getVdcContext (pc_vdc_context cookie validation).
 * Fail-open contract: any anomaly (no cookie, foreign/unknown/disabled vDC,
 * cookies() throwing outside a request scope) returns null = union view.
 * Run: npx vitest run --config vitest.unit.config.ts src/lib/vdc/context.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { cookiesMock, vdcFindFirstMock } = vi.hoisted(() => ({
  cookiesMock: vi.fn<() => Promise<any>>(),
  vdcFindFirstMock: vi.fn(),
}))

vi.mock('next/headers', () => ({ cookies: cookiesMock }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { vdc: { findFirst: vdcFindFirstMock } } }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))

import { clearVdcContextCache, getVdcContext } from './context'

const cookieJar = (value?: string) => ({
  get: (name: string) =>
    name === 'pc_vdc_context' && value !== undefined ? { value } : undefined,
})

beforeEach(() => {
  vi.clearAllMocks()
  clearVdcContextCache() // flush the module-level validation memo between cases
  cookiesMock.mockResolvedValue(cookieJar(undefined))
  vdcFindFirstMock.mockResolvedValue(null)
})

describe('getVdcContext', () => {
  it('returns the vdcId when the cookie points to an enabled vDC of the tenant', async () => {
    cookiesMock.mockResolvedValue(cookieJar('v42'))
    vdcFindFirstMock.mockResolvedValue({ id: 'v42' })
    await expect(getVdcContext('t1')).resolves.toBe('v42')
    expect(vdcFindFirstMock).toHaveBeenCalledWith({
      where: { id: 'v42', tenantId: 't1', enabled: true },
      select: { id: true },
    })
  })

  it('returns null when no cookie is set (union view)', async () => {
    await expect(getVdcContext('t1')).resolves.toBeNull()
    expect(vdcFindFirstMock).not.toHaveBeenCalled()
  })

  it('returns null for a vdcId of another tenant / unknown / disabled (validation query misses)', async () => {
    cookiesMock.mockResolvedValue(cookieJar('v-foreign'))
    vdcFindFirstMock.mockResolvedValue(null)
    await expect(getVdcContext('t1')).resolves.toBeNull()
  })

  it('returns null when cookies() throws (job / test / non-request scope)', async () => {
    cookiesMock.mockRejectedValue(new Error('cookies called outside a request scope'))
    await expect(getVdcContext('t1')).resolves.toBeNull()
  })

  it('short-circuits the provider tenant without reading cookies', async () => {
    await expect(getVdcContext('default')).resolves.toBeNull()
    expect(cookiesMock).not.toHaveBeenCalled()
  })

  it('returns null when the validation query rejects (DB error → union, never throws)', async () => {
    cookiesMock.mockResolvedValue(cookieJar('v42'))
    vdcFindFirstMock.mockRejectedValue(new Error('connection lost'))
    await expect(getVdcContext('t1')).resolves.toBeNull()
  })

  it('memoizes the validation result for 5s per (tenant, vdcId)', async () => {
    cookiesMock.mockResolvedValue(cookieJar('v42'))
    vdcFindFirstMock.mockResolvedValue({ id: 'v42' })
    await getVdcContext('t1')
    await getVdcContext('t1')
    expect(vdcFindFirstMock).toHaveBeenCalledTimes(1)
  })

  it('does not memoize a failed validation (unknown id) -- every call re-queries', async () => {
    cookiesMock.mockResolvedValue(cookieJar('v-unknown'))
    vdcFindFirstMock.mockResolvedValue(null)
    await getVdcContext('t1')
    await getVdcContext('t1')
    expect(vdcFindFirstMock).toHaveBeenCalledTimes(2)
  })
})
