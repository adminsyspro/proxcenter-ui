// Shared prologue of the three hand-written public endpoints (metrics,
// backups, health): the three handlers are otherwise near-identical, and
// three copies of the same branch is exactly the duplication Sonar's 3%
// new-code gate flags — so this lives ONCE.
//
// A session (or anonymous) caller is not a token: it is gated by the
// endpoint's OWN RBAC permission (metrics/health -> PERMISSIONS.NODE_VIEW,
// backups -> PERMISSIONS.BACKUP_VIEW), which is what keeps every endpoint
// usable from the UI (spec section 8, Task 19 contract assertion (a)). A
// token caller skips straight to the fleet view: withPublicApiGuard
// (routeGuard.ts) already ran getPrincipal's anyOf scope check for the
// route's allowlist entry before the handler was invoked, so a token that
// reaches here already cleared the route-level gate. Any per-FAMILY
// filtering below that (metrics only) is the handler's own business, not
// this prologue's.
import { checkPermission } from "@/lib/rbac"
import type { Principal } from "@/lib/auth/principal"
import { buildFleetBackupFreshness, type FleetBackupFreshness } from "@/lib/backups/freshness"

import { loadPublicFleetView, type PublicFleetView } from "./publicData"

// FLAT on purpose (repo constraint): tsconfig strict:false breaks
// discriminated-union narrowing, so this is `{ ok, response?, view? }`
// rather than a union callers would need `.ok` to narrow.
export type PublicViewResult = {
  ok: boolean
  response?: Response
  view?: PublicFleetView
}

/**
 * Resolves the fleet view for one of the three public endpoints, applying
 * `sessionPermission` via `checkPermission` ONLY for a non-token caller.
 */
export async function loadPublicView(
  principal: Principal | undefined,
  sessionPermission: string,
): Promise<PublicViewResult> {
  if (!principal || principal.kind !== "token") {
    const denied = await checkPermission(sessionPermission)
    if (denied) return { ok: false, response: denied }
  }
  const view = await loadPublicFleetView(principal)
  return { ok: true, view }
}

/**
 * Projects a fleet view's guests into `buildFleetBackupFreshness`'s input
 * shape and runs the aggregation. Shared by `/metrics` (only when the
 * backup family is allowed — a real saving, since this walks every visible
 * PBS connection, not a cosmetic one) and `/backups` (always).
 */
export async function loadBackupFreshnessForView(view: PublicFleetView): Promise<FleetBackupFreshness> {
  return buildFleetBackupFreshness({
    tenantId: view.tenantId,
    visibleConnectionIds: view.visible,
    guests: view.guests.map(guest => ({
      connId: guest.connId,
      connectionName: guest.connectionName,
      vmid: guest.vmid,
      type: guest.type,
    })),
    // D12: a scrape must never block on a cold PBS cache.
    nonBlocking: true,
  })
}
