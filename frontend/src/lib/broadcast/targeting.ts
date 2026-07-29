// src/lib/broadcast/targeting.ts
//
// Decides whether a broadcast banner applies to the caller (#607). Kept free
// of Prisma / next-auth on purpose: the whole matrix is unit-tested without a
// database, and the caller passes an already-resolved principal.

export interface BroadcastPrincipal {
  userId: string
  /** The tenant the user is currently positioned on, not all their tenants. */
  tenantId: string
  /** RBAC role ids granted in the current tenant, non-expired grants only. */
  roleIds: string[]
  /** Legacy `User.role` value, used only when roleIds is empty. */
  legacyRole: string | null
}

export interface TargetableBroadcast {
  enabled: boolean
  startsAt: Date | null
  endsAt: Date | null
  targetKind: string
  /** JSONB column, so the shape is unknown until normalised. */
  targetIds: unknown
}

/** JSONB can hold anything; keep only non-empty strings. */
export function normaliseTargetIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

/**
 * Prefix a role value with `role_`. Twin of toRoleId() in
 * src/lib/auth/oidc.ts:111-114, reimplemented here because that module
 * imports Prisma and would drag a database into this pure unit.
 */
export function normaliseRoleId(role: string | null | undefined): string {
  const r = (role || 'viewer').trim() || 'viewer'
  return r.startsWith('role_') ? r : `role_${r}`
}

export function matchesPrincipal(
  broadcast: TargetableBroadcast,
  principal: BroadcastPrincipal,
  now: Date,
): boolean {
  if (!broadcast.enabled) return false
  if (broadcast.startsAt && broadcast.startsAt.getTime() > now.getTime()) return false
  if (broadcast.endsAt && broadcast.endsAt.getTime() < now.getTime()) return false

  const targetIds = normaliseTargetIds(broadcast.targetIds)

  switch (broadcast.targetKind) {
    case 'all':
      return true
    case 'tenants':
      return targetIds.includes(principal.tenantId)
    case 'roles': {
      // RBAC is the source of truth. The legacy column is only consulted for
      // estates where no grant was ever created, otherwise a user would match
      // on both their real roles and a stale legacy value.
      const held =
        principal.roleIds.length > 0
          ? principal.roleIds.map(normaliseRoleId)
          : [normaliseRoleId(principal.legacyRole)]
      return targetIds.some(id => held.includes(normaliseRoleId(id)))
    }
    default:
      // Unknown kind: fail closed rather than showing the banner to everyone.
      return false
  }
}
