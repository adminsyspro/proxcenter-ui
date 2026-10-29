/**
 * ProxCenter's copy of the Proxmox task list (#1225), kept by the orchestrator
 * from the task lists it polls. Proxmox keeps a node's history on that node's
 * disk: while the node is down, this copy is the only place its tasks can be
 * read, and the tail of a failed task's log with them.
 *
 * The orchestrator does not know users: callers pass only the connections the
 * user may read and apply the vDC / RBAC scope to what comes back.
 */

import { orchestratorFetch } from '@/lib/orchestrator/client'

import type { PveTaskEntry } from './archive'

/** One stored task, as the orchestrator returns it. */
export interface StoredTask {
  upid: string
  connectionId: string
  startTime: string
  endTime?: string | null
  node: string
  type: string
  guestId: string
  user: string
  status: string
  logTail?: string
}

export interface StoredTaskQuery {
  connectionIds: string[]
  since: number
  until: number
  nodes?: string[]
  vmid?: string | null
  limit?: number
}

const HISTORY_TIMEOUT_MS = 10_000

/**
 * Stored tasks matching the query, or null when the orchestrator cannot be
 * read: the caller then shows what Proxmox alone has.
 */
export async function fetchStoredTasks(q: StoredTaskQuery): Promise<{ tasks: StoredTask[]; truncated: boolean } | null> {
  if (q.connectionIds.length === 0) return { tasks: [], truncated: false }

  const params = new URLSearchParams({
    connectionIds: q.connectionIds.join(','),
    since: String(q.since),
    until: String(q.until),
  })

  if (q.nodes?.length) params.set('nodes', q.nodes.join(','))
  if (q.vmid) params.set('vmid', q.vmid)
  if (q.limit) params.set('limit', String(q.limit))

  try {
    const res = await orchestratorFetch<{ data?: StoredTask[]; truncated?: boolean }>(`/task-history?${params}`, {
      timeout: HISTORY_TIMEOUT_MS,
    })

    return { tasks: Array.isArray(res?.data) ? res.data : [], truncated: !!res?.truncated }
  } catch (e) {
    console.error('Task history read error:', e)

    return null
  }
}

function epoch(iso: string | null | undefined): number | undefined {
  if (!iso) return undefined
  const ms = Date.parse(iso)

  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined
}

/** A stored task in the shape Proxmox lists it. */
export function toPveEntry(t: StoredTask): PveTaskEntry {
  return {
    upid: t.upid,
    node: t.node,
    starttime: epoch(t.startTime) ?? 0,
    endtime: epoch(t.endTime),
    type: t.type,
    id: t.guestId || undefined,
    user: t.user,
    status: t.status || undefined,
  }
}

/** Start time a UPID carries, in its fifth field (hex seconds). */
export function upidStartTime(upid: string): number | null {
  const hex = upid.split(':')[4]

  if (!hex || !/^[0-9A-Fa-f]{1,16}$/.test(hex)) return null

  return Number.parseInt(hex, 16)
}

/** The stored copy of one task, or null when ProxCenter did not keep it. */
export async function findStoredTask(connectionId: string, node: string, upid: string): Promise<StoredTask | null> {
  const start = upidStartTime(upid)

  if (start === null) return null

  const found = await fetchStoredTasks({ connectionIds: [connectionId], nodes: [node], since: start, until: start + 1, limit: 100 })

  return found?.tasks.find(t => t.upid === upid) ?? null
}
