import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute, deniedPermissionResponse, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(), PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage' } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: vi.fn() }))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: vi.fn(), maskingScope: vi.fn() }))
vi.mock('@/lib/storage/clusterStorage', async () => {
  const actual = await vi.importActual<typeof import('@/lib/storage/clusterStorage')>('@/lib/storage/clusterStorage')
  return { ...actual, scanStorageTarget: vi.fn() }
})

import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission } from '@/lib/rbac'
import { ClusterStorageError, scanStorageTarget } from '@/lib/storage/clusterStorage'
import { getCurrentTenantId } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'

import { POST } from './route'

const params = { id: 'c1', node: 'pve1' }

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(checkPermission).mockResolvedValue(null)
  vi.mocked(getCurrentTenantId).mockResolvedValue('default')
  vi.mocked(getTenantInfrastructureScope).mockResolvedValue({ kind: 'provider' } as any)
  vi.mocked(maskingScope).mockReturnValue(null)
  vi.mocked(getConnectionById).mockResolvedValue({ id: 'c1' } as any)
})

describe('POST /nodes/[node]/storage-scan', () => {
  it('returns the entries of the scan', async () => {
    vi.mocked(scanStorageTarget).mockResolvedValue([{ value: '/srv', detail: null }])

    const res = await callRoute(POST, { method: 'POST', params, body: { type: 'nfs', server: 's' } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: [{ value: '/srv', detail: null }] })
    expect(scanStorageTarget).toHaveBeenCalledWith({ id: 'c1' }, 'c1', 'pve1', { type: 'nfs', server: 's' })
  })

  it('relays a scan refusal with its status and code', async () => {
    vi.mocked(scanStorageTarget).mockRejectedValue(new ClusterStorageError('busy', 409, 'SCAN_BUSY'))

    const res = await callRoute(POST, { method: 'POST', params, body: { type: 'lvm' } })

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'busy', code: 'SCAN_BUSY' })
  })

  it('hides an unexpected error', async () => {
    vi.mocked(scanStorageTarget).mockRejectedValue(new Error('internal detail'))

    const res = await callRoute(POST, { method: 'POST', params, body: { type: 'lvm' } })

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'Connection test failed' })
  })

  it.each([
    ['without connection.manage', () => vi.mocked(checkPermission).mockResolvedValue(deniedPermissionResponse() as any), 403],
    ['for a vDC tenant', () => vi.mocked(maskingScope).mockReturnValue({} as any), 403],
  ])('refuses %s', async (_l, arrange, status) => {
    arrange()

    const res = await callRoute(POST, { method: 'POST', params, body: { type: 'lvm' } })

    expect(res.status).toBe(status)
    expect(scanStorageTarget).not.toHaveBeenCalled()
  })

  it('refuses missing params and a body that is not JSON', async () => {
    expect((await callRoute(POST, { method: 'POST', params: { id: 'c1' }, body: {} })).status).toBe(400)
    expect((await callRoute(POST, { method: 'POST', params })).status).toBe(400)
  })
})
