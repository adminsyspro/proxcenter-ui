/**
 * Tenant / vDC aware OIDC group mapping: the login re-sync now reconciles a SET
 * of provider-owned rows across tenants, and keeps tenant membership in step.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { syncOidcRoleAssignment, resolveOidcGrants, oidcSeedRoleId, expandAllTenantGrants } from './oidc'
import type { OidcConfig } from './oidc'
import {
  normalizeGroupGrantMapping,
  projectGrantsToRoleMapping,
  type MappingStrategy,
} from './groupMapping'

function makeConfig(
  mapping: unknown,
  defaultRole = 'role_viewer',
  groupMappingStrategy: MappingStrategy = 'first_match',
): OidcConfig {
  const groupGrants = normalizeGroupGrantMapping(mapping)
  return {
    enabled: true,
    providerName: 'SSO',
    issuerUrl: 'https://idp.example.com',
    clientId: 'cid',
    clientSecret: null,
    scopes: 'openid profile email',
    authorizationUrl: null,
    tokenUrl: null,
    userinfoUrl: null,
    claimEmail: 'email',
    claimName: 'name',
    claimGroups: 'groups',
    autoProvision: true,
    defaultRole,
    groupRoleMapping: projectGrantsToRoleMapping(groupGrants),
    groupGrants,
    groupMappingStrategy,
    showLocalLogin: true,
    forceSsoRedirect: false,
  }
}

function makeDb(overrides: Record<string, any> = {}) {
  return {
    rbacRole: { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id })) },
    rbacUserRole: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
    vdc: { findMany: vi.fn().mockResolvedValue([]) },
    $transaction: vi.fn(async (ops: any[]) => ops),
    ...overrides,
  } as any
}

function makeMembership(overrides: Record<string, any> = {}) {
  return {
    add: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

let seq = 0
const params = (extra: Record<string, any> = {}) => ({
  userId: 'u1',
  groups: ['ops'] as string[] | undefined,
  config: makeConfig([{ group: 'ops', role: 'role_tenant_operator' }]),
  now: new Date('2026-09-14T00:00:00Z'),
  newId: () => `oidc_${++seq}`,
  groupsClaimIsArray: true,
  membership: makeMembership(),
  ...extra,
})

const createdRows = (db: any) => db.rbacUserRole.create.mock.calls.map((c: any[]) => c[0].data)
const deletedTenants = (db: any) =>
  db.rbacUserRole.deleteMany.mock.calls.map((c: any[]) => c[0].where.tenantId)

beforeEach(() => {
  seq = 0
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('resolveOidcGrants', () => {
  it('returns one grant per tenant when a group is mapped several times', () => {
    const config = makeConfig([
      { group: 'ops', tenant: 'default', role: 'role_viewer' },
      { group: 'ops', tenant: 't_acme', role: 'role_tenant_operator' },
    ])
    expect(resolveOidcGrants(['ops'], config)).toEqual([
      { tenantId: 'default', vdcId: null, roleId: 'role_viewer' },
      { tenantId: 't_acme', vdcId: null, roleId: 'role_tenant_operator' },
    ])
  })

  it('keeps the first match per tenant and vDC pair', () => {
    const config = makeConfig([
      { group: 'ops', tenant: 't_acme', role: 'role_tenant_operator' },
      { group: 'admins', tenant: 't_acme', role: 'role_admin' },
    ])
    expect(resolveOidcGrants(['ops', 'admins'], config)).toEqual([
      { tenantId: 't_acme', vdcId: null, roleId: 'role_tenant_operator' },
    ])
  })

  it('treats a vDC grant and a tenant-wide grant as two distinct scopes', () => {
    const config = makeConfig([
      { group: 'ops', tenant: 't_acme', role: 'role_viewer' },
      { group: 'ops', tenant: 't_acme', vdc: 'vdc_prod', role: 'role_tenant_operator' },
    ])
    expect(resolveOidcGrants(['ops'], config)).toHaveLength(2)
  })

  it('normalises a bare role name to a role_ id', () => {
    const config = makeConfig([{ group: 'ops', tenant: 't_acme', role: 'operator' }])
    expect(resolveOidcGrants(['ops'], config)[0].roleId).toBe('role_operator')
  })

  it('grants nothing when a configured mapping matches no group (CX-23)', () => {
    const config = makeConfig([{ group: 'ops', tenant: 't_acme', role: 'role_tenant_operator' }], 'viewer')
    // Provider membership requires an explicit group: leaving every mapped
    // group must not silently hand out the provider default role.
    expect(resolveOidcGrants(['nobody'], config)).toEqual([])
    expect(resolveOidcGrants([], config)).toEqual([])
    expect(oidcSeedRoleId(['nobody'], config)).toBe('role_tenant_viewer')
  })

  it('still seeds the provider default when NO group mapping is configured', () => {
    const config = makeConfig([], 'viewer')
    expect(resolveOidcGrants([], config)).toEqual([
      { tenantId: 'default', vdcId: null, roleId: 'role_viewer' },
    ])
  })

  // ── Issue #992: the mapping order decides, and it can be cumulative ──────

  it('keeps the topmost row whatever order the IdP lists the groups in', () => {
    const config = makeConfig([
      { group: 'admins', role: 'role_admin' },
      { group: 'devs', role: 'role_tenant_operator' },
    ])
    expect(resolveOidcGrants(['devs', 'admins'], config)).toEqual([
      { tenantId: 'default', vdcId: null, roleId: 'role_admin' },
    ])
    expect(resolveOidcGrants(['admins', 'devs'], config)).toEqual([
      { tenantId: 'default', vdcId: null, roleId: 'role_admin' },
    ])
  })

  it('follows the rows once they are reordered', () => {
    const config = makeConfig([
      { group: 'devs', role: 'role_tenant_operator' },
      { group: 'admins', role: 'role_admin' },
    ])
    expect(resolveOidcGrants(['devs', 'admins'], config)).toEqual([
      { tenantId: 'default', vdcId: null, roleId: 'role_tenant_operator' },
    ])
  })

  it('grants every matching role in the same scope under the cumulative strategy', () => {
    const config = makeConfig(
      [
        { group: 'admins', role: 'role_admin' },
        { group: 'devs', role: 'role_tenant_operator' },
        { group: 'oncall', role: 'role_viewer' },
      ],
      'role_viewer',
      'cumulative',
    )
    expect(resolveOidcGrants(['devs', 'admins'], config)).toEqual([
      { tenantId: 'default', vdcId: null, roleId: 'role_admin' },
      { tenantId: 'default', vdcId: null, roleId: 'role_tenant_operator' },
    ])
  })

  it('drops the exact duplicate two rows would produce for the same user', () => {
    const config = makeConfig(
      [
        { group: 'admins', role: 'role_admin' },
        { group: 'devs', role: 'role_admin' },
      ],
      'role_viewer',
      'cumulative',
    )
    expect(resolveOidcGrants(['admins', 'devs'], config)).toEqual([
      { tenantId: 'default', vdcId: null, roleId: 'role_admin' },
    ])
  })

  it('cumulates inside each scope separately', () => {
    const config = makeConfig(
      [
        { group: 'admins', tenant: 't_acme', role: 'role_admin' },
        { group: 'devs', tenant: 't_acme', vdc: 'vdc_prod', role: 'role_tenant_operator' },
        { group: 'devs', tenant: 't_acme', role: 'role_viewer' },
      ],
      'role_viewer',
      'cumulative',
    )
    expect(resolveOidcGrants(['admins', 'devs'], config)).toEqual([
      { tenantId: 't_acme', vdcId: null, roleId: 'role_admin' },
      { tenantId: 't_acme', vdcId: 'vdc_prod', roleId: 'role_tenant_operator' },
      { tenantId: 't_acme', vdcId: null, roleId: 'role_viewer' },
    ])
  })

  it('grants nothing under the cumulative strategy when nothing matches', () => {
    const config = makeConfig(
      [{ group: 'admins', role: 'role_admin' }],
      'viewer',
      'cumulative',
    )
    expect(resolveOidcGrants(['nobody'], config)).toEqual([])
  })
})

describe('oidcSeedRoleId', () => {
  it('prefers the provider-tenant grant for the legacy users.role column', () => {
    const config = makeConfig([
      { group: 'ops', tenant: 't_acme', role: 'role_tenant_operator' },
      { group: 'ops', tenant: 'default', role: 'role_viewer' },
    ])
    expect(oidcSeedRoleId(['ops'], config)).toBe('role_viewer')
  })

  it('falls back to the first grant when the mapping targets no provider tenant', () => {
    const config = makeConfig([{ group: 'ops', tenant: 't_acme', role: 'role_tenant_operator' }])
    expect(oidcSeedRoleId(['ops'], config)).toBe('role_tenant_operator')
  })

  it('shows the topmost provider-tenant row when several roles are cumulated', () => {
    const config = makeConfig(
      [
        { group: 'admins', role: 'role_admin' },
        { group: 'devs', role: 'role_tenant_operator' },
      ],
      'role_viewer',
      'cumulative',
    )
    expect(oidcSeedRoleId(['devs', 'admins'], config)).toBe('role_admin')
  })
})

describe('syncOidcRoleAssignment — multi-tenant reconciliation', () => {
  it('creates one row per tenant and joins the user to each of them', async () => {
    const db = makeDb()
    const membership = makeMembership()
    await syncOidcRoleAssignment(
      db,
      params({
        membership,
        config: makeConfig([
          { group: 'ops', tenant: 'default', role: 'role_viewer' },
          { group: 'ops', tenant: 't_acme', role: 'role_tenant_operator' },
        ]),
      }),
    )

    expect(createdRows(db)).toEqual([
      expect.objectContaining({ tenantId: 'default', roleId: 'role_viewer', scopeType: 'inherit' }),
      expect.objectContaining({ tenantId: 't_acme', roleId: 'role_tenant_operator', scopeType: 'inherit' }),
    ])
    expect(membership.add.mock.calls).toEqual([
      ['u1', 'default'],
      ['u1', 't_acme'],
    ])
    expect(membership.remove).not.toHaveBeenCalled()
  })

  it('scopes a vDC grant to the vDC PVE pool', async () => {
    const db = makeDb({
      vdc: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'vdc_prod', tenantId: 't_acme', pvePoolName: 'pool-acme-prod' }]),
      },
    })
    await syncOidcRoleAssignment(
      db,
      params({
        config: makeConfig([{ group: 'ops', tenant: 't_acme', vdc: 'vdc_prod', role: 'role_tenant_operator' }]),
      }),
    )

    expect(createdRows(db)).toEqual([
      expect.objectContaining({
        tenantId: 't_acme',
        roleId: 'role_tenant_operator',
        scopeType: 'pool',
        scopeTarget: 'pool-acme-prod',
      }),
    ])
  })

  it('gives a user two rows in one tenant when they hold a tenant-wide and a vDC grant', async () => {
    const db = makeDb({
      vdc: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ id: 'vdc_prod', tenantId: 't_acme', pvePoolName: 'pool-acme-prod' }]),
      },
    })
    await syncOidcRoleAssignment(
      db,
      params({
        groups: ['viewers', 'ops'],
        config: makeConfig([
          { group: 'viewers', tenant: 't_acme', role: 'role_tenant_viewer' },
          { group: 'ops', tenant: 't_acme', vdc: 'vdc_prod', role: 'role_tenant_operator' },
        ]),
      }),
    )

    // One transaction for the tenant, carrying both rows.
    expect(db.$transaction).toHaveBeenCalledTimes(1)
    expect(createdRows(db)).toHaveLength(2)
    expect(createdRows(db).map((r: any) => r.scopeType).sort()).toEqual(['inherit', 'pool'])
  })

  it('revokes the row AND the membership of a tenant the IdP no longer grants', async () => {
    const db = makeDb({
      rbacUserRole: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([
          { id: 'oidc_old_acme', tenantId: 't_acme' },
          { id: 'oidc_old_default', tenantId: 'default' },
        ]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({}),
      },
    })
    const membership = makeMembership()
    await syncOidcRoleAssignment(
      db,
      params({ membership, config: makeConfig([{ group: 'ops', role: 'role_viewer' }]) }),
    )

    expect(deletedTenants(db)).toEqual(['default', 't_acme'])
    expect(createdRows(db)).toEqual([expect.objectContaining({ tenantId: 'default' })])
    expect(membership.remove.mock.calls).toEqual([['u1', 't_acme']])
  })

  it('does not let an admin takeover in one tenant freeze the IdP out of another', async () => {
    // The #940 rule (an admin-granted row with no provider row beside it means
    // hands off) is evaluated PER TENANT, not globally.
    const db = makeDb({
      rbacUserRole: {
        findFirst: vi.fn(async ({ where }: any) =>
          where.tenantId === 'default' ? { id: 'assign_u1_manual' } : null,
        ),
        findMany: vi.fn().mockResolvedValue([]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
      },
    })
    const membership = makeMembership()
    await syncOidcRoleAssignment(
      db,
      params({
        membership,
        config: makeConfig([
          { group: 'ops', tenant: 'default', role: 'role_viewer' },
          { group: 'ops', tenant: 't_acme', role: 'role_tenant_operator' },
        ]),
      }),
    )

    expect(deletedTenants(db)).toEqual(['t_acme'])
    expect(createdRows(db)).toEqual([expect.objectContaining({ tenantId: 't_acme' })])
    expect(membership.add.mock.calls).toEqual([['u1', 't_acme']])
  })

  it('keeps the login alive when a membership change is refused', async () => {
    // removeUserFromTenant legitimately refuses on the user's last tenant and
    // on super-admins: an outcome, not a reason to fail the sign-in.
    const db = makeDb({
      rbacUserRole: {
        findFirst: vi.fn().mockResolvedValue(null),
        findMany: vi.fn().mockResolvedValue([{ id: 'oidc_old', tenantId: 't_acme' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
        create: vi.fn().mockResolvedValue({}),
      },
    })
    const membership = makeMembership({
      remove: vi.fn().mockRejectedValue(new Error('Cannot remove the last tenant membership')),
    })

    await expect(
      syncOidcRoleAssignment(
        db,
        params({ membership, config: makeConfig([{ group: 'ops', role: 'role_viewer' }]) }),
      ),
    ).resolves.toBeUndefined()
    expect(createdRows(db)).toEqual([expect.objectContaining({ tenantId: 'default' })])
  })

  it('still handles a legacy flat mapping as a single provider-tenant row', async () => {
    const db = makeDb()
    const membership = makeMembership()
    await syncOidcRoleAssignment(db, params({ membership, config: makeConfig({ ops: 'role_tenant_operator' }) }))

    expect(createdRows(db)).toEqual([
      expect.objectContaining({ tenantId: 'default', roleId: 'role_tenant_operator', scopeType: 'inherit' }),
    ])
    expect(membership.add.mock.calls).toEqual([['u1', 'default']])
  })

  it('preserves every tenant row when the groups claim is not authoritative (#442)', async () => {
    const db = makeDb({
      rbacUserRole: {
        findFirst: vi.fn().mockResolvedValue({ id: 'oidc_old_acme' }),
        findMany: vi.fn().mockResolvedValue([{ id: 'oidc_old_acme', tenantId: 't_acme' }]),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
      },
    })
    const membership = makeMembership()
    await syncOidcRoleAssignment(
      db,
      params({
        membership,
        groupsClaimIsArray: false,
        config: makeConfig([{ group: 'ops', tenant: 't_acme', role: 'role_tenant_operator' }]),
      }),
    )

    expect(db.rbacUserRole.deleteMany).not.toHaveBeenCalled()
    expect(db.rbacUserRole.create).not.toHaveBeenCalled()
    expect(membership.add).not.toHaveBeenCalled()
    expect(membership.remove).not.toHaveBeenCalled()
  })

  it('degrades a grant whose role was deleted to the tenant viewer instead of failing the login', async () => {
    const db = makeDb({ rbacRole: { findUnique: vi.fn().mockResolvedValue(null) } })
    await syncOidcRoleAssignment(
      db,
      params({ config: makeConfig([{ group: 'ops', tenant: 't_acme', role: 'role_ghost' }]) }),
    )
    // role_viewer is a provider-only role: a customer tenant gets role_tenant_viewer.
    expect(createdRows(db)).toEqual([
      expect.objectContaining({ tenantId: 't_acme', roleId: 'role_tenant_viewer' }),
    ])
  })
})

describe('provider catalogue at login (ui#1336)', () => {
  const catalogueRole = (where: any, over: Record<string, unknown> = {}) => ({
    id: where.id, isSystem: false, tenantId: 'default', audience: 'service_desk', publishAll: false,
    publications: [{ tenantId: 't_acme' }, { tenantId: 't_beta' }], ...over,
  })

  it('expands "every published tenant" into one row per tenant the role is published to', async () => {
    const db = makeDb({ rbacRole: { findUnique: vi.fn(async ({ where }: any) => catalogueRole(where)) } })
    await syncOidcRoleAssignment(db, params({ config: makeConfig([{ group: 'ops', tenant: '*', role: 'role_sd' }]) }))
    expect(createdRows(db).map((r: any) => r.tenantId).sort()).toEqual(['t_acme', 't_beta'])
  })

  it('expands a role published to all tenants to every enabled customer tenant', async () => {
    const db = makeDb({
      rbacRole: { findUnique: vi.fn(async ({ where }: any) => catalogueRole(where, { publishAll: true, publications: [] })) },
      tenant: { findMany: vi.fn().mockResolvedValue([{ id: 't_x' }]) },
    })
    await syncOidcRoleAssignment(db, params({ config: makeConfig([{ group: 'ops', tenant: '*', role: 'role_sd' }]) }))
    expect(createdRows(db).map((r: any) => r.tenantId)).toEqual(['t_x'])
  })

  it('lets an explicit row above win under first_match, and expands nothing for a role outside the catalogue', async () => {
    const db = makeDb({
      rbacRole: {
        findUnique: vi.fn(async ({ where }: any) => (where.id === 'role_sd' ? catalogueRole(where) : { id: where.id, isSystem: true, tenantId: null })),
      },
    })
    await syncOidcRoleAssignment(db, params({
      config: makeConfig([
        { group: 'ops', tenant: 't_acme', role: 'role_tenant_viewer' },
        { group: 'ops', tenant: '*', role: 'role_sd' },
        { group: 'ops', tenant: '*', role: 'role_tenant_admin' },
      ]),
    }))
    expect(createdRows(db).map((r: any) => `${r.tenantId}:${r.roleId}`).sort()).toEqual(['t_acme:role_tenant_viewer', 't_beta:role_sd'])
  })

  it('drops a grant whose role is not published to the tenant, and a provider-only role in a customer tenant', async () => {
    const db = makeDb({
      rbacRole: {
        findUnique: vi.fn(async ({ where }: any) =>
          where.id === 'role_sd' ? catalogueRole(where, { publications: [{ tenantId: 't_beta' }] }) : { id: where.id, isSystem: true, tenantId: null },
        ),
      },
    })
    const membership = makeMembership()
    await syncOidcRoleAssignment(db, params({
      membership,
      config: makeConfig([
        { group: 'ops', tenant: 't_acme', role: 'role_sd' },
        { group: 'ops', tenant: 't_gamma', role: 'role_operator' },
      ]),
    }))
    expect(createdRows(db)).toEqual([])
    expect(membership.add).not.toHaveBeenCalled()
  })
})

describe('expandAllTenantGrants', () => {
  it('returns the grants untouched when none targets every tenant', async () => {
    const grants = [{ tenantId: 't1', vdcId: null, roleId: 'r' }]
    const db = { rbacRole: { findUnique: vi.fn() } }
    expect(await expandAllTenantGrants(db, grants, false)).toBe(grants)
    expect(db.rbacRole.findUnique).not.toHaveBeenCalled()
  })

  it('keeps every role per tenant under the cumulative strategy', async () => {
    const db = { rbacRole: { findUnique: vi.fn(async () => ({ audience: 'tenant', publishAll: false, publications: [{ tenantId: 't1' }] })) } }
    const out = await expandAllTenantGrants(db, [
      { tenantId: 't1', vdcId: null, roleId: 'a' },
      { tenantId: '*', vdcId: null, roleId: 'b' },
    ], true)
    expect(out).toEqual([
      { tenantId: 't1', vdcId: null, roleId: 'a' },
      { tenantId: 't1', vdcId: null, roleId: 'b' },
    ])
  })

  it('expands nothing for a deleted role, or a published role without a tenant lookup', async () => {
    const db = { rbacRole: { findUnique: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce({ audience: 'tenant', publishAll: true, publications: [] }) } }
    expect(await expandAllTenantGrants(db, [{ tenantId: '*', vdcId: null, roleId: 'gone' }], false)).toEqual([])
    expect(await expandAllTenantGrants(db, [{ tenantId: '*', vdcId: null, roleId: 'all' }], false)).toEqual([])
  })
})
