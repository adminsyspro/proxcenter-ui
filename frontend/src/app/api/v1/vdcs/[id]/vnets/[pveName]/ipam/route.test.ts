import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const h = vi.hoisted(() => ({
  checkVnetReadForCaller: vi.fn(),
  resolveVnetTenant: vi.fn(),
  vnetFindFirst: vi.fn(),
}))

// API token guard: pass-through (token paths: vnetTokenScope.test.ts).
vi.mock('@/lib/api-tokens/routeGuard', () => ({ withPublicApiGuard: (_entryId: string, handler: any) => handler }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { SDN_VNET_VIEW: 'sdn.vnet.view' } }))
vi.mock('@/lib/vdc/vnetPermission', () => ({
  checkVnetReadForCaller: (...a: unknown[]) => h.checkVnetReadForCaller(...a),
  resolveVnetTenant: (...a: unknown[]) => h.resolveVnetTenant(...a),
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { vdcVnet: { findFirst: (...a: unknown[]) => h.vnetFindFirst(...a) } } }))
vi.mock('@/lib/vdc/ipam', () => ({ listAllocationsForSubnet: vi.fn(async () => []) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))

async function get() {
  const GET = (await import('./route')).GET as Parameters<typeof callRoute>[0]
  return callRoute(GET, { params: { id: 'vdc-t', pveName: 'web' } })
}

beforeEach(() => {
  vi.clearAllMocks()
  h.checkVnetReadForCaller.mockResolvedValue(null)
  h.resolveVnetTenant.mockResolvedValue('tenant-caller')
  h.vnetFindFirst.mockResolvedValue(null)
})

describe('GET vnets/[pveName]/ipam: tenant of the lookup', () => {
  it('looks the VNet up in the caller tenant', async () => {
    const res = await get()

    expect(res.status).toBe(404)
    expect(h.vnetFindFirst.mock.calls[0]?.[0].where).toEqual({ vdcId: 'vdc-t', displayName: 'web', vdc: { tenantId: 'tenant-caller' } })
  })

  it('looks the VNet up in the tenant that owns the vDC for a provider caller (#1404)', async () => {
    h.resolveVnetTenant.mockResolvedValue('tenant-owner')

    await get()

    expect(h.resolveVnetTenant).toHaveBeenCalledWith('vdc-t')
    expect(h.vnetFindFirst.mock.calls[0]?.[0].where).toEqual({ vdcId: 'vdc-t', displayName: 'web', vdc: { tenantId: 'tenant-owner' } })
  })

  it('answers the refusal of the permission check before any lookup', async () => {
    h.checkVnetReadForCaller.mockResolvedValue(Response.json({ error: 'vDC not found' }, { status: 404 }))

    expect((await get()).status).toBe(404)
    expect(h.vnetFindFirst).not.toHaveBeenCalled()
  })
})
