/**
 * In-process caches for the backup run history (issue #1003), on globalThis so
 * Next dev reloads and route modules share them. A finished task never changes,
 * so its first log line and parsed log are cached without expiry (bounded by
 * LRU); the assembled result per connection lives RESULT_TTL_MS.
 * Every HA replica keeps its own copy, which only costs a few extra PVE reads.
 */

import type { ParsedVzdumpLog } from './vzdumpLog'
import type { BackupRunsResult } from './vzdumpRunsService'

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
  parsed: LruCache<ParsedVzdumpLog>
  results: Map<string, { at: number; value: BackupRunsResult }>
}

const KEY = '__proxcenterVzdumpRunCaches'

function create(): VzdumpRunCaches {
  return { firstLines: new LruCache(5000), parsed: new LruCache(500), results: new Map() }
}

export function getVzdumpRunCaches(): VzdumpRunCaches {
  const g = globalThis as unknown as Record<string, VzdumpRunCaches | undefined>
  g[KEY] ??= create()

  return g[KEY]!
}

export function resetVzdumpRunCaches(): void {
  ;(globalThis as unknown as Record<string, VzdumpRunCaches>)[KEY] = create()
}
