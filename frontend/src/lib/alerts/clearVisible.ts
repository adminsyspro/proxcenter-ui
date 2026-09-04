/**
 * Clear the alerts a tenant can actually SEE, one by one.
 *
 * The Go orchestrator's clear operations (`clearAll`, `/alerts/clear`) have
 * no tenant concept: on a PVE connection shared between tenants (or between
 * two vDCs of different tenants) they wipe the neighbours' active alerts
 * too. Non-provider clear-all therefore resolves the caller's visible alert
 * set — the exact same visibility filter as GET /api/v1/orchestrator/alerts,
 * i.e. the vDC-context-narrowed view, so "clear all" clears what the list
 * shows — and deletes alert by alert id. The provider keeps the
 * orchestrator-native connection- or fleet-wide clear in its routes.
 */

import { alertsApi } from "@/lib/orchestrator/client"
import { isAlertVisibleToTenant } from "@/lib/alerts/visibility"
import { getVdcVmidsByConnection } from "@/lib/alerts/vdcVmids"
import { getCurrentTenantId, getTenantConnectionIds } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { getCurrentRbacInfraScope, PERMISSIONS } from "@/lib/rbac"

/** Returns the number of alerts actually cleared. */
export async function clearVisibleTenantAlerts(connectionId?: string): Promise<number> {
  const tenantId = await getCurrentTenantId()
  const tenantConnectionIds = await getTenantConnectionIds()
  const infra = await getTenantInfrastructureScope(tenantId)
  const vdcScope = maskingScope(infra)
  const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : undefined
  // Caller's RBAC infra scope (issue #525): "clear all" clears what the list shows.
  const rbacScope = await getCurrentRbacInfraScope(PERMISSIONS.ALERTS_MANAGE)
  const ctx = { tenantId, tenantConnectionIds, vdcScope, vdcVmids, infraKind: infra.kind, rbacScope }

  // Same fetch shape as the GET list route (500-cap mirrors its page size).
  const response = await alertsApi.getAlerts({
    connection_id: connectionId,
    status: "active",
    limit: 500,
    offset: 0,
  })

  const all = response.data?.data || response.data || []
  if (!Array.isArray(all)) return 0

  const visible = await Promise.all(all.map((a: any) => isAlertVisibleToTenant(a, ctx)))
  const targets = all.filter((_: any, i: number) => visible[i])

  for (const alert of targets) {
    await alertsApi.deleteAlert(String(alert.id))
  }

  return targets.length
}
