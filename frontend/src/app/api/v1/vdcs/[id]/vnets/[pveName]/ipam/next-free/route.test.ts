import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const { checkPermissionMock, getCurrentTenantIdMock, resolveScopeTenantMock, vdcVnetFindFirstMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  resolveScopeTenantMock: vi.fn(),
  vdcVnetFindFirstMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: (...a: any[]) => checkPermissionMock(...a) }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: (...a: any[]) => getCurrentTenantIdMock(...a) }))
vi.mock('@/lib/vdc/providerTarget', () => ({ resolveScopeTenant: (...a: any[]) => resolveScopeTenantMock(...a) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { vdcVnet: { findFirst: (...a: any[]) => vdcVnetFindFirstMock(...a) } } }))
vi.mock('@/lib/vdc/ipam', () => ({ listAllocationsForSubnet: vi.fn(async () => []) }))
vi.mock('@/lib/vdc/ipamScan', () => ({ scanUsedIpsForSubnet: vi.fn(), scannedToIntSet: vi.fn(() => new Set()) }))
vi.mock('@/lib/vdc/sdn', () => ({ generatePveMacAddress: () => 'BC:24:11:00:00:01' }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))

const PARAMS = { id: 'vdc-t', pveName: 'web' }
const target = (vdcId: string) => ({ vdcId, tenantId: 'tenant-acme', connectionId: 'conn-1' })

async function get(searchParams?: Record<string, string>) {
  const GET = (await import('./route')).GET as Parameters<typeof callRoute>[0]
  return callRoute(GET, { params: PARAMS, searchParams })
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getCurrentTenantIdMock.mockReset().mockResolvedValue('tenant-caller')
  vdcVnetFindFirstMock.mockReset().mockResolvedValue(null)
  resolveScopeTenantMock.mockReset().mockImplementation(async (_req: any, _id: any, current: () => Promise<string>) => ({ ok: true, tenantId: await current(), target: null }))
})

describe('GET vnets/[pveName]/ipam/next-free: provider target (roadmap#65)', () => {
  it('queries the vnet under the caller tenant without a target', async () => {
    const res = await get()
    expect(res.status).toBe(404)
    expect(resolveScopeTenantMock.mock.calls[0]?.[1]).toBeNull()
    expect(vdcVnetFindFirstMock.mock.calls[0]?.[0].where).toEqual({ vdcId: 'vdc-t', displayName: 'web', vdc: { tenantId: 'tenant-caller' } })
  })

  it('queries the vnet under the target tenant when the target is the path vDC', async () => {
    resolveScopeTenantMock.mockResolvedValue({ ok: true, tenantId: 'tenant-acme', target: target('vdc-t') })
    await get({ targetVdcId: 'vdc-t' })
    expect(vdcVnetFindFirstMock.mock.calls[0]?.[0].where).toEqual({ vdcId: 'vdc-t', displayName: 'web', vdc: { tenantId: 'tenant-acme' } })
  })

  it('404 when the target is not the vDC of the path, before any vnet lookup', async () => {
    resolveScopeTenantMock.mockResolvedValue({ ok: true, tenantId: 'tenant-acme', target: target('vdc-other') })
    const res = await get({ targetVdcId: 'vdc-other' })
    expect(res.status).toBe(404)
    expect(vdcVnetFindFirstMock).not.toHaveBeenCalled()
  })

  it('propagates the refusal of the guard', async () => {
    resolveScopeTenantMock.mockResolvedValue({ ok: false, response: Response.json({ error: 'nope' }, { status: 403 }) })
    const res = await get({ targetVdcId: 'vdc-t' })
    expect(res.status).toBe(403)
    expect(vdcVnetFindFirstMock).not.toHaveBeenCalled()
  })
})
