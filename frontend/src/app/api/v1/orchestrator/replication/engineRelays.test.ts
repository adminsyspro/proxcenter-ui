import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  permission: vi.fn(), ssh: vi.fn(), preflight: vi.fn(), usage: vi.fn(), delete: vi.fn(), health: vi.fn(),
}))
vi.mock('@/lib/rbac', () => ({ checkPermission: mocks.permission, PERMISSIONS: { AUTOMATION_VIEW: 'automation.view', AUTOMATION_MANAGE: 'automation.manage' } }))
vi.mock('@/lib/tenant', () => ({ getTenantConnectionIds: async () => new Set(['src', 'dst']) }))
vi.mock('@/lib/orchestrator/client', () => ({ getOrchestratorClient: () => ({
  checkSSHConnectivity: mocks.ssh, preflightReplication: mocks.preflight, getSnapshotUsage: mocks.usage,
  deleteMirrorSnapshots: mocks.delete, getReplicationHealth: mocks.health,
}) }))

import { POST as ssh } from './check-ssh/route'
import { POST as preflight } from './preflight/route'
import { GET as usage } from './snapshots/usage/route'
import { POST as deleteSnapshots } from './snapshots/delete/route'
import { GET as status } from './status/route'

const check = { source_cluster: 'src', target_cluster: 'dst', storage_engine: 'zfs', target_node: 'dr1', vm_ids: [100, 101], tags: ['db'] }
const identity = { cluster_id: 'dst', storage_engine: 'zfs', node: 'dr1', pool: 'rpool/data', image: 'vm-9100-disk-0', snapshot: 'mirror-123' }
const post = (body: unknown) => new NextRequest('http://localhost', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.permission.mockResolvedValue(null)
})

describe.each([
  ['check-ssh', ssh, mocks.ssh], ['preflight', preflight, mocks.preflight],
] as const)('%s engine relay', (_name, route, upstream) => {
  it('forwards the complete engine and VM/tag context and response', async () => {
    const body = { ...check, target_pool: 'local-zfs', estimated_size_bytes: 4096 }
    const data = { connected: true, checks: [{ source_node: 'pve1', target_node: 'dr1', ok: true }] }
    upstream.mockResolvedValue({ data })
    expect(await (await route(post(body))).json()).toEqual(data)
    expect(upstream).toHaveBeenCalledWith(body)
  })

  it.each(['source_cluster', 'target_cluster'])('rejects a foreign %s', async field => {
    expect((await route(post({ ...check, [field]: 'foreign' }))).status).toBe(404)
    expect(upstream).not.toHaveBeenCalled()
  })

  it('enforces automation permission', async () => {
    mocks.permission.mockResolvedValue(new Response(null, { status: 403 }))
    expect((await route(post(check))).status).toBe(403)
    expect(upstream).not.toHaveBeenCalled()
  })
})

it('forwards all six snapshot identity fields to usage', async () => {
  mocks.usage.mockResolvedValue({ data: { used: 512 } })
  const query = new URLSearchParams({ cluster: 'dst', pool: identity.pool, image: identity.image, snap: identity.snapshot, storage_engine: 'zfs', node: 'dr1' })
  expect(await (await usage(new NextRequest(`http://localhost/?${query}`))).json()).toEqual({ used: 512 })
  expect(mocks.usage).toHaveBeenCalledWith('dst', 'rpool/data', 'vm-9100-disk-0', 'mirror-123', 'zfs', 'dr1')
})

it.each([
  ['cluster=dst&pool=p&image=i&snap=s&storage_engine=zfs', 400],
  ['cluster=dst&pool=p&image=i&snap=s&storage_engine=other', 400],
  ['cluster=foreign&pool=p&image=i&snap=s', 404],
  ['cluster=dst', 400],
])('rejects invalid snapshot identity: %s', async (query, code) => {
  expect((await usage(new NextRequest(`http://localhost/?${query}`))).status).toBe(code)
  expect(mocks.usage).not.toHaveBeenCalled()
})

it('retains legacy RBD usage defaults', async () => {
  mocks.usage.mockResolvedValue({ data: { used_size: 512 } })
  expect((await usage(new NextRequest('http://localhost/?cluster=dst&pool=p&image=i&snap=s'))).status).toBe(200)
  expect(mocks.usage).toHaveBeenCalledWith('dst', 'p', 'i', 's', 'rbd', '')
})

it('preserves complete deletion identities while removing foreign tenant items', async () => {
  const result = { deleted: [identity], failed: [] }
  mocks.delete.mockResolvedValue({ data: result })
  expect(await (await deleteSnapshots(post({ items: [identity, { ...identity, cluster_id: 'foreign' }] }))).json()).toEqual(result)
  expect(mocks.delete).toHaveBeenCalledWith([identity])
})

it('surfaces engines and filters status sites to the tenant', async () => {
  mocks.health.mockResolvedValue({ data: { engines: ['rbd', 'zfs'], sites: [{ cluster_id: 'src' }, { cluster_id: 'foreign' }] } })
  expect(await (await status()).json()).toEqual({ engines: ['rbd', 'zfs'], sites: [{ cluster_id: 'src' }] })
})

it('does not advertise a working service when status discovery fails', async () => {
  mocks.health.mockRejectedValue(new Error('offline'))
  expect((await status()).status).toBe(502)
})

it('rejects unauthorized status access', async () => {
  mocks.permission.mockResolvedValue(new Response(null, { status: 403 }))
  expect((await status()).status).toBe(403)
  expect(mocks.health).not.toHaveBeenCalled()
})
