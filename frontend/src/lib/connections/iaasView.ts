// src/lib/connections/iaasView.ts
//
// What an IaaS tenant may read of a provider connection it reaches through
// its vDC. The tenant screens need the connection's name, the capacity of the
// nodes its vDC places guests on, the tag colours and its own pools: never
// the address of the cluster or its nodes, their certificates, SSH settings,
// the storage backends' servers and paths, nor anything sized to the whole
// cluster. Allow-lists on purpose, so a field PVE or ProxCenter adds later
// stays out until someone decides otherwise. Pure functions: the routes
// resolve the tenant scope (lib/tenant/iaasGuard) and call these.

import type { VdcScope } from "@/lib/vdc/scope"

type Row = Record<string, unknown>

const pick = (row: Row, keys: readonly string[]): Row => {
  const out: Row = {}
  for (const k of keys) if (row[k] !== undefined) out[k] = row[k]
  return out
}

const CONNECTION_FIELDS = ["id", "name", "type", "subType", "createdAt", "updatedAt"] as const

/** A connection row (list or detail) as an IaaS tenant sees it; Ceph is never visible to it. */
export function iaasConnectionView(row: Row): Row {
  return { ...pick(row, CONNECTION_FIELDS), hasCeph: false }
}

const NODE_FIELDS = [
  "node", "id", "type", "status", "hastate", "cpu", "maxcpu", "mem", "maxmem", "disk", "maxdisk", "uptime",
] as const

/**
 * A /nodes row: placement capacity and state (the VM wizards skip a node in
 * maintenance), no address, certificate, version, bridge list or SSH endpoint.
 */
export function iaasNodeView(row: Row): Row {
  return pick(row, NODE_FIELDS)
}

/** /nodes/{node}/status: the CPU topology the VM summary sizes its gauges with. */
export function iaasNodeStatusView(status: Row | null | undefined): Row {
  const cpuinfo = (status?.cpuinfo ?? {}) as Row
  return { cpuinfo: pick(cpuinfo, ["cpus", "cores", "sockets"]) }
}

/** Datacenter options: only the tag style the guest lists colour tags with. */
export function iaasClusterOptionsView(options: Row | null | undefined): Row {
  return options?.["tag-style"] !== undefined ? { "tag-style": options["tag-style"] } : {}
}

/** Storage backend addressing that is the provider's business, blanked for an IaaS tenant. */
const STORAGE_BACKEND_FIELDS = ["path", "server", "export", "monhost", "fingerprint"] as const

export function iaasStorageView(row: Row): Row {
  const out: Row = { ...row }
  for (const k of STORAGE_BACKEND_FIELDS) out[k] = null
  return out
}

/** The pools of the tenant's vDCs on this connection, nothing else. */
export function iaasPoolsView(pools: readonly Row[], scope: VdcScope, connectionId: string): Row[] {
  const allowed = scope.poolsByConnection.get(connectionId) ?? new Set<string>()
  return pools.filter(p => typeof p?.poolid === "string" && allowed.has(p.poolid))
}

/** Whether `node` is one of the vDC nodes of the tenant on this connection. */
export function iaasNodeAllowed(scope: VdcScope, connectionId: string, node: string): boolean {
  return scope.nodesByConnection.get(connectionId)?.has(node) ?? false
}

/**
 * Resource mappings (PCI/USB) narrowed to the tenant's vDC nodes. Each `map`
 * entry names a node and the host device (`node=pve1,path=0000:01:00.0,...`):
 * only the node part of the vDC nodes is kept, which is what the hardware
 * dialog reads to tell whether the mapping covers the guest's node. A mapping
 * with no entry on a vDC node is dropped.
 */
export function iaasMappingsView(mappings: readonly Row[], scope: VdcScope, connectionId: string): Row[] {
  const nodes = scope.nodesByConnection.get(connectionId) ?? new Set<string>()
  const out: Row[] = []
  for (const m of mappings) {
    const entries = Array.isArray(m?.map) ? (m.map as unknown[]) : []
    const kept = entries
      .map(e => (typeof e === "string" ? /(?:^|,)node=([^,]+)/.exec(e)?.[1] : undefined))
      .filter((n): n is string => !!n && nodes.has(n))
    if (kept.length === 0) continue
    out.push({ ...pick(m, ["id", "description", "checks", "errors", "error"]), map: [...new Set(kept)].map(n => `node=${n}`) })
  }
  return out
}

const SDN_ZONE_FIELDS = ["zone", "type", "state", "mtu", "alias", "digest"] as const

/**
 * An SDN zone of the tenant's own VNets (roadmap#81 already drops the other
 * zones): its name, type and state, without the VXLAN peer list (the node
 * addresses of every cluster the zone spans), the EVPN controller or the exit
 * nodes, nor the staged copy of them.
 */
export function iaasSdnZoneView(zone: Row): Row {
  return pick(zone, SDN_ZONE_FIELDS)
}

/** Addressing a provider cluster or node carries in the inventory: never sent to a vDC tenant. */
const INVENTORY_CLUSTER_HIDDEN = ["baseUrl", "hosts", "sshEnabled", "behindProxy", "insecureTLS"] as const
const INVENTORY_NODE_HIDDEN = ["ip", "ips", "ipVerified", "ssl_fingerprint", "sshAddress", "sshPort", "hostId"] as const

const omit = (row: Row, keys: readonly string[]): Row => {
  const out: Row = { ...row }
  for (const k of keys) delete out[k]
  return out
}

/**
 * An inventory cluster as a vDC tenant sees it. The inventory screens read
 * many presentation fields, so this one removes the addressing rather than
 * listing what stays; the location stays, the tenant's datacenter map shows it.
 */
export function iaasInventoryClusterView<T extends Row>(cluster: T): T {
  return omit(cluster, INVENTORY_CLUSTER_HIDDEN) as T
}

/** An inventory node as a vDC tenant sees it: no address, certificate or SSH endpoint. */
export function iaasInventoryNodeView<T extends Row>(node: T): T {
  return omit(node, INVENTORY_NODE_HIDDEN) as T
}
