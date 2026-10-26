/**
 * One inventory fan-out per (tenant, vDC context), shared by every stream
 * reader that arrives while it runs (#125).
 *
 * The producer reads Proxmox for the whole scope and emits each connection's
 * RAW data as it resolves. Nothing in it depends on the viewer: each reader
 * subscribes, gets the events already emitted, then the live ones, and applies
 * its own RBAC and vDC narrowing before sending anything. The cache entry the
 * producer writes is therefore the same whoever started it.
 *
 * The producer's result also goes into the shared in-flight slot of
 * inventoryCache, so a blocking reader of /api/v1/inventory piggybacks on it
 * instead of starting a second fan-out.
 */

import {
  clearInflightFetch,
  inventoryCacheEpoch,
  inventoryCacheKey,
  setCachedInventory,
  setInflightFetch,
  type CachedInventory,
} from '@/lib/cache/inventoryCache'

export type InventoryConnectionRow = { id: string; name: string; type: string; [k: string]: unknown }

export type InventoryFetchEvent =
  /** Always first: every connection of the scope, before any RBAC narrowing. */
  | { kind: 'connections'; pve: InventoryConnectionRow[]; pbs: InventoryConnectionRow[]; external: InventoryConnectionRow[] }
  | { kind: 'cluster'; data: any }
  | { kind: 'storage'; data: any }
  | { kind: 'pbs'; data: any }

export type InventoryFetchListener = (event: InventoryFetchEvent) => void

export type InventoryProducer = (emit: (event: InventoryFetchEvent) => void) => Promise<CachedInventory>

export interface SharedInventoryFetch {
  /** Replays what was already emitted, then forwards the rest. Returns the unsubscribe. */
  subscribe(listener: InventoryFetchListener): () => void
  /** The full inventory, once every connection has answered. */
  result: Promise<CachedInventory>
}

type Entry = SharedInventoryFetch & { epoch: number }

// globalThis, like the cache itself: one map per process across hot reloads.
const STORE_KEY = '__proxcenter_inventory_shared_fetch__' as const

function store(): Map<string, Entry> {
  if (!(globalThis as any)[STORE_KEY]) (globalThis as any)[STORE_KEY] = new Map<string, Entry>()
  return (globalThis as any)[STORE_KEY]
}

/** The fan-out running for this scope, unless the cache was invalidated since it started. */
export function getSharedInventoryFetch(tenantId: string, vdcContext: string | null): SharedInventoryFetch | null {
  const entry = store().get(inventoryCacheKey(tenantId, vdcContext))
  return entry?.epoch === inventoryCacheEpoch() ? entry : null
}

/**
 * Joins the fan-out running for this scope, or starts `produce`. `force`
 * (the tree's refresh button, the reload after an action) always starts a new
 * one: the running fan-out may have read Proxmox before the change the user
 * wants to see. Readers arriving afterwards join the new one.
 *
 * `produce` MUST read the scope that (tenantId, vdcContext) names, for any
 * viewer: its result is cached under that key.
 */
export function joinOrStartInventoryFetch(
  tenantId: string,
  vdcContext: string | null,
  produce: InventoryProducer,
  opts: { force?: boolean } = {},
): SharedInventoryFetch {
  const running = opts.force ? null : getSharedInventoryFetch(tenantId, vdcContext)
  if (running) return running

  const key = inventoryCacheKey(tenantId, vdcContext)
  const epoch = inventoryCacheEpoch()
  const emitted: InventoryFetchEvent[] = []
  const listeners = new Set<InventoryFetchListener>()

  const emit = (event: InventoryFetchEvent) => {
    emitted.push(event)
    for (const listener of listeners) {
      try {
        listener(event)
      } catch {
        // One reader's failure must not stop the others.
      }
    }
  }

  const result: Promise<CachedInventory> = produce(emit).then(
    data => {
      setCachedInventory(data, tenantId, vdcContext, epoch)
      release()
      return data
    },
    err => {
      release()
      throw err
    },
  )

  const entry: Entry = {
    epoch,
    result,
    subscribe(listener) {
      for (const event of emitted) listener(event)
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }

  function release() {
    listeners.clear()
    if (store().get(key) === entry) store().delete(key)
    clearInflightFetch(result, tenantId, vdcContext)
  }

  // A fan-out nobody awaits any more (stale revalidation, every reader gone)
  // must not surface as an unhandled rejection.
  result.catch(() => {})

  store().set(key, entry)
  setInflightFetch(result, tenantId, vdcContext)

  return entry
}
