/**
 * Plan how a scheduled backup job should be executed immediately ("Run now").
 *
 * Proxmox has no "run job by id" API endpoint: an immediate run must POST to
 * `/nodes/{node}/vzdump`, and vzdump is strictly node-local (it only backs up
 * guests that live on the node it runs on). The scheduler normally executes a
 * job on every node, each backing up its local guests matching the selection.
 *
 * The old "Run now" implementation just picked `nodes[0]` (the first node
 * returned by `/nodes`, i.e. alphabetical) whenever the job was not pinned to a
 * node. When the selected guest lived on a different node, vzdump ran on the
 * wrong node, backed up nothing, and surfaced neither error nor success — the
 * "clicking Start does nothing" report in issue #537.
 *
 * This planner resolves the node(s) that actually host the job's selection and
 * returns one dispatch entry per node, mirroring what the scheduler does:
 *   - pinned node        -> a single entry on that node, selection as configured
 *   - all guests         -> one entry per ONLINE node (each backs up its locals)
 *   - explicit vmid list -> group the vmids by their current node
 *   - pool               -> group the pool's member vmids by their current node
 *
 * vmids that cannot be resolved (unknown, or on an offline node) are returned
 * in `unresolved` so the caller can decide how to surface them.
 */

/** One VM's current location, from `/cluster/resources?type=vm`. */
export interface VmLocation {
  vmid: number
  node: string
  status?: string
}

/** A single vzdump invocation to issue for an immediate run. */
export interface RunDispatchEntry {
  node: string
  /** vzdump selection params for THIS node (all/exclude or a vmid subset). */
  selection: Record<string, string>
}

export interface PlanRunInput {
  /** Raw job object from `/cluster/backup/{id}`. */
  job: {
    node?: string
    all?: number | boolean
    vmid?: string | number
    pool?: string
    exclude?: string
  }
  /** All VM locations on the cluster (`/cluster/resources?type=vm`). */
  vmLocations: VmLocation[]
  /** Node names that are currently online. */
  onlineNodes: string[]
  /** For pool selection: the pool's member vmids (`/pools/{pool}`). */
  poolVmids?: number[]
}

export interface RunDispatchPlan {
  entries: RunDispatchEntry[]
  /** vmids that could not be placed on an online node. */
  unresolved: number[]
}

/** Parse a PVE comma list of vmids ("100,101") into numbers. */
function parseVmidList(raw: string | number | undefined): number[] {
  if (raw === undefined || raw === null || raw === '') return []
  return String(raw)
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
}

/** The selection params for a job run on the node it is pinned to. */
function pinnedSelection(job: PlanRunInput['job']): Record<string, string> {
  if (job.all) {
    return job.exclude ? { all: '1', exclude: job.exclude } : { all: '1' }
  }
  if (job.vmid !== undefined && job.vmid !== '') {
    return { vmid: String(job.vmid) }
  }
  if (job.pool) {
    return { pool: job.pool }
  }
  return {}
}

/** Group a set of vmids by the online node that currently hosts each one. */
function groupVmidsByNode(
  vmids: number[],
  vmLocations: VmLocation[],
  onlineNodes: string[],
): { byNode: Map<string, number[]>; unresolved: number[] } {
  const location = new Map<number, string>()
  for (const vm of vmLocations) location.set(vm.vmid, vm.node)

  const online = new Set(onlineNodes)
  const byNode = new Map<string, number[]>()
  const unresolved: number[] = []

  for (const vmid of vmids) {
    const node = location.get(vmid)
    if (!node || !online.has(node)) {
      unresolved.push(vmid)
      continue
    }
    const list = byNode.get(node) ?? []
    list.push(vmid)
    byNode.set(node, list)
  }

  return { byNode, unresolved }
}

/**
 * The vzdump params shared by every node in an immediate run, replayed from the
 * job's own configuration so a manual run produces the SAME backup as the
 * schedule (retention, fleecing, notes, notifications, ...).
 *
 * Only options that `vzdump` itself accepts are emitted (see `man vzdump`);
 * selection (all/vmid/pool/exclude) is added per-node by the caller. Fields
 * that PVE may return as an object rather than a string (`prune-backups`,
 * `fleecing`) are only forwarded when already a plain string, so we never send
 * a malformed `[object Object]`. The PBS namespace is deliberately NOT sent:
 * it is a property of the storage config, not a vzdump option.
 */
export function buildSharedVzdumpParams(job: Record<string, any>): Record<string, string> {
  const p: Record<string, string> = {}

  if (job.storage) p.storage = String(job.storage)
  if (job.mode) p.mode = String(job.mode)
  if (job.compress) p.compress = String(job.compress)

  if (typeof job['prune-backups'] === 'string' && job['prune-backups']) {
    p['prune-backups'] = job['prune-backups']
  }
  if (job['notes-template']) p['notes-template'] = String(job['notes-template'])
  if (typeof job.fleecing === 'string' && job.fleecing) p.fleecing = job.fleecing
  if (job['pbs-change-detection-mode']) {
    p['pbs-change-detection-mode'] = String(job['pbs-change-detection-mode'])
  }
  if (job.bwlimit) p.bwlimit = String(job.bwlimit)
  if (job.zstd) p.zstd = String(job.zstd)
  if (job.protected === 1 || job.protected === true) p.protected = '1'

  // Notifications: prefer the modern `notification-mode`; skip the deprecated
  // `mailnotification` which newer PVE (9.x) may reject.
  if (job['notification-mode']) p['notification-mode'] = String(job['notification-mode'])
  if (job.mailto) p.mailto = String(job.mailto)

  return p
}

export function planBackupRunDispatch(input: PlanRunInput): RunDispatchPlan {
  const { job, vmLocations, onlineNodes, poolVmids } = input

  // A job pinned to a node runs exactly there, as configured. This is the one
  // case the old code already handled correctly, so keep it identical.
  if (job.node) {
    return { entries: [{ node: job.node, selection: pinnedSelection(job) }], unresolved: [] }
  }

  // "All guests": mirror the scheduler and run one vzdump per online node, each
  // backing up its own local guests (with the shared exclude list).
  if (job.all) {
    const selection: Record<string, string> = job.exclude
      ? { all: '1', exclude: job.exclude }
      : { all: '1' }
    return {
      entries: onlineNodes.map((node) => ({ node, selection: { ...selection } })),
      unresolved: [],
    }
  }

  // Explicit vmid list: group by the node currently hosting each guest.
  if (job.vmid !== undefined && job.vmid !== '') {
    const { byNode, unresolved } = groupVmidsByNode(parseVmidList(job.vmid), vmLocations, onlineNodes)
    return {
      entries: [...byNode.entries()].map(([node, vmids]) => ({
        node,
        selection: { vmid: vmids.join(',') },
      })),
      unresolved,
    }
  }

  // Pool: resolve the pool's members to their current nodes and group.
  if (job.pool) {
    const { byNode, unresolved } = groupVmidsByNode(poolVmids ?? [], vmLocations, onlineNodes)
    return {
      entries: [...byNode.entries()].map(([node, vmids]) => ({
        node,
        selection: { vmid: vmids.join(',') },
      })),
      unresolved,
    }
  }

  return { entries: [], unresolved: [] }
}
