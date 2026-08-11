/**
 * Tenant visibility filter for orchestrator change events, shared by
 * GET /api/v1/changes and GET /api/v1/changes/recent (the navbar dropdown).
 *
 * The orchestrator change feed is not tenant-aware. A record carries
 * connectionId / node / resourceType ("vm", "ct", "node", "storage",
 * "pool") / resourceId (a VMID like "100", or a node name) — and NO pool
 * field, so pool-based masking is impossible here. On a cluster shared
 * between tenants, connection- and node-level checks cannot separate
 * neighbours; VM ownership (the vDC pool's VMID set) is the only reliable
 * mask.
 *
 * Rules, mirroring the alerts visibility filter:
 *  - no connectionId          → provider only (cluster-less events are
 *                               provider-internal state);
 *  - provider / msp           → connection-level perimeter, no masking;
 *  - iaas (vDC scope present) → the LIST perimeter follows the narrowed
 *                               vDC view context, then only guest-level
 *                               records ("vm" / "ct") owned by the vDC
 *                               (VMID resolved in the vDC pools) survive.
 *                               node / storage / pool records are provider
 *                               infra concerns. Missing key = deny.
 */

import { getCurrentTenantId, getTenantConnectionIds } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { getVdcVmidsByConnection } from "@/lib/alerts/vdcVmids"

const GUEST_RESOURCE_TYPES = new Set(["vm", "ct"])

export interface ChangeVisibilityCtx {
  infraKind: string
  tenantConnectionIds: Set<string>
  vdcScope: ReturnType<typeof maskingScope>
  vdcVmids?: Map<string, Set<string>>
}

export async function buildChangeVisibilityCtx(): Promise<ChangeVisibilityCtx> {
  const tenantId = await getCurrentTenantId()
  const infra = await getTenantInfrastructureScope(tenantId)
  const vdcScope = maskingScope(infra)

  return {
    infraKind: infra.kind,
    tenantConnectionIds: await getTenantConnectionIds(),
    vdcScope,
    vdcVmids: vdcScope ? await getVdcVmidsByConnection(tenantId) : undefined,
  }
}

export function isChangeVisibleToTenant(c: any, ctx: ChangeVisibilityCtx): boolean {
  if (!c.connectionId) return ctx.infraKind === "provider"

  if (!ctx.vdcScope) return ctx.tenantConnectionIds.has(c.connectionId)

  if (!ctx.vdcScope.connectionIds.has(c.connectionId)) return false

  // Defense in depth: when the scope restricts nodes on this connection,
  // drop records reported from a node outside it.
  const allowedNodes = ctx.vdcScope.nodesByConnection.get(c.connectionId)
  if (allowedNodes && c.node && !allowedNodes.has(c.node)) return false

  if (!GUEST_RESOURCE_TYPES.has(c.resourceType)) return false

  const ownedVmids = ctx.vdcVmids?.get(c.connectionId)

  return Boolean(ownedVmids && c.resourceId && ownedVmids.has(String(c.resourceId)))
}
