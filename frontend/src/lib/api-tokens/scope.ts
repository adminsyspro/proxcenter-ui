// Connection perimeter applied where routes ENUMERATE (spec section 6):
// aggregated routes never pass a connection id to checkPermission, so their
// connection list MUST come from here. A connection referenced by the token
// but deleted since is silently dropped by the intersection.
import { getTenantConnectionIds, getCurrentTenantId } from "@/lib/tenant"

// NO `tenantId` field here on purpose (Task 18 hard gate 3): the perimeter
// is always intersected against `getTenantConnectionIds()`, which resolves
// the AMBIENT principal for the current request — the exact same one this
// type's caller is holding. A `tenantId` field on this type would never be
// read, and a parameter that lies about what the function honours is worse
// than no parameter: see `publicData.ts`'s doc comment on the bug this
// chantier already shipped once from exactly that shape.
export type ConnectionScopedPrincipal = {
  connectionIds?: string[] | null
}

export async function resolveVisibleConnectionIds(
  principal: ConnectionScopedPrincipal,
): Promise<Set<string>> {
  const tenantConnectionIds = await getTenantConnectionIds()
  if (!principal.connectionIds) return tenantConnectionIds
  const allowed = new Set(principal.connectionIds)
  const visible = new Set<string>()
  for (const id of tenantConnectionIds) {
    if (allowed.has(id)) visible.add(id)
  }
  return visible
}

/** Shared prologue of the three hand-written public endpoints. */
export async function resolvePublicRequestScope(
  principal?: { tenantId: string; connectionIds?: string[] | null },
): Promise<{ tenantId: string; visible: Set<string> }> {
  const tenantId = principal ? principal.tenantId : await getCurrentTenantId()
  const visible = await resolveVisibleConnectionIds({ connectionIds: principal?.connectionIds ?? null })
  return { tenantId, visible }
}

/**
 * Restrict an ALREADY tenant-scoped connection list to a token's connection
 * perimeter (spec section 6, D8 review checklist). A no-op for session
 * callers and for the absence of a principal: the guard only ever injects
 * one for a token, so this is the one call every aggregated route needs
 * after it enumerates connections and before it fans out to any of them.
 */
export async function restrictToTokenScope<T extends { id: string }>(
  connections: T[],
  principal?: { kind: string; connectionIds?: string[] | null } | null,
): Promise<T[]> {
  if (!principal || principal.kind !== "token") return connections
  const visible = await resolveVisibleConnectionIds(principal)
  return connections.filter(c => visible.has(c.id))
}
