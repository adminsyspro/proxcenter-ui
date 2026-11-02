// Tenant filter of the orchestrator alerts the dashboard merges (G20).
//
// The orchestrator answers every open alert of the fleet, unfiltered by
// tenant. The bell (orchestrator/alerts/active) keeps only those
// isAlertVisibleToTenant lets through; the dashboard used to merge them with
// the RBAC gate alone, so an IaaS tenant saw the built-in alerts of the shared
// provider cluster (Ceph noout with its CRUSH host, OSD latency) and those of
// other connections. This applies the bell's rule with the bell's inputs,
// built the same way, so both surfaces agree.

import { isAlertVisibleToTenant } from "@/lib/alerts/visibility"
import { getVdcVmidsByConnection } from "@/lib/alerts/vdcVmids"
import { getCurrentRbacInfraScope, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId, getTenantConnectionIds } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"

/**
 * The alerts of `alerts` the current tenant may see, in their order. Fails
 * closed: any error while building the context or judging an alert drops
 * every alert (the dashboard then shows its own alerts only, as when the
 * orchestrator is unreachable).
 */
export async function filterAlertsVisibleToTenant<T extends object>(alerts: T[]): Promise<T[]> {
  if (alerts.length === 0) return alerts

  try {
    const tenantConnectionIds = await getTenantConnectionIds()
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    const vdcScope = maskingScope(infra)
    const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : undefined
    const rbacScope = await getCurrentRbacInfraScope(PERMISSIONS.ALERTS_VIEW)
    const ctx = { tenantId, tenantConnectionIds, vdcScope, vdcVmids, infraKind: infra.kind, rbacScope }

    // isAlertVisibleToTenant is async: resolve every verdict, then filter.
    const visible = await Promise.all(alerts.map(a => isAlertVisibleToTenant(a as any, ctx)))

    return alerts.filter((_, i) => visible[i])
  } catch {
    return []
  }
}
