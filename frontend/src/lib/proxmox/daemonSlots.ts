// src/lib/proxmox/daemonSlots.ts
// Bounds the "protected" PVE calls ProxCenter sends to one node (roadmap#179).
// pveproxy hands every method marked protected (agent/*, snapshot list,
// status/current, lxc interfaces...) to pvedaemon, which runs 3 workers per
// node. A guest agent that does not answer holds a worker for about 3 s, and
// pvedaemon keeps working on a call the client gave up on: a burst of them
// froze a node's whole API, the Proxmox GUI included, for 56 s in the lab.
// So, per Next process, at most DAEMON_SLOTS_PER_NODE of those calls are in
// flight on a node and the others wait their turn, which costs PVE nothing:
// one worker always stays free for everyone else.

export const DAEMON_SLOTS_PER_NODE = 2

/** The slot came after the caller's deadline: the call was never sent. */
export class DaemonSlotExpired extends Error {
  constructor() {
    super('waited too long for a free pvedaemon slot on this node')
    this.name = 'DaemonSlotExpired'
  }
}

type Lane = { active: number; waiting: Array<() => void> }

const lanes = new Map<string, Lane>()

/** One lane per node of a connection. */
export function daemonNodeKey(conn: { id?: string; baseUrl?: string }, node: string): string {
  return `${conn.id ?? conn.baseUrl ?? ''}/${node}`
}

/** Test hook: forget every lane. */
export function resetDaemonSlots() {
  lanes.clear()
}

/**
 * Runs `call` once one of the node's slots is free. With a `deadline` (epoch
 * ms), a slot that frees up after it is handed on unused and the caller gets
 * DaemonSlotExpired, so a request can bound its own duration.
 */
export async function withDaemonSlot<T>(
  key: string,
  call: () => Promise<T>,
  opts: { deadline?: number; now?: () => number } = {},
): Promise<T> {
  const now = opts.now ?? Date.now
  let lane = lanes.get(key)

  if (!lane) {
    lane = { active: 0, waiting: [] }
    lanes.set(key, lane)
  }

  if (lane.active < DAEMON_SLOTS_PER_NODE) {
    lane.active++
  } else {
    const queued = lane
    // A freed slot is handed over as is: `active` does not move.
    await new Promise<void>(resolve => queued.waiting.push(resolve))
  }

  try {
    if (opts.deadline !== undefined && now() > opts.deadline) throw new DaemonSlotExpired()

    return await call()
  } finally {
    const next = lane.waiting.shift()

    if (next) {
      next()
    } else {
      lane.active--
      if (lane.active === 0 && lanes.get(key) === lane) lanes.delete(key)
    }
  }
}
