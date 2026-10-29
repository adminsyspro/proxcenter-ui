/**
 * Tenant visibility filter for orchestrator change events, shared by
 * GET /api/v1/changes and GET /api/v1/changes/recent (the navbar dropdown).
 *
 * The orchestrator change feed is not tenant-aware. A record carries
 * connectionId / node / resourceType ("vm", "ct", "node", "storage",
 * "pool") / resourceId (a VMID like "100", or a node name) and, on guest
 * records, the pool the guest sat in when the record was written ("" for
 * none; null on records written before the orchestrator stamped it). On a
 * cluster shared between tenants, connection- and node-level checks cannot
 * separate neighbours; that pool is the reliable mask. The VMID is not: once
 * a guest is destroyed its ID can go to another tenant's guest, which would
 * then inherit the history of the guest it replaced.
 *
 * Rules, mirroring the alerts visibility filter:
 *  - no connectionId          → provider only (cluster-less events are
 *                               provider-internal state);
 *  - provider / msp           → connection-level perimeter, no masking;
 *  - iaas (vDC scope present) → the LIST perimeter follows the narrowed
 *                               vDC view context, then only guest-level
 *                               records ("vm" / "ct") written while the
 *                               guest sat in a vDC pool survive. node /
 *                               storage / pool records are provider infra
 *                               concerns. Missing pool = deny.
 *  - caller RBAC infra scope   → ANDed on top of all of the above: a
 *                               connection / node scoped user only sees the
 *                               records attributable to their grants (#525).
 *
 * A record that survives may still name, as its author, a ProxCenter account
 * of another tenant (the provider's staff acting on a vDC guest):
 * redactChangeForTenant shows that account as ProxCenter.
 */

import { getCurrentTenantId, getTenantConnectionIds } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { getCurrentRbacInfraScope, PERMISSIONS } from "@/lib/rbac"
import { isFlatRecordVisible, type RbacInfraScope } from "@/lib/rbac/infraScope"
import type { ChangeActor } from "@/lib/changes/attribution"

export type { ChangeActor } from "@/lib/changes/attribution"

const GUEST_RESOURCE_TYPES = new Set(["vm", "ct"])

export interface ChangeVisibilityCtx {
  infraKind: string
  tenantId: string
  tenantConnectionIds: Set<string>
  vdcScope: ReturnType<typeof maskingScope>
  /** Caller's RBAC infra scope; absent or null = unrestricted (issue #525). */
  rbacScope?: RbacInfraScope | null
}

export async function buildChangeVisibilityCtx(): Promise<ChangeVisibilityCtx> {
  const tenantId = await getCurrentTenantId()
  const infra = await getTenantInfrastructureScope(tenantId)

  return {
    infraKind: infra.kind,
    tenantId,
    tenantConnectionIds: await getTenantConnectionIds(),
    vdcScope: maskingScope(infra),
    rbacScope: await getCurrentRbacInfraScope(PERMISSIONS.CONNECTION_VIEW),
  }
}

export function isChangeVisibleToTenant(c: any, ctx: ChangeVisibilityCtx): boolean {
  // Caller's RBAC infra scope first (sync, cheap). Guest records carry their
  // VMID so a vm grant matches them; guest and node records are node-bound;
  // storage / pool records are cluster-level facts.
  if (ctx.rbacScope) {
    const guest = GUEST_RESOURCE_TYPES.has(c.resourceType)
    const visible = isFlatRecordVisible(ctx.rbacScope, {
      connId: c.connectionId,
      node: c.node,
      vmid: guest ? c.resourceId : undefined,
      nodeBound: guest || c.resourceType === "node",
    })
    if (!visible) return false
  }

  if (!c.connectionId) return ctx.infraKind === "provider"

  if (!ctx.vdcScope) return ctx.tenantConnectionIds.has(c.connectionId)

  if (!ctx.vdcScope.connectionIds.has(c.connectionId)) return false

  // Defense in depth: when the scope restricts nodes on this connection,
  // drop records reported from a node outside it.
  const allowedNodes = ctx.vdcScope.nodesByConnection.get(c.connectionId)
  if (allowedNodes && c.node && !allowedNodes.has(c.node)) return false

  if (!GUEST_RESOURCE_TYPES.has(c.resourceType)) return false

  // The pool stamped at write time names the owner of the guest the record
  // is about, whoever holds its VMID today: a reused ID must not hand a
  // tenant the history, deletion included, of the guest it replaced. A
  // record written before the stamp cannot tell, so it stays provider-side.
  if (typeof c.pool !== "string") return false

  return Boolean(ctx.vdcScope.poolsByConnection?.get(c.connectionId)?.has(c.pool))
}

/** What a ProxCenter account of another tenant is shown as. */
export const MASKED_ACTOR = "ProxCenter"

/**
 * The record as the caller's tenant may read it. The provider sees every
 * author. Any other tenant sees the ProxCenter accounts of its own tenant by
 * their address and those of another as ProxCenter, and no tenant IDs.
 */
export function redactChangeForTenant<T extends { user?: string; actors?: ChangeActor[] }>(c: T, ctx: ChangeVisibilityCtx): T {
  if (ctx.infraKind === "provider" || !Array.isArray(c.actors) || c.actors.length === 0) return c

  const hidden = new Set<string>()
  const actors = c.actors.map(({ tenantId, ...a }) => {
    // ProxCenter's own records name its accounts: the audit, a migration job
    if ((a.source !== "audit" && a.source !== "migration") || tenantId === ctx.tenantId) return a
    hidden.add(a.name)

    return { ...a, name: MASKED_ACTOR, ref: undefined, masked: true }
  })
  if (hidden.size === 0) return { ...c, actors }

  const names = (c.user || "").split(", ").filter(Boolean).map(n => (hidden.has(n) ? MASKED_ACTOR : n))

  return { ...c, actors, user: [...new Set(names)].join(", ") }
}
