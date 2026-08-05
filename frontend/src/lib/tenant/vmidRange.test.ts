import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tenantFindUniqueMock, tenantFindFirstMock, connectionFindManyMock, pveFetchMock, getConnectionByIdMock } = vi.hoisted(() => ({
  tenantFindUniqueMock: vi.fn(),
  tenantFindFirstMock: vi.fn(),
  connectionFindManyMock: vi.fn(),
  pveFetchMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    tenant: { findUnique: tenantFindUniqueMock, findFirst: tenantFindFirstMock },
    connection: { findMany: connectionFindManyMock },
  },
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))

import {
  parseVmidRangeInput,
  resolveTenantVmidRange,
  getUsedVmidsForTenant,
  findNextFreeVmid,
  checkVmidAgainstTenantRange,
} from './vmidRange'

beforeEach(() => {
  tenantFindUniqueMock.mockReset()
  tenantFindFirstMock.mockReset().mockResolvedValue(null)
  connectionFindManyMock.mockReset().mockResolvedValue([])
  pveFetchMock.mockReset()
  getConnectionByIdMock.mockReset().mockImplementation(async (id: string) => ({ id, baseUrl: 'x', apiToken: 'y' }))
})

describe('parseVmidRangeInput', () => {
  it('returns undefined when both fields are absent', () => {
    expect(parseVmidRangeInput({})).toEqual({ ok: true, range: undefined })
  })
  it('returns null when both fields are null', () => {
    expect(parseVmidRangeInput({ vmidRangeStart: null, vmidRangeEnd: null })).toEqual({ ok: true, range: null })
  })
  it('accepts a valid range', () => {
    expect(parseVmidRangeInput({ vmidRangeStart: 189334001, vmidRangeEnd: 189334999 }))
      .toEqual({ ok: true, range: { start: 189334001, end: 189334999 } })
  })
  it.each([
    [{ vmidRangeStart: 100 }],
    [{ vmidRangeEnd: 200 }],
    [{ vmidRangeStart: null, vmidRangeEnd: 200 }],
    [{ vmidRangeStart: '100', vmidRangeEnd: 200 }],
    [{ vmidRangeStart: 100.5, vmidRangeEnd: 200 }],
  ])('rejects one-sided or non-integer input %j', (body) => {
    expect(parseVmidRangeInput(body as any).ok).toBe(false)
  })
  it('rejects bounds outside 100..999999999', () => {
    expect(parseVmidRangeInput({ vmidRangeStart: 99, vmidRangeEnd: 200 }).ok).toBe(false)
    expect(parseVmidRangeInput({ vmidRangeStart: 100, vmidRangeEnd: 1_000_000_000 }).ok).toBe(false)
  })
  it('rejects start > end', () => {
    expect(parseVmidRangeInput({ vmidRangeStart: 300, vmidRangeEnd: 200 }).ok).toBe(false)
  })
})

describe('resolveTenantVmidRange', () => {
  it('returns null for the default tenant without querying', async () => {
    expect(await resolveTenantVmidRange('default')).toBeNull()
    expect(tenantFindUniqueMock).not.toHaveBeenCalled()
  })
  it('returns null for iaas tenants even with a stored range', async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: 'iaas', vmidRangeStart: 100, vmidRangeEnd: 200 })
    expect(await resolveTenantVmidRange('t1')).toBeNull()
  })
  it('returns null for MSP tenants without a range', async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: 'msp', vmidRangeStart: null, vmidRangeEnd: null })
    expect(await resolveTenantVmidRange('t1')).toBeNull()
  })
  it('returns the range for MSP tenants with one', async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: 'msp', vmidRangeStart: 189334001, vmidRangeEnd: 189334999 })
    expect(await resolveTenantVmidRange('t1')).toEqual({ start: 189334001, end: 189334999 })
  })
})

describe('getUsedVmidsForTenant', () => {
  it('unions vmids across connections and reports unreachable ones', async () => {
    connectionFindManyMock.mockResolvedValue([
      { id: 'c1', name: 'alpha', tenantId: 't1' },
      { id: 'c2', name: 'beta', tenantId: 't1' },
      { id: 'c3', name: 'gamma', tenantId: 't1' },
    ])
    pveFetchMock
      .mockResolvedValueOnce([{ vmid: 100 }, { vmid: '101' }])
      .mockResolvedValueOnce([{ vmid: 189334001 }])
      .mockRejectedValueOnce(new Error('unreachable'))
    const { used, unreachable } = await getUsedVmidsForTenant('t1')
    expect(used).toEqual(new Set([100, 101, 189334001]))
    expect(unreachable).toEqual(['gamma'])
  })
})

describe('findNextFreeVmid', () => {
  const range = { start: 200, end: 204 }
  it('returns the start when nothing is used', () => {
    expect(findNextFreeVmid(range, new Set())).toBe(200)
  })
  it('fills gaps', () => {
    expect(findNextFreeVmid(range, new Set([200, 201, 203]))).toBe(202)
  })
  it('returns null when exhausted', () => {
    expect(findNextFreeVmid(range, new Set([200, 201, 202, 203, 204]))).toBeNull()
  })
})

describe('checkVmidAgainstTenantRange', () => {
  it('ok when no range applies', async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: 'msp', vmidRangeStart: null, vmidRangeEnd: null })
    expect(await checkVmidAgainstTenantRange('t1', 100)).toEqual({ ok: true })
  })
  it('400 outside the range', async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: 'msp', vmidRangeStart: 200, vmidRangeEnd: 300 })
    const res = await checkVmidAgainstTenantRange('t1', 199)
    expect(res).toMatchObject({ ok: false, status: 400 })
  })
  it('409 when in use somewhere', async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: 'msp', vmidRangeStart: 200, vmidRangeEnd: 300 })
    connectionFindManyMock.mockResolvedValue([{ id: 'c1', name: 'alpha', tenantId: 't1' }])
    pveFetchMock.mockResolvedValue([{ vmid: 250 }])
    const res = await checkVmidAgainstTenantRange('t1', 250)
    expect(res).toMatchObject({ ok: false, status: 409 })
  })
  it('503 (fail closed) when a tenant cluster is unreachable', async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: 'msp', vmidRangeStart: 200, vmidRangeEnd: 300 })
    connectionFindManyMock.mockResolvedValue([
      { id: 'c1', name: 'alpha', tenantId: 't1' },
      { id: 'c2', name: 'beta', tenantId: 't1' },
    ])
    pveFetchMock.mockResolvedValueOnce([{ vmid: 250 }]).mockRejectedValueOnce(new Error('down'))
    const res = await checkVmidAgainstTenantRange('t1', 251)
    expect(res).toMatchObject({ ok: false, status: 503 })
    expect((res as any).error).toContain('beta')
  })
  it('ok for a free in-range vmid', async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: 'msp', vmidRangeStart: 200, vmidRangeEnd: 300 })
    connectionFindManyMock.mockResolvedValue([{ id: 'c1', name: 'alpha', tenantId: 't1' }])
    pveFetchMock.mockResolvedValue([{ vmid: 250 }])
    expect(await checkVmidAgainstTenantRange('t1', 251)).toEqual({ ok: true })
  })
})
