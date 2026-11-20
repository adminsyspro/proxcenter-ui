// One compliance collection at a time per connection, reused for a short while.
//
// A collection reads the whole cluster: 12 + 4 x nodes + 3 x guests API calls
// and one SSH audit per node. The Hardening tab, the Frameworks tab and every
// PDF used to start their own, so opening Frameworks then downloading the five
// reports read the cluster six times in a minute. Here:
//   - a request that finds a collection in flight waits for it;
//   - a finished collection is reused for the tenant's cache duration
//     (collectionSettings, 5 minutes by default, 0 = never reused).
//
// The callers run every guard (Enterprise, IaaS, connection ownership, RBAC)
// BEFORE asking for data, on every request, cached or not. The key carries
// the tenant, so an entry is only ever handed to a caller of the tenant that
// collected it, and only after that caller proved it could collect it itself.
//
// The store lives on globalThis: a dev recompile gives modules a fresh
// instance, which would otherwise start a second cache beside the first.
import { collectHardeningData } from '@/lib/compliance/collectHardeningData'
import { getCollectionSettings } from '@/lib/compliance/collectionSettingsStore'
import type { HardeningData } from '@/lib/compliance/hardening'
import { COLLECTION_CACHE_MINUTES_CHOICES } from '@/lib/compliance/collectionSettings'

/** Bound on cached collections (one per tenant x connection x node scope x SSH). */
export const MAX_CACHED_COLLECTIONS = 50

/** No tenant may reuse a collection longer than this: older entries are dropped. */
const MAX_TTL_MS = Math.max(...COLLECTION_CACHE_MINUTES_CHOICES) * 60_000

interface Entry {
  data: HardeningData
  collectedAt: number
}

interface Store {
  entries: Map<string, Entry>
  inFlight: Map<string, Promise<{ data: HardeningData; collectedAt: number }>>
}

const KEY = Symbol.for('proxcenter.complianceCollectionCache')
const g = globalThis as unknown as Record<symbol, Store | undefined>

function store(): Store {
  return g[KEY] ?? (g[KEY] = { entries: new Map(), inFlight: new Map() })
}

export interface GetHardeningDataOptions {
  tenantId: string
  connectionId: string
  /** Already-verified PVE connection object passed to pveFetch. */
  conn: any
  nodeFilter?: string | null
  sshEnabled: boolean
  /** The scan button: skip a cached entry (a collection in flight is still joined, it is fresh). */
  forceRefresh?: boolean
}

export interface CollectionResult {
  /** Shared with other callers: read it, never mutate it. */
  data: HardeningData
  /** When the collection finished, which is what the screens show as the scan date. */
  collectedAt: Date
  fromCache: boolean
}

export function collectionKey(o: Pick<GetHardeningDataOptions, 'tenantId' | 'connectionId' | 'nodeFilter' | 'sshEnabled'>): string {
  return JSON.stringify([o.tenantId, o.connectionId, o.nodeFilter || '', !!o.sshEnabled])
}

function prune(s: Store, now: number) {
  for (const [k, e] of s.entries) if (now - e.collectedAt >= MAX_TTL_MS) s.entries.delete(k)

  // Oldest first: a Map iterates in insertion order and an entry is re-inserted on refresh.
  while (s.entries.size > MAX_CACHED_COLLECTIONS) {
    const oldest = s.entries.keys().next().value as string
    s.entries.delete(oldest)
  }
}

export async function getHardeningData(o: GetHardeningDataOptions): Promise<CollectionResult> {
  const s = store()
  const key = collectionKey(o)
  const settings = await getCollectionSettings(o.tenantId)
  const ttlMs = settings.cacheMinutes * 60_000

  prune(s, Date.now())

  // Judged against the duration set NOW, not the one in force when it was
  // stored: lowering the setting (down to 0) applies to what is cached already.
  const cached = s.entries.get(key)
  if (cached && !o.forceRefresh && Date.now() - cached.collectedAt < ttlMs) {
    return { data: cached.data, collectedAt: new Date(cached.collectedAt), fromCache: true }
  }

  let pending = s.inFlight.get(key)
  if (pending === undefined) {
    const started = collectHardeningData({
      connectionId: o.connectionId,
      conn: o.conn,
      nodeFilter: o.nodeFilter,
      sshEnabled: o.sshEnabled,
      guestConcurrency: settings.guestConcurrency,
    }).then(data => {
      const collectedAt = Date.now()

      s.entries.delete(key)
      if (ttlMs > 0) {
        s.entries.set(key, { data, collectedAt })
        prune(s, collectedAt)
      }

      return { data, collectedAt }
    })

    // A failure is never cached: the next request collects again.
    pending = started.finally(() => {
      if (s.inFlight.get(key) === pending) s.inFlight.delete(key)
    })
    s.inFlight.set(key, pending)
  }

  const { data, collectedAt } = await pending

  return { data, collectedAt: new Date(collectedAt), fromCache: false }
}

/** Tests only: start from an empty cache. */
export function resetCollectionCache(): void {
  const s = store()

  s.entries.clear()
  s.inFlight.clear()
}
