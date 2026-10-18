// VMIDs handed to the migration jobs of this server (roadmap#53).
//
// PVE's /cluster/nextid only reports the lowest id nothing uses YET: two jobs
// of a parallel batch asking at the same time get the same one, and a cold job
// holds its id for the whole copy before it creates the VM. Every job of this
// server takes its id here instead: one cluster at a time, an id no other job
// holds and the cluster reports free. The job keeps it until it ends; the
// create loops still retry on "already exists", for a VM made outside ProxCenter.

type NextId = (from?: number) => Promise<number>

interface State {
  locks: Map<string, Promise<unknown>>
  held: Map<string, Map<number, string>>
}

// On globalThis: in dev, a background job and a route can run in two
// instances of this module, and both must see the same reservations.
const g = globalThis as typeof globalThis & { __proxcenterVmidReservations?: State }
const state: State = (g.__proxcenterVmidReservations ??= { locks: new Map(), held: new Map() })

const MAX_PROBES = 200

function asVmid(answer: unknown): number {
  const id = Number(answer)
  if (!Number.isInteger(id) || id < 100) throw new Error(`Unexpected /cluster/nextid answer: ${String(answer)}`)
  return id
}

function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = state.locks.get(key) ?? Promise.resolve()
  const run = prev.then(fn, fn)
  state.locks.set(key, run.catch(() => undefined))
  return run
}

/**
 * Next VMID of cluster `clusterKey` that the cluster reports free and no other
 * job of this server holds, reserved for `jobId`. `nextId()` asks the cluster
 * for its next id, `nextId(n)` whether `n` is free (it returns n, or throws).
 */
export function reserveVmid(clusterKey: string, jobId: string, nextId: NextId): Promise<number> {
  return serialize(clusterKey, async () => {
    const held = state.held.get(clusterKey) ?? new Map<number, string>()
    let probes = 0
    // The first id at or after `n` the cluster reports free.
    const freeFrom = async (n: number): Promise<number> => {
      for (let id = n; ; id++) {
        if (++probes > MAX_PROBES) throw new Error(`No free VMID found between ${n} and ${id}`)
        let answer: number
        try {
          answer = await nextId(id)
        } catch {
          continue // taken on the cluster, try the next one
        }
        return asVmid(answer)
      }
    }
    let id = asVmid(await nextId())
    while (held.has(id)) id = await freeFrom(id + 1)
    held.set(id, jobId)
    state.held.set(clusterKey, held)
    return id
  })
}

/** Drops every VMID `jobId` holds, on whatever cluster; call when the job ends. */
export function releaseVmids(jobId: string): void {
  for (const [key, held] of state.held) {
    for (const [id, owner] of held) if (owner === jobId) held.delete(id)
    if (held.size === 0) state.held.delete(key)
  }
}
/** For tests: the VMIDs held on a cluster. */
export function __heldVmids(clusterKey: string): number[] {
  return [...(state.held.get(clusterKey)?.keys() ?? [])].sort((a, b) => a - b)
}
