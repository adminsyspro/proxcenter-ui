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
 *  - role resolved      -> replace the provider row with the resolved role
 *    (falling back to role_viewer if the resolved role no longer exists)
 *  - null, no role yet  -> assign the default role (first login)
 *  - null, role exists  -> preserve whatever the user already has
 *
 * LDAP passes null when no group matches (preserve existing). OIDC always
 * resolves to a concrete role (its default on no match), so an OIDC re-sync is
 * a full re-evaluation: leaving a mapped group demotes the provider row to the
 * default role on the next login, while manual assignments stay untouched.
 */
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
    where: { userId, tenantId },
    select: { id: true },
  })
  if (!hasAnyRole) {
    await db.rbacUserRole.create({
      data: {
        id: newId(),
        userId,
        roleId: defaultRoleId,
        scopeType: "inherit",
        tenantId,
        grantedById: null,
        grantedAt: now,
      },
    })
  }
}
