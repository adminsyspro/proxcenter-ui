// src/lib/alerts/localAlertScope.ts
//
// The rows of ProxCenter's own alert table (/api/v1/alerts) that a caller may
// see or act on (roadmap#223). A row names its entity (a host, a guest, a
// cluster) but carries no RBAC or vDC scope, so the table was read and written
// whole by anyone holding the alerts permission. The rule is the one the
// assistant's alert tool already applies (lib/tools/alerts.ts, #459):
// - a caller nothing restricts (no vDC mask, the permission granted globally)
//   keeps every row, as before;
// - any other caller keeps the alerts about the hosts, guests and clusters of
//   its inventory as the permission checked reaches it (alerts.view to read,
//   alerts.manage to write); a row the inventory cannot place (a PBS server)
//   is not among them.

import { NextResponse } from "next/server"

import { getCurrentRbacInfraScope } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { alertInSnapshot, type ScopedAlert } from "@/lib/tools/alerts"
import { collectInventorySnapshot } from "@/lib/tools/snapshot"

export type LocalAlertEntity = Pick<ScopedAlert, "entityType" | "entityId" | "entityName" | "source">

type Permission = string

/**
 * Whether something narrows the caller on the table: a vDC mask, or the
 * permission granted on less than the whole tenant. The view context a
 * provider admin browses with does not count (object routes ignore it).
 */
export async function isLocalAlertScopeRestricted(permission: Permission): Promise<boolean> {
  const infra = await getTenantInfrastructureScope(await getCurrentTenantId(), { ignoreVdcContext: true })
  return !!maskingScope(infra) || (await getCurrentRbacInfraScope(permission)) !== null
}

/** Null when every row is visible, the predicate of the visible rows otherwise. */
export async function localAlertFilter(permission: Permission): Promise<((alert: LocalAlertEntity) => boolean) | null> {
  if (!(await isLocalAlertScopeRestricted(permission))) return null

  // The inventory as `permission` reaches it: a global viewer holding
  // alerts.manage on one node manages that node's alerts only.
  const snapshot = await collectInventorySnapshot({ permission })

  return alert => alertInSnapshot(alert, snapshot)
}

/** The fields of a row the visibility rule reads, for the loader below. */
export const LOCAL_ALERT_ENTITY_SELECT = { id: true, entityType: true, entityId: true, entityName: true, source: true } as const

/**
 * The ids among `ids` of the rows the caller may act on. `load` reads those
 * rows (LOCAL_ALERT_ENTITY_SELECT); it is not called when every row is visible.
 */
export async function visibleLocalAlertIds(
  ids: string[],
  permission: Permission,
  load: (ids: string[]) => Promise<(LocalAlertEntity & { id: string })[]>,
): Promise<string[]> {
  const visible = await localAlertFilter(permission)
  if (!visible) return ids

  return (await load(ids)).filter(visible).map(r => r.id)
}

/**
 * The writes that touch the table as a whole (a sync, which resolves every
 * row it does not name; an upsert by fingerprint, which reactivates any row)
 * stay with a caller nothing restricts, like the dashboard's own sync.
 */
export async function refuseRestrictedAlertWrite(): Promise<NextResponse | null> {
  if (!(await isLocalAlertScopeRestricted("alerts.manage"))) return null
  return NextResponse.json({ error: "This write needs alerts.manage on the whole tenant" }, { status: 403 })
}
