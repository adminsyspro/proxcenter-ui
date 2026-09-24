/**
 * In-process caches for the backup run history (issue #1003), on globalThis so
 * Next dev reloads and route modules share them. A finished task never changes,
 * so its first log line and the compact summary of its log are cached without
 * expiry (bounded by LRU, sized for a large cluster's 90 days of tasks); the
 * raw material of a connection's history (jobs, task facts, node health) lives
 * a few seconds (see vzdumpRunsService.ts), and one scan per connection+days
 * is in flight at a time. Every HA replica keeps its own copy, which only
 * costs a few extra PVE reads.
 */

import type { TaskLogSummary } from './vzdumpLog'
import type { BackupRunsRaw } from './vzdumpRunsService'

export const TASK_CACHE_SIZE = 50_000

export class LruCache<V> {
  private readonly map = new Map<string, V>()

  constructor(private readonly max: number) {}

  get(key: string): V | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, value)

    return value
  }

  set(key: string, value: V): void {
    this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string)
  }

  get size(): number {
    return this.map.size
  }
}

interface VzdumpRunCaches {
  firstLines: LruCache<string>
  summaries: LruCache<TaskLogSummary>
  results: Map<string, { at: number; ttlMs: number; value: BackupRunsRaw }>
  inFlight: Map<string, Promise<BackupRunsRaw>>
  /** Bumped by invalidateBackupRuns so a scan started before it is not cached. */
  generations: Map<string, number>
}

const KEY = '__proxcenterVzdumpRunCaches'

function create(): VzdumpRunCaches {
  return {
    firstLines: new LruCache(TASK_CACHE_SIZE),
    summaries: new LruCache(TASK_CACHE_SIZE),
    results: new Map(),
    inFlight: new Map(),
    generations: new Map(),
  }
}

export function getVzdumpRunCaches(): VzdumpRunCaches {
  const g = globalThis as unknown as Record<string, VzdumpRunCaches | undefined>
  g[KEY] ??= create()

  return g[KEY]!
}

export function resetVzdumpRunCaches(): void {
  ;(globalThis as unknown as Record<string, VzdumpRunCaches>)[KEY] = create()
}
