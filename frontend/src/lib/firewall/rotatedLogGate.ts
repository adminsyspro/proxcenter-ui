// src/lib/firewall/rotatedLogGate.ts
// Guards the reads that reach the rotated firewall logs (roadmap#179). PVE
// serves the firewall log in pvedaemon, which runs 3 workers per node, and a
// read with `since` or `until` parses every line of a week of files. On a busy
// node that outlasts pveproxy's 30 s: the caller gets a 596 while the worker
// keeps scanning for minutes, and a view that asked again every 5 s stacked
// scans until the node's whole API froze (roadmap#176). So, per Next process:
// - a rotated read already running is shared by the callers that ask for it
//   again, and refuses any other rotated read of the same node;
// - a read that succeeded serves the later windows it covers: the rotated
//   files only change at the next rotation, which moves `until`;
// - after a failed read, the node's rotated logs are not asked for again
//   during ROTATED_COOLDOWN_MS, the time PVE may still spend on it.
// Reads of the current file (no `since`, no `until`) pass through untouched.

import { errorMessage } from './loadError'
import { logLineTime } from './logParse'

import type { LogPage, LogPageQuery, LogPageReader } from './logWindow'
import type { FirewallLogEntry } from '@/lib/api/firewall'

export const ROTATED_COOLDOWN_MS = 15 * 60_000

/** A rotation is daily; an entry older than this is read again anyway. */
const CACHE_TTL_MS = 6 * 3_600_000
const MAX_CACHED_LOGS = 64

/** A 403 costs PVE nothing: it never starts a cooldown. */
const PERMISSION_RE = /\b403\b|permission check failed/i

export interface RotatedLogKey {
  /** The PVE node whose pvedaemon serves the read, made unique per connection. */
  node: string
  /** The log on that node (its own, or one guest's), made unique per connection. */
  log: string
}

interface Covered {
  log: string
  since: number
  until?: number
  /** The newest lines of the read, oldest first. */
  lines: FirewallLogEntry[]
  /** Older lines the read matched and `lines` left out. */
  dropped: number
}

interface Running {
  log: string
  since: number
  until?: number
  done: Promise<Covered>
}

const running = new Map<string, Running>()
const cached = new Map<string, Covered & { at: number }>()
/** Until when each node is left alone. The failure text is not kept: on a shared node it may name another vDC's guest. */
const cooling = new Map<string, number>()

/** Test hook: forget every read, cache and cooldown. */
export function resetRotatedLogGate() {
  running.clear()
  cached.clear()
  cooling.clear()
}

const covers = (c: { log: string; since: number; until?: number }, log: string, q: LogPageQuery) =>
  c.log === log && c.until === q.until && (q.since ?? 0) >= c.since

/** The lines of `c` inside the window of `q`, and whether older ones matched it too. */
function pageOf(c: Covered, q: LogPageQuery): LogPage {
  const sinceMs = (q.since ?? 0) * 1000
  const lines = c.lines.filter(e => (logLineTime(e.t) ?? 0) >= sinceMs)
  const oldest = c.lines[0] ? logLineTime(c.lines[0].t) : undefined
  // Every dropped line is older than the oldest kept one.
  const missing = c.dropped > 0 && (oldest === undefined || oldest > sinceMs) ? c.dropped : 0

  return { total: lines.length + missing, lines }
}

function remember(c: Covered, now: number) {
  cached.delete(c.log)
  cached.set(c.log, { ...c, at: now })
  if (cached.size > MAX_CACHED_LOGS) cached.delete(cached.keys().next().value!)
}

/**
 * `read` with its rotated reads guarded per node. `maxLines` is how many of
 * the newest lines a read keeps: no window shows more than the newest
 * MAX_SCAN_LINES of the rotated logs and the current file together.
 */
export function gateRotatedReads(read: LogPageReader, key: RotatedLogKey, maxLines: number, now: () => number = Date.now): LogPageReader {
  return async q => {
    if (q.since === undefined && q.until === undefined) return read(q)

    const hit = cached.get(key.log)

    if (hit && now() - hit.at < CACHE_TTL_MS && covers(hit, key.log, q)) return pageOf(hit, q)

    const coolUntil = cooling.get(key.node) ?? 0

    if (coolUntil > now()) {
      const minutes = Math.ceil((coolUntil - now()) / 60_000)

      throw new Error(`the last read failed, ProxCenter waits ${minutes} min before reading this node's rotated logs again`)
    }

    const busy = running.get(key.node)

    if (busy && covers(busy, key.log, q)) return pageOf(await busy.done, q)
    if (busy) throw new Error("PVE is still reading this node's rotated firewall logs for another view")

    const since = q.since ?? 0
    const done = read(q).then(
      page => {
        const all = page.lines.filter(e => logLineTime(e.t) !== undefined)
        const lines = all.length > maxLines ? all.slice(-maxLines) : all
        const covered: Covered = { log: key.log, since, until: q.until, lines, dropped: all.length - lines.length }

        remember(covered, now())

        return covered
      },
      (err: unknown) => {
        if (!PERMISSION_RE.test(errorMessage(err))) cooling.set(key.node, now() + ROTATED_COOLDOWN_MS)
        throw err
      },
    )

    running.set(key.node, { log: key.log, since, until: q.until, done })

    try {
      return pageOf(await done, q)
    } finally {
      if (running.get(key.node)?.done === done) running.delete(key.node)
    }
  }
}
