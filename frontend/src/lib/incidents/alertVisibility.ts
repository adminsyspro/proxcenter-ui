// src/lib/incidents/alertVisibility.ts
//
// The alerts an incident shows or accepts must pass the same gate as the
// alert routes (isAlertVisibleToTenant, with the caller's RBAC perimeter).
// The register is Default-tenant only, so in practice only the RBAC perimeter
// narrows. Like the acknowledge route, the object view ignores the vDC view
// context.

import { NextResponse } from 'next/server'

import { isAlertVisibleToTenant } from '@/lib/alerts/visibility'
import { getVdcVmidsByConnection } from '@/lib/alerts/vdcVmids'
import { alertsApi } from '@/lib/orchestrator/client'
import { getCurrentRbacInfraScope } from '@/lib/rbac'
import { getCurrentTenantId, getTenantConnectionIds } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'

import { upstreamStatus } from '@/lib/availability/orchestrator'

type Alert = Parameters<typeof isAlertVisibleToTenant>[0]
type Permission = Parameters<typeof getCurrentRbacInfraScope>[0]

/** A predicate on an alert, built once per request for the permission given. */
export async function visibleAlertFilter(permission: Permission): Promise<(alert: Alert) => Promise<boolean>> {
  const tenantId = await getCurrentTenantId()
  const tenantConnectionIds = await getTenantConnectionIds()
  const infra = await getTenantInfrastructureScope(tenantId, { ignoreVdcContext: true })
  const vdcScope = maskingScope(infra)
  const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId, { ignoreVdcContext: true }) : undefined
  const rbacScope = await getCurrentRbacInfraScope(permission)
  const ctx = { tenantId, tenantConnectionIds, vdcScope, vdcVmids, infraKind: infra.kind, rbacScope }
  return alert => isAlertVisibleToTenant(alert, ctx)
}

/** The alerts of a list that the caller may see. */
export async function filterVisibleAlerts<T>(alerts: T[], isVisible: (alert: Alert) => Promise<boolean>): Promise<T[]> {
  const kept = await Promise.all(alerts.map(a => isVisible(a as unknown as Alert)))
  return alerts.filter((_, i) => kept[i])
}

/**
 * Null when the alert may be used by the caller, a 404 not_found when it
 * exists but lies outside the caller's perimeter. An alert the orchestrator
 * does not know passes: the register answers it itself (INCIDENT_NOT_FOUND).
 */
export async function refuseInvisibleAlert(alertId: string, permission: Permission): Promise<NextResponse | null> {
  let alert: Alert
  try {
    alert = (await alertsApi.getAlert(alertId)).data as Alert
  } catch (e) {
    if (upstreamStatus(e) === 404) return null
    throw e
  }
  const isVisible = await visibleAlertFilter(permission)
  return (await isVisible(alert)) ? null : NextResponse.json({ error: 'not_found' }, { status: 404 })
}

type Visible = (alert: Alert) => Promise<boolean>

/** A view (or a summary line of a list) with only the alerts the caller may see, the count recomputed. */
async function narrow<T extends { alerts?: unknown[]; alert_count?: number }>(view: T, isVisible: Visible): Promise<T> {
  if (!view.alerts) return view
  const alerts = await filterVisibleAlerts(view.alerts, isVisible)
  return { ...view, alerts, alert_count: alerts.length }
}

/** Every outgoing incident view goes through here: the register holds all the alerts, the caller sees its perimeter. */
export async function visibleView<T extends { alerts?: unknown[]; alert_count?: number }>(view: T, permission: Permission): Promise<T> {
  return narrow(view, await visibleAlertFilter(permission))
}

/** The same for a list, the perimeter resolved once. */
export async function visibleViews<T extends { alerts?: unknown[]; alert_count?: number }>(views: T[], permission: Permission): Promise<T[]> {
  const isVisible = await visibleAlertFilter(permission)
  return Promise.all(views.map(v => narrow(v, isVisible)))
}

/**
 * An incident always holds at least one alert, so a view left without any
 * visible alert lies wholly outside the caller's perimeter: it is hidden
 * (absent from a list, a 404 anywhere else) rather than shown with its
 * title, cause, impact and journal.
 */
function hasNoVisibleAlert(view: { alerts?: unknown[] }): boolean {
  return Array.isArray(view.alerts) && view.alerts.length === 0
}

/** The view narrowed to the caller's perimeter, or null when none of its alerts is visible. */
export async function visibleIncident<T extends { alerts?: unknown[]; alert_count?: number }>(view: T, permission: Permission): Promise<T | null> {
  const narrowed = await visibleView(view, permission)

  return hasNoVisibleAlert(narrowed) ? null : narrowed
}

/** The views of a list that have a visible alert, narrowed, and how many were left out. */
export async function visibleIncidents<T extends { alerts?: unknown[]; alert_count?: number }>(views: T[], permission: Permission): Promise<{ views: T[]; hidden: number }> {
  const narrowed = (await visibleViews(views, permission)).filter(v => !hasNoVisibleAlert(v))

  return { views: narrowed, hidden: views.length - narrowed.length }
}

/** The JSON answer of an incident view: the view narrowed to the perimeter, a 404 not_found when nothing of it is visible. */
export async function incidentViewResponse<T extends { alerts?: unknown[]; alert_count?: number }>(view: T, permission: Permission, init?: ResponseInit): Promise<NextResponse> {
  const visible = await visibleIncident(view, permission)

  return visible ? NextResponse.json(visible, init) : NextResponse.json({ error: 'not_found' }, { status: 404 })
}

interface OutageLike {
  connection_id: string
  kind: string
  node: string
  vmid: number
}

/**
 * The outages whose object is described by one of the alerts given, with the
 * orchestrator's correspondence: node_down is the node named by the resource,
 * vm_down the guest of the resource id, cluster_quorum the cluster, each on
 * the same connection.
 */
export function outagesOfAlerts<T extends OutageLike>(outages: T[], alerts: { type?: string; connection_id?: string; resource?: string; resource_id?: number }[]): T[] {
  const wanted = new Set<string>()
  for (const a of alerts) {
    if (a.type === 'node_down') wanted.add(`${a.connection_id}|node|${a.resource}|0`)
    else if (a.type === 'vm_down') wanted.add(`${a.connection_id}|guest||${a.resource_id}`)
    else if (a.type === 'cluster_quorum') wanted.add(`${a.connection_id}|cluster||0`)
  }
  return outages.filter(o => wanted.has(`${o.connection_id}|${o.kind}|${o.kind === 'node' ? o.node : ''}|${o.kind === 'guest' ? o.vmid : 0}`))
}
