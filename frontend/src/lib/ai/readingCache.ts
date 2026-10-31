/*
 * Cache of the AI readings shown on a page (capacity forecast, optimisation plan).
 *
 * One model call per scope and language every `ttlMs` at most: the readings follow
 * daily averages, so a fresher one would say the same thing. Concurrent requests
 * for the same key share the call in flight. A reading that fell back to the rules
 * because the model failed is kept `fallbackTtlMs` only, so a model that comes back
 * is used soon. An entry made with another provider or model is not reused.
 */

type Entry<T> = { at: number; ttl: number; target: string; value: T }

export type ReadingCacheOptions = { ttlMs: number; fallbackTtlMs: number; maxEntries: number }

export type ReadingCache<T> = {
  /** The reading already computed for this key, without calling anything. */
  peek(key: string): T | null
  /** The cached reading, or a fresh one from `compute` (null is not cached). */
  get(key: string, target: string, refresh: boolean, compute: () => Promise<T | null>): Promise<T | null>
}

export function createReadingCache<T extends { aiFailed?: boolean }>(options: ReadingCacheOptions): ReadingCache<T> {
  const entries = new Map<string, Entry<T>>()
  const inflight = new Map<string, Promise<T | null>>()

  const fresh = (entry: Entry<T> | undefined): entry is Entry<T> => Boolean(entry) && Date.now() - entry!.at < entry!.ttl

  const remember = (key: string, entry: Entry<T>) => {
    entries.delete(key)
    entries.set(key, entry)
    while (entries.size > options.maxEntries) entries.delete(entries.keys().next().value as string)
  }

  return {
    peek(key) {
      const entry = entries.get(key)

      return fresh(entry) ? entry.value : null
    },

    get(key, target, refresh, compute) {
      const entry = entries.get(key)
      if (!refresh && fresh(entry) && entry.target === target) return Promise.resolve(entry.value)

      const running = inflight.get(key)
      if (running !== undefined) return running

      const job = compute()
        .then(value => {
          if (value) remember(key, { at: Date.now(), ttl: value.aiFailed ? options.fallbackTtlMs : options.ttlMs, target, value })

          return value
        })
        .finally(() => inflight.delete(key))

      inflight.set(key, job)

      return job
    },
  }
}
