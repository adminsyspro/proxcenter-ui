/**
 * Tenant-scoped visibility filter for orchestrator alerts.
 *
 * Three gates must pass for a vDC tenant:
 *
 * 1. Rule ownership — rule-bound alerts only show to the tenant that
 *    authored the rule. Built-in (no rule_id) alerts are provider-only.
 *
 * 2. Connection + node scope — the alert's resource must live on a
 *    connection (and node) reachable through the tenant's vDC.
 *
 * 3. Pool scope — in the typical MSP layout vDCs share nodes and isolate
 *    via PVE pools. Resolve the VM's pool from cached inventory and
 *    require it to be one of the vDC's pools. On cache miss we deny:
 *    showing a cross-tenant alert is worse than briefly hiding our own
 *    until inventory warms (~30s).
 *
 * Known limitation: this is post-firing visibility filtering. The Go
 * orchestrator still creates the alert and may emit notifications
 * (notify_email) on cross-tenant events — the only proper fix for that
 * is to make the orchestrator itself tenant-aware.
 */

import { DEFAULT_TENANT_ID } from "@/lib/tenant"
import { ruleVisibleToTenant } from "@/lib/alerts/ruleOwners"
import type { VdcScope } from "@/lib/vdc/scope"
import { resolveVmMeta, findVmMetaByVmid, type VmMeta } from "@/lib/cache/vmMetaCache"
import { isFlatRecordVisible, type RbacInfraScope } from "@/lib/rbac/infraScope"

export interface AlertVisibilityCtx {
  tenantId: string
  tenantConnectionIds: Set<string>
  vdcScope: VdcScope | null
  /** Tenant infrastructure kind. Drives built-in + connection-less gates
   *  (vdcScope===null is no longer a valid "is provider" proxy: maskingScope
   *  returns null for BOTH provider and msp). */
  infraKind: 'provider' | 'iaas' | 'msp'
  /**
   * connectionId → Set<vmid>: the tenant's vDC pool members, fetched
   * directly from PVE (see `getVdcVmidsByConnection`). When provided,
   * this is the authoritative pool-membership check and the inventory
   * cache fallback is skipped.
   */
  vdcVmids?: Map<string, Set<string>>
  /**
   * The CALLER's RBAC infra scope (role grants), ANDed with the tenant gates:
   * a connection / node / vm scoped user only sees alerts attributable to
   * their grants. Absent or null = unrestricted (issue #525).
   */
  rbacScope?: RbacInfraScope | null
}

interface OrchestratorAlertLike {
  rule_id?: string
  connection_id?: string
  resource_type?: string
  resource_id?: number | string
  resource?: string
  node?: string
  /**
   * Set on event-based alerts: a Proxmox UPID string of the form
   * `UPID:<node>:<pid>:<starttime>:<seq>:<type>:<vmid>:<user>:`. We parse
   * it because the orchestrator hard-codes `resource_type='event'` and
   * `resource_id=0` for event alerts, leaving no other way to map back
   * to the VM that triggered the rule.
   */
  event_id?: string
}

/**
 * Resource types that describe cluster-wide infrastructure and must never
 * reach a vDC-scoped tenant, whoever owns the rule.
 *
 * `osd` (Ceph OSD latency) and `replication` (DR replication job RPO /
 * failure) belong here for the same reason as `node` and `storage`: an OSD
 * is shared Ceph hardware and a replication job spans a whole cluster, so
 * neither maps to a single tenant's VM. Listing them here also fixes the
 * denial reason: without it they fall through to the VM-identification
 * gate and get denied as `cannot_identify_vm`, which is misleading when
 * debugging visibility.
 */
const SYSTEM_RESOURCE_TYPES = new Set(['node', 'storage', 'license', 'cluster', 'system', 'osd', 'replication'])

const DEBUG = process.env.DEBUG_ALERTS_VISIBILITY === '1'

function debugDeny(alert: OrchestratorAlertLike, reason: string, extra?: Record<string, unknown>): false {
  if (DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[alerts/visibility] DENY', {
      alert_id: (alert as any).id,
      rule_id: alert.rule_id,
      event_id: alert.event_id,
      reason,
      ...extra,
    })
  }
  return false
}

export async function isAlertVisibleToTenant(
  alert: OrchestratorAlertLike,
  ctx: AlertVisibilityCtx,
): Promise<boolean> {
  const { tenantId, tenantConnectionIds, vdcScope, infraKind } = ctx

  // Gate 0: the caller's RBAC infra scope. Sync and cheap, so it runs before
  // the rule-ownership lookup; an out-of-scope alert never costs a query.
  if (ctx.rbacScope && !isAlertInRbacScope(alert, ctx.rbacScope, tenantId)) {
    return debugDeny(alert, 'rbac_infra_scope', { connection_id: alert.connection_id })
  }

  // Gate 1: rule visibility.
  if (alert.rule_id) {
    if (!(await ruleVisibleToTenant(alert.rule_id, tenantId))) return debugDeny(alert, 'rule_not_owned')
  } else {
    // Built-in (no-rule) orchestrator alert (storage / node / license /
    // cluster / system thresholds). Provider sees all. An MSP tenant sees
    // built-in alerts on its OWNED connections (gate 2 enforces ownership);
    // a built-in alert with no connection_id is cluster-wide and provider-only.
    // IaaS tenants never see built-in alerts.
    if (infraKind === 'provider') {
      // allowed
    } else if (infraKind === 'msp' && alert.connection_id) {
      // allowed; gate 2 below scopes to owned connections
    } else {
      return debugDeny(alert, 'builtin_alert_not_visible')
    }
  }

  // Gate 2: connection + node scope.
  if (!alert.connection_id) {
    // Cluster-wide alert with no connection. Provider only.
    return infraKind === 'provider' ? true : debugDeny(alert, 'no_connection_id_non_provider')
  }
  if (!tenantConnectionIds.has(alert.connection_id)) return debugDeny(alert, 'connection_not_reachable', { connection_id: alert.connection_id })
  if (!vdcScope) return true

  const rt = String(alert.resource_type || '').toLowerCase()
  if (SYSTEM_RESOURCE_TYPES.has(rt)) return debugDeny(alert, 'system_resource_type', { rt })

  const allowedNodes = vdcScope.nodesByConnection.get(alert.connection_id)
  if (allowedNodes && alert.node && !allowedNodes.has(alert.node)) return debugDeny(alert, 'node_not_in_scope', { node: alert.node })

  // Gate 3: pool scope.
  const ident = identifyAlertVm(alert)
  if (!ident) return debugDeny(alert, 'cannot_identify_vm', { resource_type: alert.resource_type, resource_id: alert.resource_id })

  // Preferred path: live vDC vmid set fetched from PVE pools (see
  // `getVdcVmidsByConnection`). Bypasses the inventory cache entirely.
  if (ctx.vdcVmids) {
    const allowedVmids = ctx.vdcVmids.get(alert.connection_id)
    if (!allowedVmids) return debugDeny(alert, 'no_vmids_for_connection', { connection_id: alert.connection_id })
    if (!allowedVmids.has(ident.vmid)) {
      return debugDeny(alert, 'vmid_not_in_vdc', { ident, allowedVmids: [...allowedVmids] })
    }
    return true
  }

  // Fallback path: in-memory inventory cache (works only when warm).
  const allowedPools = vdcScope.poolsByConnection.get(alert.connection_id)
  if (!allowedPools || allowedPools.size === 0) return debugDeny(alert, 'no_pools_for_connection', { connection_id: alert.connection_id })

  const meta = resolveVmPoolMeta(alert.connection_id, ident.node, ident.type ?? rt, ident.vmid, tenantId)
  if (!meta) {
    return debugDeny(alert, 'vm_meta_unresolved_cache_cold_or_missing', { ident, allowedPools: [...allowedPools] })
  }
  if (!meta.pool) {
    return debugDeny(alert, 'vm_has_no_pool', { ident, vm_pool: meta.pool, allowedPools: [...allowedPools] })
  }
  if (!allowedPools.has(meta.pool)) {
    return debugDeny(alert, 'vm_pool_not_in_vdc', { ident, vm_pool: meta.pool, allowedPools: [...allowedPools] })
  }

  return true
}

interface VmIdent {
  node?: string
  type?: string
  vmid: string
}

/** Parse a Proxmox UPID and extract `{ node, type, vmid }`. */
function parseUpid(upid: string): VmIdent | null {
  // UPID:<node>:<pid>:<starttime>:<seq>:<type>:<vmid>:<user>:
  const parts = upid.split(':')
  if (parts[0] !== 'UPID' || parts.length < 8) return null
  const vmid = parts[6]?.trim()
  if (!vmid) return null
  return {
    node: parts[1] || undefined,
    type: mapUpidTypeToInventoryType(parts[5] || ''),
    vmid,
  }
}

/** Map a UPID worker type (qmstart, vzstop, …) to the inventory type. */
function mapUpidTypeToInventoryType(t: string): string | undefined {
  if (t.startsWith('qm')) return 'qemu'
  if (t.startsWith('vz')) return 'lxc'
  return undefined
}

/**
 * Extract the VM identifier the alert is about. Tries the UPID first
 * (event alerts), then falls back to `resource_id` (threshold alerts).
 */
function identifyAlertVm(alert: OrchestratorAlertLike): VmIdent | null {
  if (alert.event_id) {
    const fromUpid = parseUpid(alert.event_id)
    if (fromUpid) return fromUpid
  }
  if (alert.resource_id != null && String(alert.resource_id) !== '0') {
    return { node: alert.node, vmid: String(alert.resource_id) }
  }
  return null
}

/**
 * Node an alert can be attributed to: the explicit field when present, the
 * UPID of an event alert, a node alert's `resource` (the orchestrator stores
 * the node name there), else the hosting node of the VM from the warm
 * inventory index. Undefined when nothing resolves, cold cache included.
 */
function resolveAlertNode(alert: OrchestratorAlertLike, tenantId: string): string | undefined {
  if (alert.node) return alert.node
  if (alert.event_id) {
    const node = parseUpid(alert.event_id)?.node
    if (node) return node
  }
  if (String(alert.resource_type || '').toLowerCase() === 'node') return alert.resource || undefined
  const ident = identifyAlertVm(alert)
  if (!ident || !alert.connection_id) return undefined
  const meta =
    findVmMetaByVmid(alert.connection_id, ident.vmid, DEFAULT_TENANT_ID) ??
    findVmMetaByVmid(alert.connection_id, ident.vmid, tenantId)
  return meta?.node
}

/**
 * RBAC infra-scope gate for one alert (issue #525), shared by every alert
 * route through AlertVisibilityCtx.rbacScope and by the dashboard merge.
 * Connection and guest-derived verdicts never touch the inventory index;
 * node attribution is only attempted when a node scope applies to the
 * alert's connection.
 */
export function isAlertInRbacScope(
  alert: OrchestratorAlertLike,
  scope: RbacInfraScope | null,
  tenantId: string,
): boolean {
  if (scope === null) return true
  const connId = alert.connection_id
  if (!connId || scope.fullConnections.has(connId) || scope.guestDerived) {
    return isFlatRecordVisible(scope, { connId })
  }
  // nodesByConnection carries the node of every node AND vm grant, so a
  // connection missing from it holds no grant at all.
  if (!scope.nodesByConnection.has(connId)) return false
  const rt = String(alert.resource_type || '').toLowerCase()
  // Cluster-wide alerts (storage, license, quorum, OSD, replication) are facts
  // about the granted connection; anything else happened on a node.
  const nodeBound = rt === 'node' || !SYSTEM_RESOURCE_TYPES.has(rt)
  return isFlatRecordVisible(scope, {
    connId,
    node: resolveAlertNode(alert, tenantId),
    vmid: identifyAlertVm(alert)?.vmid,
    nodeBound,
  })
}

/**
 * Try to resolve the VM's metadata from cached inventory. We try the
 * provider (default-tenant) cache first because it has every VM on the
 * cluster; the current tenant's cache only carries their own vDC.
 *
 * The orchestrator's alert payload does not include a `node` field, so
 * we fall back to a vmid-only search when `node` is absent. When the
 * `resource_type` is the generic 'vm' we try qemu then lxc.
 */
function resolveVmPoolMeta(
  connectionId: string,
  node: string | undefined,
  resourceType: string,
  vmid: number | string,
  tenantId: string,
): VmMeta | null {
  if (node) {
    const types = resourceType === 'vm' ? ['qemu', 'lxc'] : [resourceType]
    for (const t of types) {
      const rid = `${connectionId}:${node}:${t}:${vmid}`
      const meta = resolveVmMeta(rid, DEFAULT_TENANT_ID) ?? resolveVmMeta(rid, tenantId)
      if (meta) return meta
    }
  }
  // Cross-node lookup by vmid alone. Necessary for orchestrator alerts.
  return (
    findVmMetaByVmid(connectionId, vmid, DEFAULT_TENANT_ID) ??
    findVmMetaByVmid(connectionId, vmid, tenantId)
  )
}
