/**
 * Cluster, node, group, IP set and alias firewall objects are cluster-level:
 * a vDC tenant (iaas) token is refused before the handler. A guest firewall
 * route confines that token to the guests of its own vDC pools; its own guest
 * passes the guard and the handler's own node.manage check judges it. Real
 * routes, real guard; the principal, tenant, RBAC, orchestrator and Proxmox
 * are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  headers: vi.fn<() => Promise<Headers>>(),
  getPrincipal: vi.fn<(...a: any[]) => Promise<any>>(),
  infra: vi.fn<(...a: any[]) => Promise<any>>(),
  checkPermission: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  creator: vi.fn<(...a: any[]) => Promise<boolean>>(),
  audit: vi.fn<(...a: any[]) => Promise<string>>(),
  pveFetch: vi.fn<(...a: any[]) => Promise<any>>(),
  orchPost: vi.fn<(...a: any[]) => Promise<any>>(),
  orchDelete: vi.fn<(...a: any[]) => Promise<any>>(),
}))

vi.mock('next/headers', () => ({ headers: h.headers }))
vi.mock('@/lib/auth/principal', async io => ({
  ...await io<typeof import('@/lib/auth/principal')>(),
  getPrincipal: (...a: any[]) => h.getPrincipal(...a),
}))
vi.mock('@/lib/api-tokens/creatorCheck', () => ({ creatorStillHolds: (...a: any[]) => h.creator(...a) }))
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
  getTenantInfrastructureScope: (...a: any[]) => h.infra(...a),
}))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: async () => 'default',
  getTenantConnectionIds: async () => new Set(['c1', 'c2']),
  verifyConnectionOwnership: async () => null,
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id, baseUrl: 'https://pve', apiToken: 't' }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => h.pveFetch(...a) }))
vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({ post: h.orchPost, delete: h.orchDelete }),
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => h.checkPermission(...a),
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_MANAGE: 'node.manage' },
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => h.audit(...a) }))

import { POST as CLUSTER_RULE_ADD } from './cluster/[connectionId]/route'
import { DELETE as IPSET_ENTRY_DELETE } from './ipsets/[connectionId]/[ipsetName]/entries/[cidr]/route'
import { POST as VM_RULE_CREATE } from './vms/[connectionId]/[node]/[vmType]/[vmid]/route'

const TOKEN = {
  kind: 'token', tokenId: 'tok-a', tenantId: 'default', creatorUserId: 'u-a', connectionIds: ['c1'],
  scopes: ['firewall:write'], permissions: new Set(['node.view', 'connection.view', 'node.manage']),
}
const IAAS_TOKEN = { ...TOKEN, tenantId: 'tenant-a' }

/** Tenant A's vDC on the provider connection c1: node pve1, pool pool-a. */
const VDC_SCOPE = {
  connectionIds: new Set(['c1']),
  nodesByConnection: new Map([['c1', new Set(['pve1'])]]),
  poolsByConnection: new Map([['c1', new Set(['pool-a'])]]),
  storagesByConnection: new Map(),
  writableStoragesByConnection: new Map(),
  isoLibrariesByConnection: new Map(),
}
/** Guest 100 is tenant A's; guest 200 sits on the same node in tenant B's pool. */
const GUESTS = [
  { vmid: 100, type: 'qemu', node: 'pve1', pool: 'pool-a' },
  { vmid: 200, type: 'qemu', node: 'pve1', pool: 'pool-b' },
]
const RULE = { type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '22' }

function tokenRequest(method: string, path: string, entry: string, body?: unknown) {
  h.headers.mockResolvedValue(new Headers({
    authorization: 'Bearer pxc_abcdefgh_secret', 'x-pxc-method': method, 'x-pxc-path': path, 'x-pxc-entry': entry,
  }))
  return new Request(`http://test.local${path}`, {
    method,
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

const addClusterRule = (conn: string) => CLUSTER_RULE_ADD(
  tokenRequest('POST', `/api/v1/firewall/cluster/${conn}`, 'fw-cluster-rule-add', RULE) as any,
  { params: Promise.resolve({ connectionId: conn }) },
)
const addVmRule = (vmid: string) => VM_RULE_CREATE(
  tokenRequest('POST', `/api/v1/firewall/vms/c1/pve1/qemu/${vmid}`, 'fw-vm-rule-create', RULE) as any,
  { params: Promise.resolve({ connectionId: 'c1', node: 'pve1', vmType: 'qemu', vmid }) },
)

beforeEach(() => {
  vi.clearAllMocks()
  h.getPrincipal.mockResolvedValue({ ok: true, principal: TOKEN })
  h.infra.mockResolvedValue({ kind: 'provider' })
  h.creator.mockResolvedValue(true)
  h.checkPermission.mockResolvedValue(null)
  h.audit.mockResolvedValue('audit-1')
  h.pveFetch.mockImplementation(async (_conn, path: string) => (path === '/cluster/resources?type=vm' ? GUESTS : null))
  h.orchPost.mockResolvedValue({ data: { status: 'created' } })
  h.orchDelete.mockResolvedValue({ data: { status: 'deleted' } })
})

describe('firewall routes with an API token', () => {
  it('a cluster rule from a vDC tenant token: 403 cluster object, nothing reached', async () => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: IAAS_TOKEN })
    h.infra.mockResolvedValue({ kind: 'iaas', vdcScope: VDC_SCOPE })

    const res = await addClusterRule('c1')

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Cluster-level object not available to a vDC tenant token' })
    expect(h.checkPermission).not.toHaveBeenCalled()
    expect(h.orchPost).not.toHaveBeenCalled()
  })

  it('a cluster rule from a provider token inside its perimeter reaches the orchestrator', async () => {
    const res = await addClusterRule('c1')

    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ status: 'created' })
    expect(h.checkPermission).toHaveBeenCalledWith('node.manage', 'connection', 'c1')
    expect(h.orchPost).toHaveBeenCalledWith('/firewall/cluster/c1/rules', RULE)
  })

  it('a cluster rule on a connection outside the token perimeter: 403', async () => {
    const res = await addClusterRule('c2')

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Connection not in token scope', connection: 'c2' })
    expect(h.orchPost).not.toHaveBeenCalled()
  })

  it('a rule on its own guest from a vDC tenant token passes the guard and is judged by the handler', async () => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: IAAS_TOKEN })
    h.infra.mockResolvedValue({ kind: 'iaas', vdcScope: VDC_SCOPE })

    const res = await addVmRule('100')

    expect(res.status).toBe(201)
    expect(h.checkPermission).toHaveBeenCalledWith('node.manage', 'connection', 'c1')
    expect(h.orchPost).toHaveBeenCalledWith('/firewall/vms/c1/pve1/qemu/100/rules', RULE)
  })

  it('a rule on another tenant guest from a vDC tenant token: 403, nothing reached', async () => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: IAAS_TOKEN })
    h.infra.mockResolvedValue({ kind: 'iaas', vdcScope: VDC_SCOPE })

    const res = await addVmRule('200')

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Guest outside your vDC scope' })
    expect(h.checkPermission).not.toHaveBeenCalled()
    expect(h.orchPost).not.toHaveBeenCalled()
  })

  it('an IP set entry CIDR travels encoded in its one segment and reaches the orchestrator re-encoded once', async () => {
    const path = '/api/v1/firewall/ipsets/c1/blocklist/entries/10.0.0.0%2F24'
    // Next hands the handler its params already decoded.
    const res = await IPSET_ENTRY_DELETE(
      tokenRequest('DELETE', path, 'fw-ipset-entry-delete') as any,
      { params: Promise.resolve({ connectionId: 'c1', ipsetName: 'blocklist', cidr: '10.0.0.0/24' }) },
    )

    expect(res.status).toBe(200)
    expect(h.orchDelete).toHaveBeenCalledWith('/firewall/ipsets/c1/blocklist/entries/10.0.0.0%2F24')
  })
})
