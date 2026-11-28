import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

/*
   ui#1450: pveceph install, which has no API. Detached over SSH (apt takes
   minutes), then polled from the account's log.
*/

vi.mock('@/lib/ceph/tenantGuard', () => ({ denyIaasTenantCeph: vi.fn(async () => null) }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn(async () => ({ id: 'c1' })), isConnectionNotFoundError: () => false }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn<(...args: any[]) => Promise<any>>() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { STORAGE_ADMIN: 'storage.admin' } }))
vi.mock('@/lib/ssh/node-endpoint', () => ({ resolveNodeSshEndpoint: vi.fn(async (_c: unknown, n: string) => `ip-${n}`) }))
vi.mock('@/lib/ssh/verify-node-target', () => ({ verifyNodeTarget: vi.fn(async () => ({ ok: true })), sshTargetError: (_n: string, _t: unknown, f?: string) => f ?? 'unreachable' }))
vi.mock('@/lib/ceph/detachedPveceph', async (orig) => ({
  ...(await orig<typeof import('@/lib/ceph/detachedPveceph')>()),
  sudoAllows: vi.fn(async () => 'ok'),
  runDetached: vi.fn(async () => ({ started: true, logPath: 'x' })),
  readDetachedLog: vi.fn(),
}))

import { GET, POST } from './route'
import { readDetachedLog, runDetached, sudoAllows } from '@/lib/ceph/detachedPveceph'
import { pveFetch } from '@/lib/proxmox/client'

const params = { id: 'c1', node: 'pve1' }

beforeEach(() => {
  vi.clearAllMocks()
  ;(pveFetch as any).mockImplementation(async (_c: any, path: string) => (path === '/nodes' ? [{ node: 'pve1' }] : null))
})

describe('POST /api/v1/connections/[id]/nodes/[node]/ceph/install', () => {
  it('starts pveceph install detached', async () => {
    const res = await callRoute(POST, { params, method: 'POST', body: { version: 'tentacle', repository: 'no-subscription' } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { started: true, node: 'pve1' } })
    expect((runDetached as any).mock.calls[0]).toEqual(['c1', 'ip-pve1', ['/usr/bin/pveceph', 'install', '--version', 'tentacle', '--repository', 'no-subscription'], 'ceph-install', { answerYes: true }])
  })

  it('refuses the test repository and runs nothing without the sudo rule', async () => {
    let res = await callRoute(POST, { params, method: 'POST', body: { version: 'tentacle', repository: 'test' } })
    expect(res.status).toBe(400)
    ;(sudoAllows as any).mockResolvedValueOnce('missing-rule')
    res = await callRoute(POST, { params, method: 'POST', body: { version: 'tentacle', repository: 'no-subscription' } })
    expect(res.status).toBe(412)
    expect(runDetached).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/connections/[id]/nodes/[node]/ceph/install', () => {
  it('reads the status and the last lines of the log', async () => {
    ;(readDetachedLog as any).mockResolvedValue('E: 401 Unauthorized\nPXC_EXIT:100\n')
    const res = await callRoute(GET, { params })
    expect(await readJson(res)).toEqual({ data: { status: 'FAILED', logs: 'E: 401 Unauthorized' } })
    ;(readDetachedLog as any).mockResolvedValue(null)
    expect(await readJson(await callRoute(GET, { params }))).toEqual({ data: { status: 'UNKNOWN', logs: '' } })
  })

  it('reads nothing on a node of another cluster', async () => {
    const res = await callRoute(GET, { params: { id: 'c1', node: 'pve9' } })
    expect(res.status).toBe(404)
    expect(readDetachedLog).not.toHaveBeenCalled()
  })
})
