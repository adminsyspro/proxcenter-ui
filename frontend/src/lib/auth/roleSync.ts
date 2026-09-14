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
