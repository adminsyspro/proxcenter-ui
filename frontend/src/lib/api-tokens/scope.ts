// Connection perimeter applied where routes ENUMERATE (spec section 6):
// aggregated routes never pass a connection id to checkPermission, so their
// connection list MUST come from here. A connection referenced by the token
// but deleted since is silently dropped by the intersection.
import { getTenantConnectionIds, getCurrentTenantId } from "@/lib/tenant"

export type ConnectionScopedPrincipal = {
  tenantId: string
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
  principal?: ConnectionScopedPrincipal,
): Promise<{ tenantId: string; visible: Set<string> }> {
  const tenantId = principal ? principal.tenantId : await getCurrentTenantId()
  const visible = await resolveVisibleConnectionIds({
    tenantId,
    connectionIds: principal?.connectionIds ?? null,
  })
  return { tenantId, visible }
}
