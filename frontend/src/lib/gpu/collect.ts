// Reads the GPU inventory of one Proxmox connection (#672, phase 1).
//
// Cost per connection: one /nodes, one /hardware/pci per online node, one
// /cluster/mapping/pci, one /cluster/resources and one config read per QEMU
// guest that sits on a node holding a display device (its /pending view, see
// guestConfigSource.ts). All per-node and per-guest reads go through the
// bounded pool of the inventory (PVEPROXY_CONCURRENCY), and the result is
// cached per connection for SNAPSHOT_TTL_MS, with the in-flight read shared
// between concurrent callers.
import { pveFetch } from "@/lib/proxmox/client"
import { mapWithConcurrency, PVEPROXY_CONCURRENCY } from "@/lib/inventory/concurrency"

import { pendingDeleteOf, readQemuConfig as defaultReadConfig, type ReadQemuConfig } from "./guestConfigSource"
import {
  collectNodeDevices,
  parsePciMappings,
  resolveAllocations,
  type GpuAllocation,
  type GpuDevice,
  type GuestForAllocation,
  type PvePciEntry,
} from "./inventory"

export const SNAPSHOT_TTL_MS = 60_000

export type GpuNodeState = {
  node: string
  online: boolean
  /** The PCI list of an online node could not be read. */
  error: string | null
}

export type ConnectionGpuSnapshot = {
  connId: string
  connectionName: string
  /** The connection itself could not be read (no node list). */
  error: string | null
  /** The resource mappings could not be read: no device shows its mappings. */
  mappingsError: string | null
  /** The guest list or some guest configs could not be read: allocations are partial. */
  guestsError: string | null
  nodes: GpuNodeState[]
  devices: GpuDevice[]
  allocations: GpuAllocation[]
  /** Number of VM configs read for this snapshot. */
  configReads: number
  generatedAt: string
}

type CacheEntry = { at: number; promise: Promise<ConnectionGpuSnapshot> }

const cache = new Map<string, CacheEntry>()

/** Test seam. */
export function resetGpuSnapshotCache(): void {
  cache.clear()
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export async function readConnectionGpus(
  connData: any,
  conn: { id: string; name: string },
  readConfig: ReadQemuConfig = defaultReadConfig,
): Promise<ConnectionGpuSnapshot> {
  const snapshot: ConnectionGpuSnapshot = {
    connId: conn.id,
    connectionName: conn.name,
    error: null,
    mappingsError: null,
    guestsError: null,
    nodes: [],
    devices: [],
    allocations: [],
    configReads: 0,
    generatedAt: new Date().toISOString(),
  }

  let nodes: any[]
  try {
    nodes = (await pveFetch<any[]>(connData, "/nodes")) || []
  } catch (e) {
    return { ...snapshot, error: errorText(e) }
  }

  const [mappingsRaw] = await Promise.allSettled([pveFetch<unknown>(connData, "/cluster/mapping/pci")])
  // PVE < 8.0 has no resource mappings and a token without Mapping.Audit gets
  // an empty list: neither fails the inventory, but a failed read is recorded
  // for the checks that must know which mappings cover a GPU.
  const mappings = parsePciMappings(mappingsRaw.status === "fulfilled" ? mappingsRaw.value : [])
  if (mappingsRaw.status === "rejected") snapshot.mappingsError = errorText(mappingsRaw.reason)

  const names = nodes.map((n) => String(n?.node ?? "")).filter(Boolean).sort((a, b) => a.localeCompare(b))
  const online = new Set(nodes.filter((n) => n?.status === "online").map((n) => String(n.node)))

  const perNode = await mapWithConcurrency(names, PVEPROXY_CONCURRENCY, async (node) => {
    if (!online.has(node)) return { state: { node, online: false, error: null }, devices: [] as GpuDevice[] }
    try {
      const pci = await pveFetch<PvePciEntry[]>(connData, `/nodes/${encodeURIComponent(node)}/hardware/pci`)
      return {
        state: { node, online: true, error: null },
        devices: collectNodeDevices(conn.id, node, Array.isArray(pci) ? pci : [], mappings),
      }
    } catch (e) {
      return { state: { node, online: true, error: errorText(e) }, devices: [] as GpuDevice[] }
    }
  })

  snapshot.nodes = perNode.map((p) => p.state)
  snapshot.devices = perNode.flatMap((p) => p.devices)

  // A guest can only hold a device of its own node: no display device on a
  // node means no config worth reading there.
  const nodesWithDevices = new Set(snapshot.devices.map((d) => d.node))
  if (nodesWithDevices.size === 0) return snapshot

  let resources: any[] = []
  try {
    resources = (await pveFetch<any[]>(connData, "/cluster/resources?type=vm")) || []
  } catch (e) {
    return { ...snapshot, guestsError: errorText(e) }
  }

  const candidates = resources.filter(
    (r) => r?.type === "qemu" && r?.vmid !== undefined && nodesWithDevices.has(String(r.node)),
  )
  const guests: GuestForAllocation[] = await mapWithConcurrency(candidates, PVEPROXY_CONCURRENCY, async (r) => {
    const vmid = String(r.vmid)
    const node = String(r.node)
    const config = await readConfig(connData, node, vmid)
    return {
      vmid,
      node,
      name: r.name ? String(r.name) : `VM ${vmid}`,
      status: r.status ? String(r.status) : "unknown",
      template: r.template === 1 || r.template === true,
      pool: r.pool ? String(r.pool) : null,
      tags: r.tags ? String(r.tags).split(/[;,\s]+/).filter(Boolean) : [],
      uptime: Number.isFinite(Number(r.uptime)) ? Number(r.uptime) : null,
      config,
      pendingDelete: [...pendingDeleteOf(config)],
    }
  })
  snapshot.configReads = guests.length
  const unread = guests.filter((g) => g.config === null).length
  if (unread > 0) snapshot.guestsError = `${unread} guest config(s) unreadable`
  snapshot.allocations = resolveAllocations(conn.id, snapshot.devices, mappings, guests)
  return snapshot
}

/**
 * The cached snapshot of a connection. `refresh` drops the cached one first
 * (the Refresh button of the GPU views); otherwise concurrent callers share
 * the read in flight.
 */
export function getConnectionGpus(
  connData: any,
  conn: { id: string; name: string },
  opts: { refresh?: boolean; now?: number; readConfig?: ReadQemuConfig } = {},
): Promise<ConnectionGpuSnapshot> {
  const now = opts.now ?? Date.now()
  const hit = cache.get(conn.id)
  if (hit && !opts.refresh && now - hit.at < SNAPSHOT_TTL_MS) return hit.promise
  const promise = readConnectionGpus(connData, conn, opts.readConfig).catch((e) => {
    cache.delete(conn.id)
    throw e
  })
  cache.set(conn.id, { at: now, promise })
  return promise
}
