// src/lib/firewall/logWindow.ts
// Reads the lines of a firewall log window the cheap way (ui#1190). Given a
// `since` or an `until`, PVE scans every rotated log, a week of files parsed
// line by line (gzip included), whatever the window: on a busy node that takes
// longer than any request waits, for the last 15 minutes as for the last week.
// Without them PVE reads the current file only, `start` and `limit` page it
// from its oldest line and `total` counts its lines. So the newest lines come
// from the end of the current file, and the rotated logs are read only when
// the window starts before the current file does.

import { logLineTime } from './logParse'

import type { FirewallLogEntry } from '@/lib/api/firewall'

/** Mirrors the Go LogQuery: PVE counts `start` and `limit` from the oldest line, limit 0 = all. */
export interface LogPageQuery {
  start?: number
  limit: number
  since?: number
  until?: number
}

/** Mirrors the Go FirewallLogPage: the lines, oldest first, and how many PVE matched. */
export interface LogPage {
  total: number
  lines: FirewallLogEntry[]
}

export type LogPageReader = (q: LogPageQuery) => Promise<LogPage>

export interface WindowedLog {
  /** Oldest first, numbered from 1 in that order. */
  lines: FirewallLogEntry[]
  /** The window held more than the cap: the oldest lines were left out. */
  capped: boolean
  /** The rotated logs could not be read: the lines before this epoch (ms) are missing. */
  missingBefore?: number
  olderError?: unknown
}

export interface LogWindowSec {
  since: number
  until?: number
}

/** Shares each distinct page read, so the guest and node views of one node read its head once. */
export function memoReader(read: LogPageReader): LogPageReader {
  const pages = new Map<string, Promise<LogPage>>()

  return q => {
    const key = `${q.start ?? 0}:${q.limit}:${q.since ?? ''}:${q.until ?? ''}`
    let page = pages.get(key)

    if (!page) {
      page = read(q)
      pages.set(key, page)
    }

    return page
  }
}

/** Epoch (ms) of the current file's first line: the logger starts it at each rotation. */
export async function currentFileStart(nodeLog: LogPageReader): Promise<number | undefined> {
  const head = await nodeLog({ start: 0, limit: 1 })

  return head.lines[0] ? logLineTime(head.lines[0].t) : undefined
}

/**
 * The newest `cap` lines of `log` within `window`. `fileStart` tells when the
 * current file begins: a guest log counts only its guest's lines, so its own
 * first line says nothing of the file, the node log's does.
 */
export async function readLogWindow(
  log: LogPageReader,
  window: LogWindowSec,
  cap: number,
  fileStart: () => Promise<number | undefined> = () => currentFileStart(log),
): Promise<WindowedLog> {
  const sinceMs = window.since * 1000
  // PVE compares whole seconds: `until` keeps the lines of its own second.
  const untilMs = window.until === undefined ? undefined : window.until * 1000 + 999

  const inWindow = (e: FirewallLogEntry) => {
    const ts = logLineTime(e.t)

    return ts !== undefined && ts >= sinceMs && (untilMs === undefined || ts <= untilMs)
  }

  const { total } = await log({ start: 0, limit: 1 })
  const start = Math.max(0, total - cap)
  const tail = await log({ start, limit: cap })
  const current = tail.lines.filter(inWindow)

  // The current file holds more than the cap: its end is the newest `cap`
  // lines, and the window is either covered or capped, never older.
  if (start > 0) {
    const oldest = tail.lines[0] ? logLineTime(tail.lines[0].t) : undefined

    return finish(current, cap, oldest !== undefined && oldest >= sinceMs)
  }

  const begins = await fileStart().catch(() => undefined)

  if (begins !== undefined && begins <= sinceMs) return finish(current, cap, false)

  // The window reaches into the rotated logs. The current file's lines are
  // all from `begins` on, so the older read stops the second before; without
  // `begins` it covers the whole window, the current file included.
  const beforeFile = begins === undefined ? undefined : Math.floor(begins / 1000) - 1
  const until = beforeFile === undefined ? window.until : Math.min(window.until ?? beforeFile, beforeFile)

  try {
    const older = (await log({ limit: 0, since: window.since, until })).lines.filter(inWindow)
    const merged = beforeFile === undefined ? older : [...older, ...current]

    return finish(merged, cap, false)
  } catch (olderError) {
    return { ...finish(current, cap, false), missingBefore: begins, olderError }
  }
}

function finish(lines: FirewallLogEntry[], cap: number, capped: boolean): WindowedLog {
  const kept = lines.length > cap ? lines.slice(-cap) : lines

  return { lines: kept.map((e, i) => ({ n: i + 1, t: e.t })), capped: capped || kept !== lines }
}
