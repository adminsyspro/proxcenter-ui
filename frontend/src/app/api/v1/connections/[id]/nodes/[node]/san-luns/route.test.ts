import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute, deniedPermissionResponse, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(), PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage' } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: vi.fn() }))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: vi.fn(), maskingScope: vi.fn() }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/storage/clusterStorage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage/clusterStorage')>('@/lib/storage/clusterStorage')
  return { ...actual, sanLunsOfTarget: vi.fn() }
})

import { getConnectionById } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { checkPermission } from '@/lib/rbac'
import { sanLunsOfTarget } from '@/lib/storage/clusterStorage'
import { getCurrentTenantId } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'

import { GET } from './route'

const params = { id: 'c1', node: 'pve1' }
const lun = { wwid: 'w1', state: 'optimal', pathsActive: 2, pathsTotal: 2, usage: 'unused' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(checkPermission).mockResolvedValue(null)
  vi.mocked(getCurrentTenantId).mockResolvedValue('default')
  vi.mocked(getTenantInfrastructureScope).mockResolvedValue({ kind: 'provider' } as any)
  vi.mocked(maskingScope).mockReturnValue(null)
  vi.mocked(getConnectionById).mockResolvedValue({ id: 'c1' } as any)
  vi.mocked(pveFetch).mockResolvedValue({ storage: 'san', type: 'iscsi', target: 'iqn.a' })
})

describe('GET /nodes/[node]/san-luns', () => {
  it('returns the LUNs of the target of an iSCSI storage', async () => {
    vi.mocked(sanLunsOfTarget).mockResolvedValue([lun])

    const res = await callRoute(GET, { params, searchParams: { storage: 'san' } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: [lun] })
    expect(pveFetch).toHaveBeenCalledWith({ id: 'c1' }, '/storage/san')
    expect(sanLunsOfTarget).toHaveBeenCalledWith({ id: 'c1' }, 'pve1', 'iqn.a')
  })

  it('answers null data before Proxmox VE 9.3', async () => {
    vi.mocked(sanLunsOfTarget).mockResolvedValue(null)

    expect(await readJson(await callRoute(GET, { params, searchParams: { storage: 'san' } }))).toEqual({ data: null })
  })

  it('refuses a storage that is not iSCSI, and a bad storage id', async () => {
    vi.mocked(pveFetch).mockResolvedValue({ storage: 'nfs', type: 'nfs' })

    expect((await callRoute(GET, { params, searchParams: { storage: 'nfs' } })).status).toBe(400)
    expect((await callRoute(GET, { params, searchParams: { storage: '../x' } })).status).toBe(400)
    expect((await callRoute(GET, { params })).status).toBe(400)
    expect(sanLunsOfTarget).not.toHaveBeenCalled()
  })

  it('hides an unexpected error', async () => {
    vi.mocked(pveFetch).mockRejectedValue(new Error('internal detail'))

    const res = await callRoute(GET, { params, searchParams: { storage: 'san' } })

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'Could not read the LUNs' })
  })

  it.each([
    ['without connection.manage', () => vi.mocked(checkPermission).mockResolvedValue(deniedPermissionResponse() as any)],
    ['for a vDC tenant', () => vi.mocked(maskingScope).mockReturnValue({} as any)],
  ])('refuses %s', async (_l, arrange) => {
    arrange()

    const res = await callRoute(GET, { params, searchParams: { storage: 'san' } })

    expect(res.status).toBe(403)
    expect(pveFetch).not.toHaveBeenCalled()
  })

  it('refuses missing params', async () => {
    expect((await callRoute(GET, { params: { id: 'c1' }, searchParams: { storage: 'san' } })).status).toBe(400)
  })
})
