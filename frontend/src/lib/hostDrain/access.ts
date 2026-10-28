import { buildNodeResourceId, buildVmResourceId, checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"

interface DrainRecord {
  connection_id?: string
  node?: string
  guests?: { source_node?: string }[]
}

/**
 * The nodes a drain acts on: its node, or for a selection of guests (#1218),
 * which has none, every node one of its guests leaves.
 */
export function drainNodes(d: DrainRecord): string[] {
  if (d.node) return [d.node]

  return [...new Set((d.guests || []).map(g => g?.source_node).filter((n): n is string => !!n))]
}

/**
 * Whether the caller holds `permission` on every node the drain acts on. A
 * drain with no node at all is refused: there is nothing to check it against.
 */
export async function canActOnDrain(d: DrainRecord, permission: string): Promise<boolean> {
  const nodes = drainNodes(d)
  if (!d.connection_id || nodes.length === 0) return false
  const verdicts = await Promise.all(nodes.map(n => checkPermission(permission, "node", buildNodeResourceId(d.connection_id as string, n))))

  return verdicts.every(denied => !denied)
}

/**
 * The drains whose node the caller may view (#248). A drain names every guest
 * of its node, so listing it needs the same right as reading it on its own:
 * the list routes and the Task Center apply this on top of the cluster check.
 * A selection needs that right on every node its guests leave.
 */
export async function filterViewableDrains<T extends DrainRecord>(drains: T[]): Promise<T[]> {
  const verdicts = await Promise.all(drains.map(async d => {
    // A drain with no node to check was already settled by the cluster
    // check (provider only).
    if (!d.connection_id || drainNodes(d).length === 0) return true

    return canActOnDrain(d, PERMISSIONS.NODE_VIEW)
  }))

  return drains.filter((_, i) => verdicts[i])
}

/**
 * A drain as the browser may see it: the orchestrator already strips the SSH
 * access it was given (and never stores it), this drops it again on the way
 * out so a regression there could not expose it (#248).
 */
export function publicDrain<T>(drain: T): T {
  if (!drain || typeof drain !== "object") return drain
  const d = drain as Record<string, any>
  if (!d.config || typeof d.config !== "object") return drain
  const { ssh_credentials: _creds, ssh_overrides: _overrides, ...config } = d.config

  return { ...d, config } as T
}

export class DrainTargetDenied extends Error {}

/** A row of /cluster/resources, as much of it as the drain checks need. */
export interface DrainClusterResource {
  type?: string
  node?: string
  vmid?: number
  status?: string
  template?: number
  hastate?: string
}

/**
 * The cluster as Proxmox reports it, for restrictDrainTargets. A failure
 * throws: no drain is checked against a partial view.
 */
export async function drainCluster(connectionId: string): Promise<DrainClusterResource[]> {
  const conn = await getConnectionById(connectionId)
  const rows = await pveFetch<DrainClusterResource[]>(conn, "/cluster/resources")
  if (!Array.isArray(rows)) throw new Error("Could not read the cluster resources")

  return rows
}

/** Whether Proxmox HA places the guest (an "ignored" resource is left alone). */
const haManaged = (r: DrainClusterResource) => !!r.hastate && r.hastate !== "ignored"

/**
 * What a drain may do for the caller (#248), checked against the cluster as
 * Proxmox reports it (`/cluster/resources`), never against ProxCenter's own
 * host records, which may miss a node:
 * - every node a guest lands on needs the right to manage it: a target the
 *   operator imposed (for all guests or one by one) that the caller does not
 *   manage is refused, and in automatic placement the nodes it does not
 *   manage are excluded;
 * - every guest the drain migrates itself needs the right to migrate it, as
 *   when the guests were migrated one by one. The HA guests of a node entering
 *   maintenance are moved by Proxmox HA, under the right to manage the node,
 *   as before; the guests left on the node are not moved.
 * A selection of guests (#1218) has no source node (`sourceNode` is empty):
 * its guests are the selected ones wherever they run, and any node may
 * receive them, under the same two rights.
 * Returns the config with the exclusions merged in.
 */
export async function restrictDrainTargets<C extends {
  target_node?: string
  exclude_nodes?: string[]
  guest_targets?: Record<string, string>
  keep_vmids?: number[]
  include_stopped?: boolean
  enter_maintenance?: boolean
  vmids?: number[]
}>(
  cluster: DrainClusterResource[],
  connectionId: string,
  sourceNode: string,
  config: C,
): Promise<C> {
  const nodes = [...new Set(cluster.filter(r => r.type === "node" && r.node).map(r => r.node as string))].filter(n => n !== sourceNode)
  const managed = await Promise.all(nodes.map(async n =>
    !(await checkPermission(PERMISSIONS.NODE_MANAGE, "node", buildNodeResourceId(connectionId, n)))))
  const denied = nodes.filter((_, i) => !managed[i])

  // Every target the operator imposed, for all guests or one by one.
  const imposed = [...new Set([config.target_node, ...Object.values(config.guest_targets || {})].filter((n): n is string => !!n))]
  for (const target of imposed) {
    const allowed = !(await checkPermission(PERMISSIONS.NODE_MANAGE, "node", buildNodeResourceId(connectionId, target)))
    if (!allowed) throw new DrainTargetDenied(`You cannot manage the target node ${target}`)
  }

  // Every guest the drain itself would migrate. A selection is checked whole,
  // templates and stopped guests included: the plan names every selected
  // guest, so one the caller may not migrate, or that is not in the cluster,
  // is refused with the same words before anything reaches the orchestrator.
  const selected = config.vmids?.length ? new Set(config.vmids) : null
  const isGuest = (r: DrainClusterResource) => (r.type === "qemu" || r.type === "lxc") && !!r.node && r.vmid !== undefined
  let checked: DrainClusterResource[]
  let unknown: number[] = []
  if (selected) {
    checked = cluster.filter(r => isGuest(r) && selected.has(r.vmid as number))
    const known = new Set(checked.map(r => r.vmid))
    unknown = [...selected].filter(vmid => !known.has(vmid))
  } else {
    const kept = new Set(config.enter_maintenance ? [] : (config.keep_vmids || []))
    checked = cluster.filter(r =>
      isGuest(r) && r.node === sourceNode && r.template !== 1 &&
      !kept.has(r.vmid as number) &&
      (r.status === "running" || config.include_stopped !== false) &&
      !(config.enter_maintenance && r.status === "running" && haManaged(r)))
  }
  const migratable = await Promise.all(checked.map(async r =>
    !(await checkPermission(PERMISSIONS.VM_MIGRATE, "vm", buildVmResourceId(connectionId, r.node as string, r.type as string, String(r.vmid))))))
  const refused = [...unknown, ...checked.filter((_, i) => !migratable[i]).map(r => r.vmid)]
  if (refused.length > 0) throw new DrainTargetDenied(`You cannot migrate guest(s) ${refused.join(", ")}`)

  if (denied.length === 0) return config

  return { ...config, exclude_nodes: [...new Set([...(config.exclude_nodes || []), ...denied])] }
}
