// src/lib/auth/vdcScope.ts
//
// Translate the vDC half of a group->grant mapping into RBAC vocabulary.
//
// A vDC is a tenant + a connection + a PVE pool, so it needs no scope type of
// its own: the assignment already carries the tenant, and the pool name pins
// the resources inside it. Resolving to `pool` keeps the whole permission
// engine (and lib/rbac/scopeKinds) untouched.

import type { ProviderGrantRow } from "./roleSync"

export type VdcScope = { tenantId: string; pvePoolName: string }

/** Minimal Prisma surface, injected so the resolution is unit testable. */
export type VdcScopeDb = {
  vdc: {
    findMany: (args: any) => Promise<Array<{ id: string; tenantId: string; pvePoolName: string }>>
  }
}

/** A grant as resolved from the IdP groups, before RBAC translation. */
export type ResolvedGrant = { tenantId: string; vdcId: string | null; roleId: string }

/** Load the tenant + pool of every referenced vDC in one query. */
export async function loadVdcScopes(
  db: VdcScopeDb,
  vdcIds: readonly string[],
): Promise<Map<string, VdcScope>> {
  const ids = [...new Set(vdcIds.filter(Boolean))]
  if (ids.length === 0) return new Map()

  const rows = await db.vdc.findMany({
    where: { id: { in: ids } },
    select: { id: true, tenantId: true, pvePoolName: true },
  })
  return new Map(rows.map(row => [row.id, { tenantId: row.tenantId, pvePoolName: row.pvePoolName }]))
}

/**
 * Turn resolved grants into the rows the provider should own.
 *
 * A grant with no vDC covers the whole tenant and keeps scopeType "inherit", so
 * it still follows the role's own default scope. A vDC grant becomes a `pool`
 * scope on the vDC's PVE pool.
 *
 * A grant naming a vDC that no longer exists, or one that belongs to a
 * different tenant than the entry claims, is DROPPED rather than widened to the
 * whole tenant: a stale mapping must never hand out more access than it spells
 * out. Dropping is logged so the cause is visible when a user loses a role.
 */
export function toProviderGrantRows(
  grants: readonly ResolvedGrant[],
  vdcScopes: Map<string, VdcScope>,
): ProviderGrantRow[] {
  const rows: ProviderGrantRow[] = []
  for (const grant of grants) {
    if (!grant.vdcId) {
      rows.push({
        tenantId: grant.tenantId,
        roleId: grant.roleId,
        scopeType: "inherit",
        scopeTarget: null,
      })
      continue
    }

    const scope = vdcScopes.get(grant.vdcId)
    if (!scope) {
      console.warn(`[vdcScope] mapping references unknown vDC ${grant.vdcId}, grant dropped`)
      continue
    }
    if (scope.tenantId !== grant.tenantId) {
      console.warn(
        `[vdcScope] vDC ${grant.vdcId} belongs to tenant ${scope.tenantId}, not ${grant.tenantId}, grant dropped`,
      )
      continue
    }

    rows.push({
      tenantId: grant.tenantId,
      roleId: grant.roleId,
      scopeType: "pool",
      scopeTarget: scope.pvePoolName,
    })
  }
  return rows
}
