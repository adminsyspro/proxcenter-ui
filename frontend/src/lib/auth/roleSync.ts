// src/lib/auth/roleSync.ts
//
// Provider-agnostic core for syncing a user's IdP-derived RBAC assignment on
// login (issue #383). Shared by the LDAP and OIDC sign-in paths so both
// providers re-evaluate group membership the same way on every login, instead
// of only at account creation.
//
// The provider-managed row is identified by its id prefix ("ldap_" / "oidc_"),
// so the delete/replace only ever touches the row this provider owns and never
// clobbers a manually-created assignment. Assignments are additive (no deny),
// so a manual elevation always survives a re-sync.
//
// That prefix is also how the sync knows who owns the user's role. The Users
// dialog (PATCH /api/v1/users/[id]) and the tenant assignment routes delete
// EVERY row of the user, the provider one included, and write back their own
// `tenant_role_default_…` / `assign_` row. So a provider row that is gone while
// another assignment stands is the signature of an admin having taken the role
// over, and the re-sync then leaves the user alone instead of seeding a second,
// provider-owned row next to theirs.
//
// "Another assignment" means a row an admin actually granted and that is still
// in force: a row owned by the OTHER provider does not count (an account moved
// from LDAP to OIDC must get the new provider's mapping, not keep the old one),
// and neither does an expired grant, which lib/rbac already ignores when it
// loads permissions.

/** Id prefixes of the rows the sign-in providers own and manage themselves. */
const PROVIDER_ID_PREFIXES = ["oidc_", "ldap_"] as const

// Minimal Prisma surface the sync needs — injected so the logic is unit
// testable without a real client.
export type ProviderSyncDb = {
  rbacRole: { findUnique: (args: any) => Promise<{ id: string } | null> }
  rbacUserRole: {
    findFirst: (args: any) => Promise<{ id: string } | null>
    deleteMany: (args: any) => Promise<unknown>
    create: (args: any) => Promise<unknown>
  }
  $transaction: (ops: unknown[]) => Promise<unknown>
}

/**
 * Sync a user's provider-derived RBAC assignment on login (issue #383).
 *
 * The assignment is created with scopeType "inherit" so it follows the role's
 * default scope automatically. The provider-managed row is identified by
 * `idPrefix`, so the delete/replace never touches a manually-created
 * assignment (which would otherwise be clobbered when keyed on scope type).
 *
 *  - role resolved, provider row present -> replace it with the resolved role
 *    (falling back to role_viewer if the resolved role no longer exists)
 *  - role resolved, provider row gone but another assignment stands -> do
 *    nothing, an admin owns this user's role now
 *  - role resolved, no assignment at all -> seed the provider row (first login)
 *  - null, no role yet  -> assign the default role (first login)
 *  - null, role exists  -> preserve whatever the user already has
 *
 * Both providers pass null when the re-sync is NOT authoritative (LDAP: no
 * group matched; OIDC: no mapping configured or the IdP sent no groups array,
 * issue #442), which preserves an existing role. When OIDC is authoritative it
 * resolves to a concrete role (its default on no match), so leaving every mapped
 * group demotes the provider row to the default on the next login, while manual
 * assignments stay untouched.
 */
/**
 * Prisma filter for a grant still in force, mirroring lib/rbac's
 * activeGrantFilter: an expired row grants nothing, so it must not read as a
 * role the user holds.
 */
function activeRow(now: Date) {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }
}

export async function syncProviderRoleAssignment(
  db: ProviderSyncDb,
  params: {
    userId: string
    resolvedRoleId: string | null
    defaultRoleId: string
    now: Date
    idPrefix: string
    newId: () => string
  },
): Promise<void> {
  const { userId, resolvedRoleId, defaultRoleId, now, idPrefix, newId } = params
  const tenantId = "default"
  const owned = { userId, tenantId, id: { startsWith: idPrefix } }

  if (resolvedRoleId) {
    // An admin who edits the role from the Users dialog wipes every row of the
    // user, this provider row included, and writes back a row of their own. Seeing
    // no provider row next to an admin-granted one therefore means the role is
    // now admin-owned: leave it alone rather than re-adding a provider row at every
    // login. Clearing the role in the dialog leaves no row at all and hands the
    // user back to the IdP, which the seed below picks up on the next login.
    const providerRow = await db.rbacUserRole.findFirst({
      where: owned,
      select: { id: true },
    })
    if (!providerRow) {
      const adminOwnedRole = await db.rbacUserRole.findFirst({
        where: {
          userId,
          tenantId,
          ...activeRow(now),
          NOT: { OR: PROVIDER_ID_PREFIXES.map(prefix => ({ id: { startsWith: prefix } })) },
        },
        select: { id: true },
      })
      if (adminOwnedRole) return
    }

    const roleExists = await db.rbacRole.findUnique({
      where: { id: resolvedRoleId },
      select: { id: true },
    })
    const finalRoleId = roleExists ? resolvedRoleId : "role_viewer"
    await db.$transaction([
      db.rbacUserRole.deleteMany({ where: owned }),
      db.rbacUserRole.create({
        data: {
          id: newId(),
          userId,
          roleId: finalRoleId,
          scopeType: "inherit",
          tenantId,
          grantedById: null,
          grantedAt: now,
        },
      }),
    ])
    return
  }

  // No role resolved — only seed the default role if the user has none yet,
  // so a manually-assigned role is never duplicated or overridden on login.
  const hasAnyRole = await db.rbacUserRole.findFirst({
    where: { userId, tenantId, ...activeRow(now) },
    select: { id: true },
  })
  if (!hasAnyRole) {
    // Validate the configured default still exists, falling back to role_viewer
    // like the resolved-role branch above. A stale/deleted custom default would
    // otherwise FK-fail the insert and break the first-login sign-in.
    const defaultExists = await db.rbacRole.findUnique({
      where: { id: defaultRoleId },
      select: { id: true },
    })
    await db.rbacUserRole.create({
      data: {
        id: newId(),
        userId,
        roleId: defaultExists ? defaultRoleId : "role_viewer",
        scopeType: "inherit",
        tenantId,
        grantedById: null,
        grantedAt: now,
      },
    })
  }
}

// ---------------------------------------------------------------------------
// Multi-tenant / multi-scope variant
// ---------------------------------------------------------------------------
//
// syncProviderRoleAssignment above owns exactly ONE row, in the provider
// tenant. A mapping that grants a role inside a customer tenant (or inside one
// vDC of it) produces a SET of rows spread over several tenants, so the
// reconciliation below replaces "delete my row, write my row" with "make the
// user's provider-owned rows match the grants, tenant by tenant".
//
// Two invariants carry over unchanged from the single-row version:
//  - only rows carrying `idPrefix` are ever touched, so a manual assignment
//    survives;
//  - a tenant where the provider row is gone while an admin-granted one still
//    stands is a tenant an admin has taken over (issue #940), and is skipped.
//    That test is now made PER TENANT: an admin owning the user in tenant A
//    must not freeze the IdP out of tenant B.
//
// Membership is reconciled alongside: a role in a tenant the user is not a
// member of grants nothing, and a membership left behind after the role is
// revoked shows a ghost in the tenant's member list.

/** One row the provider wants to own, already resolved to RBAC vocabulary. */
export type ProviderGrantRow = {
  tenantId: string
  roleId: string
  scopeType: string
  scopeTarget: string | null
}

/**
 * Tenant membership side effects, injected so the sync stays unit testable and
 * so the caller decides which implementation runs (lib/tenant in production).
 */
export type MembershipPort = {
  add: (userId: string, tenantId: string) => Promise<void>
  remove: (userId: string, tenantId: string) => Promise<void>
}

export type ProviderGrantsDb = ProviderSyncDb & {
  rbacUserRole: ProviderSyncDb["rbacUserRole"] & {
    findMany: (args: any) => Promise<Array<{ id: string; tenantId: string }>>
  }
}

/**
 * Membership changes must never take a login down. `removeUserFromTenant`
 * legitimately refuses on the user's last tenant and on super-admins, and those
 * refusals are outcomes, not failures: the user simply keeps that membership.
 */
async function tryMembership(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e: any) {
    console.warn(`[roleSync] ${label} skipped: ${e?.message || e}`)
  }
}

/**
 * Reconcile the provider-owned RBAC rows of a user against the grants resolved
 * from the IdP on this login.
 *
 * `grants === null` means the re-sync is NOT authoritative (no mapping
 * configured, or the IdP sent no groups array, issue #442): nothing is revoked
 * and the configured default is seeded only when the user holds no role at all.
 */
export async function syncProviderGrants(
  db: ProviderGrantsDb,
  params: {
    userId: string
    grants: ProviderGrantRow[] | null
    defaultRoleId: string
    now: Date
    idPrefix: string
    newId: () => string
    membership: MembershipPort
  },
): Promise<void> {
  const { userId, grants, defaultRoleId, now, idPrefix, newId, membership } = params

  if (!grants) {
    // Any role, in any tenant, counts as "this user already has one".
    const hasAnyRole = await db.rbacUserRole.findFirst({
      where: { userId, ...activeRow(now) },
      select: { id: true },
    })
    if (hasAnyRole) return

    const defaultExists = await db.rbacRole.findUnique({
      where: { id: defaultRoleId },
      select: { id: true },
    })
    await db.rbacUserRole.create({
      data: {
        id: newId(),
        userId,
        roleId: defaultExists ? defaultRoleId : "role_viewer",
        scopeType: "inherit",
        tenantId: "default",
        grantedById: null,
        grantedAt: now,
      },
    })
    return
  }

  const byTenant = new Map<string, ProviderGrantRow[]>()
  for (const grant of grants) {
    const rows = byTenant.get(grant.tenantId)
    if (rows) rows.push(grant)
    else byTenant.set(grant.tenantId, [grant])
  }

  const ownedRows = await db.rbacUserRole.findMany({
    where: { userId, id: { startsWith: idPrefix } },
    select: { id: true, tenantId: true },
  })
  const ownedTenants = new Set(ownedRows.map(row => row.tenantId))

  // Resolve every distinct role once. A role deleted since the mapping was
  // written must degrade to viewer rather than FK-fail the whole login.
  const validRoleIds = new Set<string>()
  for (const roleId of new Set(grants.map(g => g.roleId))) {
    const row = await db.rbacRole.findUnique({ where: { id: roleId }, select: { id: true } })
    if (row) validRoleIds.add(roleId)
  }

  for (const [tenantId, rows] of byTenant) {
    if (!ownedTenants.has(tenantId)) {
      const adminOwnedRole = await db.rbacUserRole.findFirst({
        where: {
          userId,
          tenantId,
          ...activeRow(now),
          NOT: { OR: PROVIDER_ID_PREFIXES.map(prefix => ({ id: { startsWith: prefix } })) },
        },
        select: { id: true },
      })
      if (adminOwnedRole) continue
    }

    await tryMembership(`add ${userId} to ${tenantId}`, () => membership.add(userId, tenantId))
    await db.$transaction([
      db.rbacUserRole.deleteMany({ where: { userId, tenantId, id: { startsWith: idPrefix } } }),
      ...rows.map(row =>
        db.rbacUserRole.create({
          data: {
            id: newId(),
            userId,
            roleId: validRoleIds.has(row.roleId) ? row.roleId : "role_viewer",
            scopeType: row.scopeType,
            scopeTarget: row.scopeTarget,
            tenantId,
            grantedById: null,
            grantedAt: now,
          },
        }),
      ),
    ])
  }

  // Tenants the provider owned a row in that the IdP no longer grants: the user
  // left the mapped group, so both the row and the membership it stood on go.
  for (const tenantId of ownedTenants) {
    if (byTenant.has(tenantId)) continue
    await db.rbacUserRole.deleteMany({ where: { userId, tenantId, id: { startsWith: idPrefix } } })
    await tryMembership(`remove ${userId} from ${tenantId}`, () => membership.remove(userId, tenantId))
  }
}
