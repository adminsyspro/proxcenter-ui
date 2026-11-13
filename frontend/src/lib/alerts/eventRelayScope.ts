// The Events page relays the feed it reads (GET /api/v1/events) to the
// orchestrator's event-rule engine (POST /api/v1/orchestrator/alerts/events).
// The body comes from the browser, so the server keeps only the events the
// caller could have read on that feed, with the same gates (roadmap#224):
// - the connections of the tenant (a vDC tenant: the clusters its vDCs sit on);
// - a vDC tenant: tasks on its vDC nodes AND on its pool's guests, no cluster
//   log (scopeConnectionTasks, the Events feed and the task archive's filter);
// - the caller's connection.view RBAC perimeter (node or guest grants);
// - an event without a connection only from the provider tenant with an
//   unrestricted perimeter;
// - its id tied to what was checked (a task's UPID names its node, a log id
//   its connection): the orchestrator skips an id it has already seen, for
//   every tenant, so a forged id must not reach outside the perimeter.
// Events outside that perimeter are dropped, the others go through.

import { getCurrentRbacInfraScope, PERMISSIONS } from "@/lib/rbac"
import { filterCandidateConnections, isFlatRecordVisible, type RbacInfraScope } from "@/lib/rbac/infraScope"
import { DEFAULT_TENANT_ID, getCurrentTenantId, getTenantConnectionIds } from "@/lib/tenant"
import { getTenantInfrastructureScope, maskingScope } from "@/lib/tenant/infraScope"
import { scopeConnectionTasks } from "@/lib/tasks/scopeTasks"
import type { VdcScope } from "@/lib/vdc/scope"

import { getVdcVmidsByConnection } from "./vdcVmids"

export interface RelayScope {
  tenantId: string
  connectionIds: Set<string>
  /** The vDC perimeter of an IaaS tenant, null otherwise. */
  vdcScope: VdcScope | null
  vdcVmids: Map<string, Set<string>> | null
  rbacScope: RbacInfraScope | null
}

type RelayedEvent = Record<string, unknown> & { id?: unknown; connectionId?: unknown; category?: unknown; node?: unknown; entity?: unknown }

const text = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined)

/** Whether the caller could have read this event on GET /api/v1/events. */
export function isRelayedEventVisible(event: unknown, s: RelayScope): boolean {
  if (!event || typeof event !== "object" || Array.isArray(event)) return false
  const e = event as RelayedEvent
  const connId = text(e.connectionId)
  if (e.connectionId !== undefined && e.connectionId !== null && !connId) return false
  if (!connId) return s.tenantId === DEFAULT_TENANT_ID && s.rbacScope === null
  if (!s.connectionIds.has(connId)) return false
  if (filterCandidateConnections([{ id: connId }], s.rbacScope).length === 0) return false
  return isRecordVisible(e, connId, s)
}

/** The task or log line of one of the caller's connections, as the feed filters it. */
function isRecordVisible(e: RelayedEvent, connId: string, s: RelayScope): boolean {
  const node = text(e.node)
  const id = text(e.id) ?? ""
  const entity = text(e.entity)
  if (e.category === "task") {
    // The feed sets entity to the task's guest id, or to its node when the
    // task has none: only a guest id counts as one.
    const guest = entity !== undefined && entity !== node ? entity : undefined
    return !!node && isFeedUpid(id, node, guest) && isTaskVisible(connId, node, guest, s)
  }
  if (e.category === "log") {
    // "<connection>-log-<uid>", about its node. Cluster syslog lines carry
    // no guest: never in a vDC tenant's feed.
    return isFeedLogId(id, connId) && (entity === undefined || entity === node)
      && !s.vdcScope && isFlatRecordVisible(s.rbacScope, { connId, node })
  }
  return false
}

/**
 * The feed's task id is the task's UPID, "UPID:<node>:<pid>:<pstart>:<starttime>:<type>:<id>:<user>:":
 * its node and its id field must be the ones checked, alert visibility reads
 * the guest from that field.
 */
function isFeedUpid(id: string, node: string, guest: string | undefined): boolean {
  const parts = id.split(":")
  return parts.length === 9 && parts[0] === "UPID" && parts[1] === node && parts[8] === "" && parts[6].trim() === (guest ?? "")
}

function isFeedLogId(id: string, connId: string): boolean {
  const prefix = `${connId}-log-`
  return id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length))
}

function isTaskVisible(connId: string, node: string, guest: string | undefined, s: RelayScope): boolean {
  const task = { node, id: guest }
  // A vDC tenant's perimeter is its nodes and its pool's guests; a vDC
  // binding the lookups did not resolve leaves nothing visible.
  const vdc = s.vdcScope
  const allowedNodes = vdc ? vdc.nodesByConnection.get(connId) ?? new Set<string>() : undefined
  const allowedVmids = vdc ? s.vdcVmids?.get(connId) ?? new Set<string>() : undefined
  return scopeConnectionTasks([task], { connId, allowedNodes, allowedVmids, rbacScope: s.rbacScope }).length === 1
}

/** The caller's perimeter on the Events feed, resolved as GET /api/v1/events does. */
export async function resolveRelayScope(): Promise<RelayScope> {
  const tenantId = await getCurrentTenantId()
  const infra = await getTenantInfrastructureScope(tenantId)
  const vdcScope = maskingScope(infra)
  // The connections the feed reads: every one for the provider, an MSP's own
  // clusters, the clusters a vDC tenant's vDCs sit on.
  const own = infra.kind === "msp" ? infra.connectionIds : vdcScope?.connectionIds
  const [connectionIds, vdcVmids, rbacScope] = await Promise.all([
    own ? Promise.resolve(new Set(own)) : getTenantConnectionIds(),
    vdcScope ? getVdcVmidsByConnection(tenantId) : Promise.resolve(null),
    getCurrentRbacInfraScope(PERMISSIONS.CONNECTION_VIEW),
  ])
  return { tenantId, connectionIds, vdcScope, vdcVmids, rbacScope }
}

/**
 * The fields of the orchestrator's ProxmoxEvent. Go's JSON decoder matches
 * keys whatever their case and keeps the last duplicate, so an event is
 * forwarded rebuilt from these exact keys, string values only: a second
 * spelling of a checked field (CONNECTIONID, Node...) never reaches it.
 */
const RELAY_FIELDS = [
  "id", "ts", "level", "category", "type", "typeLabel", "entity", "entityName",
  "node", "user", "status", "message", "details", "connectionId", "connectionName",
] as const

function relayCopy(event: object): Record<string, string> {
  const e = event as Record<string, unknown>
  const out: Record<string, string> = {}
  for (const k of RELAY_FIELDS) {
    const v = e[k]
    if (typeof v === "string") out[k] = v
  }
  return out
}

/** The events of `events` the caller could have read on the Events feed, as forwarded to the orchestrator. */
export async function scopeRelayedEvents(events: unknown[]): Promise<Record<string, string>[]> {
  if (events.length === 0) return []
  const scope = await resolveRelayScope()
  return events.filter(e => isRelayedEventVisible(e, scope)).map(e => relayCopy(e as object))
}
