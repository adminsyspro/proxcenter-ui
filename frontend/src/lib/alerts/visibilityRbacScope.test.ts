/**
 * RBAC infra-scope gate on orchestrator alerts (issue #525): the caller's
 * connection / node grants, ANDed with the tenant gates of
 * isAlertVisibleToTenant. The orchestrator alert payload carries no `node`
 * field, so node attribution goes through the UPID (event alerts), the
 * `resource` of a node alert, or the warm inventory index (VM alerts).
 * No database: rule ownership and the inventory index are mocked.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findVmMetaByVmidMock, ruleVisibleMock } = vi.hoisted(() => ({
  findVmMetaByVmidMock: vi.fn(),
  ruleVisibleMock: vi.fn(),
}))

vi.mock('@/lib/cache/vmMetaCache', () => ({
  resolveVmMeta: vi.fn().mockReturnValue(null),
  findVmMetaByVmid: (...a: unknown[]) => findVmMetaByVmidMock(...a),
}))
vi.mock('@/lib/alerts/ruleOwners', () => ({
  ruleVisibleToTenant: (...a: unknown[]) => ruleVisibleMock(...a),
}))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))

import { isAlertInRbacScope, isAlertVisibleToTenant, type AlertVisibilityCtx } from './visibility'
import type { RbacInfraScope } from '@/lib/rbac/infraScope'

const CONN = 'conn-1'
const OTHER = 'conn-2'

const scope = (over: Partial<RbacInfraScope> = {}): RbacInfraScope => ({
  fullConnections: new Set<string>(),
  nodesByConnection: new Map<string, Set<string>>(),
  guestDerived: false,
  ...over,
})
const nodeScope = () => scope({ nodesByConnection: new Map([[CONN, new Set(['pve1'])]]) })
const connScope = () => scope({ fullConnections: new Set([CONN]) })
const upid = (node: string) => `UPID:${node}:0000A1B2:00C3D4E5:6789ABCD:qmstart:100:root@pam:`

beforeEach(() => {
  findVmMetaByVmidMock.mockReset().mockReturnValue(null)
  ruleVisibleMock.mockReset().mockResolvedValue(true)
})

describe('isAlertInRbacScope', () => {
  it('null scope (admin / global grant) keeps everything, connection-less alerts included', () => {
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'vm', resource_id: 100 }, null, 'default')).toBe(true)
    expect(isAlertInRbacScope({ resource_type: 'license' }, null, 'default')).toBe(true)
  })

  it('a connection-less (cluster-wide) alert never reaches a scoped user', () => {
    expect(isAlertInRbacScope({ resource_type: 'license' }, connScope(), 'default')).toBe(false)
    expect(isAlertInRbacScope({ resource_type: 'license' }, nodeScope(), 'default')).toBe(false)
    expect(isAlertInRbacScope({ resource_type: 'license' }, scope({ guestDerived: true }), 'default')).toBe(false)
  })

  it('connection grant keeps every alert of that connection and drops the others, without touching the index', () => {
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'vm', resource_id: 100 }, connScope(), 'default')).toBe(true)
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'node', resource: 'pve9' }, connScope(), 'default')).toBe(true)
    expect(isAlertInRbacScope({ connection_id: OTHER, resource_type: 'vm', resource_id: 100 }, connScope(), 'default')).toBe(false)
    expect(findVmMetaByVmidMock).not.toHaveBeenCalled()
  })

  it('guest-derived (tag / pool) scope keeps every connection-bound alert without touching the index', () => {
    const s = scope({ guestDerived: true })
    expect(isAlertInRbacScope({ connection_id: OTHER, resource_type: 'vm', resource_id: 100 }, s, 'default')).toBe(true)
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'node', resource: 'pve2' }, s, 'default')).toBe(true)
    expect(findVmMetaByVmidMock).not.toHaveBeenCalled()
  })

  it('node scope: a node alert is attributed through `resource`', () => {
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'node', resource: 'pve1' }, nodeScope(), 'default')).toBe(true)
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'node', resource: 'pve2' }, nodeScope(), 'default')).toBe(false)
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'node' }, nodeScope(), 'default')).toBe(false)
    expect(findVmMetaByVmidMock).not.toHaveBeenCalled()
  })

  it('node scope: an explicit node field wins over any other attribution', () => {
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'vm', resource_id: 100, node: 'pve1' }, nodeScope(), 'default')).toBe(true)
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'vm', resource_id: 100, node: 'pve2' }, nodeScope(), 'default')).toBe(false)
    expect(findVmMetaByVmidMock).not.toHaveBeenCalled()
  })

  it('node scope: an event alert is attributed through its UPID', () => {
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'event', resource_id: 0, event_id: upid('pve1') }, nodeScope(), 'default')).toBe(true)
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'event', resource_id: 0, event_id: upid('pve2') }, nodeScope(), 'default')).toBe(false)
    expect(findVmMetaByVmidMock).not.toHaveBeenCalled()
  })

  it('node scope: a VM threshold alert is attributed through the inventory index', () => {
    findVmMetaByVmidMock.mockReturnValue({ tags: [], node: 'pve1' })
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'vm', resource_id: 100 }, nodeScope(), 'tenant-x')).toBe(true)
    expect(findVmMetaByVmidMock).toHaveBeenCalledWith(CONN, '100', 'default')

    findVmMetaByVmidMock.mockReturnValue({ tags: [], node: 'pve2' })
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'vm', resource_id: 100 }, nodeScope(), 'tenant-x')).toBe(false)
  })

  it('node scope: falls back to the tenant index when the provider index has no entry', () => {
    findVmMetaByVmidMock.mockImplementation((_c: string, _v: string, tenantId: string) =>
      tenantId === 'tenant-x' ? { tags: [], node: 'pve1' } : null,
    )
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'vm', resource_id: 100 }, nodeScope(), 'tenant-x')).toBe(true)
    expect(findVmMetaByVmidMock).toHaveBeenCalledWith(CONN, '100', 'tenant-x')
  })

  it('node scope: a VM alert whose node cannot be attributed (cold index) is denied', () => {
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'vm', resource_id: 100 }, nodeScope(), 'default')).toBe(false)
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'vm', resource_id: 0 }, nodeScope(), 'default')).toBe(false)
  })

  it('node scope: cluster-wide alerts of the granted connection are kept', () => {
    for (const rt of ['storage', 'license', 'cluster', 'system', 'osd', 'replication']) {
      expect(isAlertInRbacScope({ connection_id: CONN, resource_type: rt }, nodeScope(), 'default')).toBe(true)
    }
  })

  it('node scope: any alert of a connection without a grant is denied, cluster-wide ones included', () => {
    expect(isAlertInRbacScope({ connection_id: OTHER, resource_type: 'storage' }, nodeScope(), 'default')).toBe(false)
    expect(isAlertInRbacScope({ connection_id: OTHER, resource_type: 'node', resource: 'pve1' }, nodeScope(), 'default')).toBe(false)
  })
})

describe('isAlertInRbacScope under a vm grant (conn-1:pve1:qemu:100)', () => {
  const vmGrant = () => scope({
    nodesByConnection: new Map([[CONN, new Set(['pve1'])]]),
    nodeGrantsByConnection: new Map(),
    guestGrantsByConnection: new Map([[CONN, new Set(['100'])]]),
  })

  it('a threshold or event alert on the granted VMID passes, wherever the guest runs', () => {
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'vm', resource_id: 100 }, vmGrant(), 'default')).toBe(true)
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'event', resource_id: 0, event_id: upid('pve2') }, vmGrant(), 'default')).toBe(true)
  })

  it('another guest of the same host, the host itself and cluster-wide alerts are denied', () => {
    findVmMetaByVmidMock.mockReturnValue({ tags: [], node: 'pve1' })
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'vm', resource_id: 101 }, vmGrant(), 'default')).toBe(false)
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'node', resource: 'pve1' }, vmGrant(), 'default')).toBe(false)
    expect(isAlertInRbacScope({ connection_id: CONN, resource_type: 'storage' }, vmGrant(), 'default')).toBe(false)
    expect(isAlertInRbacScope({ connection_id: OTHER, resource_type: 'vm', resource_id: 100 }, vmGrant(), 'default')).toBe(false)
  })
})

describe('isAlertVisibleToTenant with ctx.rbacScope (gate 0)', () => {
  const providerCtx = (rbacScope: RbacInfraScope | null | undefined): AlertVisibilityCtx => ({
    tenantId: 'default',
    tenantConnectionIds: new Set([CONN, OTHER]),
    vdcScope: null,
    infraKind: 'provider',
    rbacScope,
  })
  const ruleAlert = { rule_id: 'rule-a', connection_id: OTHER, resource_type: 'vm', resource_id: 100 }

  it('absent or null rbacScope leaves the tenant verdict untouched', async () => {
    expect(await isAlertVisibleToTenant(ruleAlert, providerCtx(undefined))).toBe(true)
    expect(await isAlertVisibleToTenant(ruleAlert, providerCtx(null))).toBe(true)
  })

  it('an out-of-scope alert is denied before the rule-ownership lookup runs', async () => {
    expect(await isAlertVisibleToTenant(ruleAlert, providerCtx(connScope()))).toBe(false)
    expect(ruleVisibleMock).not.toHaveBeenCalled()
  })

  it('an in-scope alert goes on to the tenant gates', async () => {
    expect(await isAlertVisibleToTenant({ ...ruleAlert, connection_id: CONN }, providerCtx(connScope()))).toBe(true)
    expect(ruleVisibleMock).toHaveBeenCalledWith('rule-a', 'default')
  })

  it('a scoped provider user no longer sees connection-less built-in alerts', async () => {
    expect(await isAlertVisibleToTenant({ resource_type: 'license' }, providerCtx(null))).toBe(true)
    expect(await isAlertVisibleToTenant({ resource_type: 'license' }, providerCtx(connScope()))).toBe(false)
  })

  it('a tenant-denied alert stays denied even when the RBAC scope allows it', async () => {
    ruleVisibleMock.mockResolvedValue(false)
    expect(await isAlertVisibleToTenant({ ...ruleAlert, connection_id: CONN }, providerCtx(connScope()))).toBe(false)
  })
})
