/**
 * Tenant infra validation contract for PVE backup jobs.
 *
 * Locks the post-v1.4.0 behaviour of validateTenantJobInfra after the
 * external audit caught the route accepting body.storage / body.node /
 * body.fleecingStorage / body.namespace without checking them against
 * the tenant's vDC scope. The pool-only contract of
 * validateTenantJobBody had paper over the issue: a tenant could pin a
 * job to one of their pools and then have PVE write the resulting
 * backups onto a foreign provider storage or PBS namespace.
 *
 * The helper is pure (no DB), so we exercise its branches directly.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// getAllowedJobPools resolves the caller's infrastructure scope, which hits
// prisma for non-default tenants. Stub only that resolver; keep maskingScope
// (and the rest of the module) real so the provider/msp -> null mapping is
// exercised end to end.
const { getTenantInfrastructureScopeMock } = vi.hoisted(() => ({
  getTenantInfrastructureScopeMock: vi.fn(),
}))
vi.mock('@/lib/tenant/infraScope', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tenant/infraScope')>()),
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))

import { getAllowedJobPools, isJobOwnedByTenantPools, validateTenantJobBody, validateTenantJobInfra } from './backupJobs'
import type { VdcScope } from './scope'

const CONN = 'conn-pve-1'

function makeScope(over: Partial<{
  nodes: string[]
  storages: string[]
  pools: string[]
  pbs: Array<{ datastore: string; namespace: string }>
}> = {}): VdcScope {
  // The backup-jobs route hands validateTenantJobInfra a PVE connection
  // id; the PBS-keyed map (pbsNamespacesByConnection) is irrelevant
  // here. The mock therefore mirrors what scope.ts builds: namespaces
  // are also indexed under the PVE connection so the PVE-side caller
  // can answer "is this namespace bound to any vDC on this cluster?".
  const pbsRows = over.pbs ?? [{ datastore: 'main', namespace: 'tenant-acme/vdc-prod' }]
  return {
    connectionIds: new Set([CONN]),
    pbsConnectionIds: new Set(),
    nodesByConnection: new Map([[CONN, new Set(over.nodes ?? ['pve1', 'pve2'])]]),
    storagesByConnection: new Map([[CONN, new Set(over.storages ?? ['vdc-acme-pbs', 'vdc-acme-rbd'])]]),
    poolsByConnection: new Map([[CONN, new Set(over.pools ?? ['pool-acme'])]]),
    vnetsByConnection: new Map(),
    sharedBridgesByConnection: new Map(),
    pbsNamespacesByConnection: new Map(),
    pbsNamespacesByPveConnection: new Map([[CONN, new Set(pbsRows.map(p => p.namespace))]]),
  }
}

describe('validateTenantJobBody (pool-only contract)', () => {
  const allowed = new Set(['pool-acme'])

  it('rejects a non-pool selection mode', () => {
    expect(validateTenantJobBody({ selectionMode: 'all' }, allowed)).toMatch(/selectionMode="pool"/)
    expect(validateTenantJobBody({ selectionMode: 'include' }, allowed)).toMatch(/selectionMode="pool"/)
  })

  it('rejects a missing pool', () => {
    expect(validateTenantJobBody({ selectionMode: 'pool' }, allowed)).toMatch(/require a pool/)
  })

  it('rejects an unauthorised pool', () => {
    expect(validateTenantJobBody({ selectionMode: 'pool', pool: 'pool-foreign' }, allowed)).toMatch(/not authorised/)
  })

  it('accepts an authorised pool', () => {
    expect(validateTenantJobBody({ selectionMode: 'pool', pool: 'pool-acme' }, allowed)).toBeNull()
  })
})

describe('validateTenantJobInfra (storage / node / fleecing / namespace)', () => {
  it('accepts a body whose fields all live in the vDC', () => {
    const scope = makeScope()
    const err = validateTenantJobInfra(
      { storage: 'vdc-acme-pbs', node: 'pve1', namespace: 'tenant-acme/vdc-prod' },
      scope,
      CONN,
    )
    expect(err).toBeNull()
  })

  it('rejects a foreign storage', () => {
    const scope = makeScope()
    const err = validateTenantJobInfra({ storage: 'provider-only', node: 'pve1' }, scope, CONN)
    expect(err).toMatch(/Storage "provider-only" is not authorised/)
  })

  it('rejects a foreign node', () => {
    const scope = makeScope()
    const err = validateTenantJobInfra({ storage: 'vdc-acme-pbs', node: 'pve9' }, scope, CONN)
    expect(err).toMatch(/Node "pve9" is not authorised/)
  })

  it('rejects an empty node when the body explicitly sets it (PUT delete-pin attempt)', () => {
    const scope = makeScope()
    expect(validateTenantJobInfra({ node: '' }, scope, CONN)).toMatch(/pinned to a vDC node/)
    expect(validateTenantJobInfra({ node: null }, scope, CONN)).toMatch(/pinned to a vDC node/)
  })

  it('rejects fleecing onto a foreign storage when fleecing is enabled', () => {
    const scope = makeScope()
    const err = validateTenantJobInfra(
      { storage: 'vdc-acme-pbs', fleecing: true, fleecingStorage: 'provider-fleece' },
      scope,
      CONN,
    )
    expect(err).toMatch(/Fleecing storage "provider-fleece" is not authorised/)
  })

  it('ignores fleecingStorage when fleecing is disabled', () => {
    const scope = makeScope()
    const err = validateTenantJobInfra(
      { storage: 'vdc-acme-pbs', fleecing: false, fleecingStorage: 'provider-fleece' },
      scope,
      CONN,
    )
    expect(err).toBeNull()
  })

  it('rejects a PBS namespace outside the vDC bindings', () => {
    const scope = makeScope()
    const err = validateTenantJobInfra(
      { storage: 'vdc-acme-pbs', namespace: 'tenant-foreign/vdc-prod' },
      scope,
      CONN,
    )
    expect(err).toMatch(/PBS namespace "tenant-foreign\/vdc-prod" is not authorised/)
  })

  it('rejects EVERY infra field when the vDC scope on this connection is empty (zero-vDC tenant)', () => {
    // The scope.ts contract guarantees a non-default tenant with no vDCs
    // gets a non-null scope with empty Sets/Maps; the helper must deny
    // every infra field by construction.
    const scope = makeScope({ nodes: [], storages: [], pools: [], pbs: [] })
    expect(validateTenantJobInfra({ storage: 'any' }, scope, CONN)).toMatch(/not authorised/)
    expect(validateTenantJobInfra({ node: 'pve1' }, scope, CONN)).toMatch(/not authorised/)
    expect(validateTenantJobInfra({ fleecing: true, fleecingStorage: 'any' }, scope, CONN)).toMatch(/not authorised/)
    expect(validateTenantJobInfra({ namespace: 'any' }, scope, CONN)).toMatch(/not authorised/)
  })

  it('treats an empty body as a no-op (PUT with unrelated fields)', () => {
    const scope = makeScope()
    expect(validateTenantJobInfra({}, scope, CONN)).toBeNull()
  })
})

describe('getAllowedJobPools (provider + MSP see the whole cluster, iaas is pool-scoped)', () => {
  beforeEach(() => {
    getTenantInfrastructureScopeMock.mockReset()
  })

  it('returns null for the provider — no pool filter, full cluster view', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    expect(await getAllowedJobPools('default', CONN)).toBeNull()
  })

  it('returns null for an MSP tenant — it owns the whole cluster, so backup jobs are unfiltered', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set([CONN]) })
    expect(await getAllowedJobPools('tenant-msp', CONN)).toBeNull()
  })

  it('returns the vDC pool set for an iaas tenant on a connection it slices', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: makeScope({ pools: ['pool-acme'] }) })
    const pools = await getAllowedJobPools('tenant-iaas', CONN)
    expect(pools).not.toBeNull()
    expect([...pools!]).toEqual(['pool-acme'])
  })

  it('returns an empty (deny-all) set for an iaas tenant with no vDC on the target connection', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: makeScope({ pools: ['pool-acme'] }) })
    const pools = await getAllowedJobPools('tenant-iaas', 'conn-without-vdc')
    expect(pools).not.toBeNull()
    expect(pools!.size).toBe(0)
  })
})

describe('isJobOwnedByTenantPools', () => {
  it('keeps jobs whose pool is in the allow list', () => {
    expect(isJobOwnedByTenantPools({ pool: 'pool-acme' }, new Set(['pool-acme']))).toBe(true)
  })
  it('rejects jobs without a pool', () => {
    expect(isJobOwnedByTenantPools({}, new Set(['pool-acme']))).toBe(false)
    expect(isJobOwnedByTenantPools({ pool: null }, new Set(['pool-acme']))).toBe(false)
  })
  it('rejects jobs with a foreign pool', () => {
    expect(isJobOwnedByTenantPools({ pool: 'pool-other' }, new Set(['pool-acme']))).toBe(false)
  })
})
