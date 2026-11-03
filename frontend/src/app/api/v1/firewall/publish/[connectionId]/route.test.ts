/**
 * POST /api/v1/firewall/publish/[connectionId] (UA51): the Firewalling draft in one call. The guarantees tested: the
 * same rights as the sibling firewall writes (node.manage on the connection, no vDC tenant), a strict body, the
 * confirmation above 50 operations, operations applied one after the other with the stop at the first failure (409
 * on a digest conflict with the applied count), and one audit row per publish, success or failure.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const h = vi.hoisted(() => ({
  ownership: vi.fn<(id: string) => Promise<Response | null>>(),
  permission: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  infra: vi.fn<(...a: any[]) => Promise<any>>(),
  pveFetch: vi.fn<(...a: any[]) => Promise<any>>(),
  audit: vi.fn<(...a: any[]) => Promise<string>>(),
  forget: vi.fn(),
  nic: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  verifyConnectionOwnership: (id: string) => h.ownership(id),
  getCurrentTenantId: async () => 'default',
}))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: (...a: any[]) => h.infra(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => h.permission(...a),
  PERMISSIONS: { NODE_MANAGE: 'node.manage' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'conn-1', baseUrl: 'https://pve', apiToken: 't' }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => h.pveFetch(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => h.audit(...a) }))
// The route writes its own row; the wrapper (tested on its own) would skip it, it is left out here.
vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))
vi.mock('@/lib/firewall/guestCoverage', () => ({ forgetGuestCoverage: (...a: any[]) => h.forget(...a) }))
vi.mock('@/lib/inventory/guestDiskTotals', () => ({ noteGuestNicFirewall: (...a: any[]) => h.nic(...a) }))

import { POST } from './route'

const RULES = '/cluster/firewall/rules'
const cluster = { kind: 'cluster' }
const edit = (pos: number) => ({ kind: 'rule.edit', scope: cluster, pos, patch: { log: 'info' } })

/** A cluster rule list of `n` rules; every write moves the digest on. */
function onPve(n: number) {
  let version = 0
  const list = Array.from({ length: n }, (_, i) => ({ type: 'in', action: 'ACCEPT', comment: `r${i}` }))
  h.pveFetch.mockImplementation(async (_conn: unknown, path: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET'
    if (method === 'GET' && path === RULES) return list.map((r, pos) => ({ ...r, pos, digest: `d${version}` }))
    version++
    return null
  })
}

const post = (body: unknown) => callRoute(POST as any, { params: { connectionId: 'conn-1' }, body: body as any })

beforeEach(() => {
  vi.clearAllMocks()
  h.ownership.mockResolvedValue(null)
  h.permission.mockResolvedValue(null)
  h.infra.mockResolvedValue({ kind: 'provider' })
  h.audit.mockResolvedValue('row')
})

describe('POST /api/v1/firewall/publish/[connectionId]', () => {
  it('asks node.manage on the connection, like the sibling firewall writes', async () => {
    h.permission.mockResolvedValue(new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'content-type': 'application/json' } }))
    const res = await post({ ops: [edit(0)], digests: {} })
    expect(res.status).toBe(403)
    expect(h.permission).toHaveBeenCalledWith('node.manage', 'connection', 'conn-1')
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('refuses a vDC tenant', async () => {
    h.infra.mockResolvedValue({ kind: 'iaas' })
    expect((await post({ ops: [edit(0)], digests: {} })).status).toBe(403)
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('refuses a body that is not a draft', async () => {
    const res = await post({ ops: [{ kind: 'rule.edit', scope: { kind: 'host', node: 'a/b' }, pos: 0, patch: { log: 'info' } }] })
    expect(res.status).toBe(400)
    expect(await readJson(res)).toMatchObject({ code: 'INVALID' })
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it('asks a confirmation above 50 operations, stating the count, then applies them once confirmed', async () => {
    onPve(60)
    const ops = Array.from({ length: 51 }, (_, i) => edit(i))
    const refused = await post({ ops, digests: { cluster: 'd0' } })
    expect(refused.status).toBe(400)
    expect(await readJson(refused)).toMatchObject({ code: 'CONFIRM_REQUIRED', count: 51 })
    expect(h.pveFetch).not.toHaveBeenCalled()

    const done = await post({ ops, digests: { cluster: 'd0' }, confirmed: true })
    expect(done.status).toBe(200)
    expect(await readJson(done)).toMatchObject({ applied: 51, total: 51 })
  })

  it('applies the operations one after the other and writes one audit row', async () => {
    onPve(3)
    const res = await post({ ops: [edit(0), edit(1), { kind: 'rule.delete', scope: cluster, pos: 2 }], digests: { cluster: 'd0' } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toMatchObject({ applied: 3, total: 3, scopes: { cluster: { digest: 'd3' } } })
    const writes = h.pveFetch.mock.calls.filter(([, , init]) => init?.method).map(([, path, init]) => `${init.method} ${path}`)
    expect(writes).toEqual([`PUT ${RULES}/0`, `PUT ${RULES}/1`, `DELETE ${RULES}/2?digest=d2`])
    expect(h.audit).toHaveBeenCalledTimes(1)
    expect(h.audit.mock.calls[0][0]).toMatchObject({
      action: 'firewall.publish', category: 'firewall', resourceType: 'connection', resourceId: 'conn-1', status: 'success',
      details: { kinds: { 'rule.edit': 2, 'rule.delete': 1 }, scopes: { cluster: 1 }, applied: 3, total: 3 },
    })
  })

  it('answers 409 with the applied count when the list changed since the draft, and audits the failure', async () => {
    onPve(2)
    const res = await post({ ops: [edit(0)], digests: { cluster: 'stale' } })
    expect(res.status).toBe(409)
    expect(await readJson(res)).toMatchObject({ applied: 0, total: 1, failed: { index: 0, code: 'DIGEST_CONFLICT', scope: 'cluster' } })
    expect(h.pveFetch.mock.calls.every(([, , init]) => !init?.method)).toBe(true)
    expect(h.audit.mock.calls[0][0]).toMatchObject({ action: 'firewall.publish', status: 'failure', details: { applied: 0, failed: { code: 'DIGEST_CONFLICT' } } })
  })

  it('stops at the first Proxmox failure: 502, the applied count and the message', async () => {
    onPve(3)
    const base = h.pveFetch.getMockImplementation()!
    let puts = 0
    h.pveFetch.mockImplementation(async (conn: unknown, path: string, init?: RequestInit) => {
      if (init?.method === 'PUT' && ++puts === 2) throw new Error('rule 1 does not exist')
      return base(conn, path, init)
    })
    const res = await post({ ops: [edit(0), edit(1), edit(2)], digests: {} })
    expect(res.status).toBe(502)
    expect(await readJson(res)).toMatchObject({ applied: 1, failed: { index: 1, message: 'rule 1 does not exist' } })
    expect(puts).toBe(2)
  })

  it('runs one publish per connection at a time: a second one meanwhile gets 409 PUBLISH_RUNNING', async () => {
    onPve(2)
    const base = h.pveFetch.getMockImplementation()!
    let release: () => void = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    h.pveFetch.mockImplementation(async (conn: unknown, path: string, init?: RequestInit) => {
      if (init?.method === 'PUT') await held
      return base(conn, path, init)
    })
    const first = post({ ops: [edit(0)], digests: {} })
    await vi.waitFor(() => expect(h.pveFetch.mock.calls.some(([, , init]) => init?.method === 'PUT')).toBe(true))
    const second = await post({ ops: [edit(1)], digests: {} })
    expect(second.status).toBe(409)
    expect(await readJson(second)).toMatchObject({ code: 'PUBLISH_RUNNING' })
    release()
    expect((await first).status).toBe(200)
    // The lock is released once the first ends.
    expect((await post({ ops: [edit(1)], digests: {} })).status).toBe(200)
  })

  it('writes the scope keys in the audit row', async () => {
    onPve(1)
    await post({ ops: [edit(0)], digests: {} })
    expect(h.audit.mock.calls[0][0].details).toMatchObject({ scopeKeys: ['cluster'], moreScopes: 0 })
  })

  it('forgets the coverage of a guest whose firewall it turned on', async () => {
    h.pveFetch.mockImplementation(async (_c: unknown, path: string, init?: RequestInit) => {
      if (init?.method) return null
      if (path.endsWith('/options')) return { enable: 0, digest: 'o1' }
      return { net0: 'virtio=AA,bridge=vmbr0', digest: 'c1' }
    })
    const res = await post({ ops: [{ kind: 'guest.enable', scope: { kind: 'guest', node: 'pve1', vmType: 'qemu', vmid: 101 } }], digests: {} })
    expect(res.status).toBe(200)
    expect(h.nic).toHaveBeenCalledWith('conn-1', 'qemu', 101, true)
    expect(h.forget).toHaveBeenCalledWith('conn-1', { type: 'qemu', vmid: 101 })
  })
})
