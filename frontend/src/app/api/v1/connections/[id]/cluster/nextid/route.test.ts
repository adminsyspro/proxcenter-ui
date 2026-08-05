import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { VM_VIEW: 'vm.view' } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-1' }))

const { resolveTenantVmidRangeMock, getUsedVmidsForTenantMock } = vi.hoisted(() => ({
  resolveTenantVmidRangeMock: vi.fn(),
  getUsedVmidsForTenantMock: vi.fn(),
}))
vi.mock('@/lib/tenant/vmidRange', async (io) => {
  const actual = await io<typeof import('@/lib/tenant/vmidRange')>()
  return {
    ...actual,
    resolveTenantVmidRange: (...a: any[]) => resolveTenantVmidRangeMock(...a),
    getUsedVmidsForTenant: (...a: any[]) => getUsedVmidsForTenantMock(...a),
  }
})

async function loadGet() {
  const mod = await import('./route')
  return mod.GET as Parameters<typeof callRoute>[0]
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockReset()
  resolveTenantVmidRangeMock.mockReset().mockResolvedValue(null)
  getUsedVmidsForTenantMock.mockReset().mockResolvedValue({ used: new Set<number>(), unreachable: [] })
  ;(globalThis as any).__proxcenter_recent_vmids__ = new Map()
})

describe('GET nextid — no range', () => {
  it('proxies PVE /cluster/nextid unchanged', async () => {
    pveFetchMock.mockResolvedValue(105)
    const GET = await loadGet()
    const res = await callRoute(GET, { params: { id: 'conn-1' } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: 105, available: true })
    expect(pveFetchMock).toHaveBeenCalledWith(expect.anything(), '/cluster/nextid')
  })
})

describe('GET nextid — with range', () => {
  const range = { start: 200, end: 204 }

  it('returns the lowest free vmid in the range without hitting PVE nextid', async () => {
    resolveTenantVmidRangeMock.mockResolvedValue(range)
    getUsedVmidsForTenantMock.mockResolvedValue({ used: new Set([200, 201]), unreachable: [] })
    const GET = await loadGet()
    const res = await callRoute(GET, { params: { id: 'conn-1' } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: 202, available: true })
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('skips a recently suggested vmid across consecutive GETs', async () => {
    resolveTenantVmidRangeMock.mockResolvedValue(range)
    getUsedVmidsForTenantMock.mockResolvedValue({ used: new Set([200, 201]), unreachable: [] })
    const GET = await loadGet()

    const res1 = await callRoute(GET, { params: { id: 'conn-1' } })
    expect(await readJson(res1)).toEqual({ data: 202, available: true })

    const res2 = await callRoute(GET, { params: { id: 'conn-1' } })
    expect(await readJson(res2)).toEqual({ data: 203, available: true })
  })

  it('409s when the range is exhausted', async () => {
    resolveTenantVmidRangeMock.mockResolvedValue(range)
    getUsedVmidsForTenantMock.mockResolvedValue({ used: new Set([200, 201, 202, 203, 204]), unreachable: [] })
    const GET = await loadGet()
    const res = await callRoute(GET, { params: { id: 'conn-1' } })
    expect(res.status).toBe(409)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain('exhausted')
  })

  it('503s (fail closed) when a tenant cluster is unreachable', async () => {
    resolveTenantVmidRangeMock.mockResolvedValue(range)
    getUsedVmidsForTenantMock.mockResolvedValue({ used: new Set<number>(), unreachable: ['beta'] })
    const GET = await loadGet()
    const res = await callRoute(GET, { params: { id: 'conn-1' } })
    expect(res.status).toBe(503)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toContain('beta')
  })

  it('?vmid= outside the range is not available', async () => {
    resolveTenantVmidRangeMock.mockResolvedValue(range)
    getUsedVmidsForTenantMock.mockResolvedValue({ used: new Set<number>(), unreachable: [] })
    const GET = await loadGet()
    const res = await callRoute(GET, { params: { id: 'conn-1' }, searchParams: { vmid: '199' } })
    expect(res.status).toBe(200)
    const json = await readJson<{ available: boolean; error: string }>(res)
    expect(json?.available).toBe(false)
    expect(json?.error).toContain('200-204')
  })

  it('?vmid= with an invalid format is rejected even when a range applies', async () => {
    resolveTenantVmidRangeMock.mockResolvedValue(range)
    getUsedVmidsForTenantMock.mockResolvedValue({ used: new Set<number>(), unreachable: [] })
    const GET = await loadGet()
    const res = await callRoute(GET, { params: { id: 'conn-1' }, searchParams: { vmid: 'abc' } })
    expect(res.status).toBe(200)
    const json = await readJson<{ available: boolean; error: string }>(res)
    expect(json?.available).toBe(false)
    expect(json?.error).toContain('integer between 100 and 999999999')
  })

  it('?vmid= free is available, ?vmid= used is not', async () => {
    resolveTenantVmidRangeMock.mockResolvedValue(range)
    getUsedVmidsForTenantMock.mockResolvedValue({ used: new Set([201]), unreachable: [] })
    const GET = await loadGet()

    const resFree = await callRoute(GET, { params: { id: 'conn-1' }, searchParams: { vmid: '202' } })
    expect(await readJson<{ available: boolean }>(resFree)).toMatchObject({ available: true })

    const resUsed = await callRoute(GET, { params: { id: 'conn-1' }, searchParams: { vmid: '201' } })
    expect(await readJson<{ available: boolean }>(resUsed)).toMatchObject({ available: false })
  })
})
