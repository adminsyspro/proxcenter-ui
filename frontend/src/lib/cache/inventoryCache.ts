/**
 * In-memory server-side cache for inventory data.
 *
 * Uses a **stale-while-revalidate** strategy:
 *   - FRESH  (< FRESH_TTL):  serve directly, no fetch
 *   - STALE  (< STALE_TTL):  serve immediately, trigger background refresh
 *   - EXPIRED (> STALE_TTL): discard, blocking fetch required
 *
 * Stores the RAW inventory (before RBAC filtering) so that the expensive
 * Proxmox API calls are not repeated on every request.
 * RBAC filtering is applied AFTER cache retrieval — each user still gets
 * their own filtered view.
 *
 * The cache lives in the Node.js process memory and is shared across all
 * requests.  A module-level singleton is used so that Next.js hot-reload
 * does not reset it in production.
 *
 * Cache is keyed by tenantId to ensure tenant isolation.
 */

export type CachedInventory = {
  clusters: any[]
  pbsServers: any[]
  externalHypervisors: any[]
  // Written by the inventory stream route: StorageData[], the {connId, nodes[],
  // sharedStorages[]} shape the inventory tree consumes.
  storages?: any[]
  // Written by fetchRawInventory: AggregatedStorage[], the per-storage rollup
  // the metrics exposition reads. A different shape under a different name:
  // the two shared the name `storages` in v1.4.10 and the tree died on it.
  storageResources?: any[]
  stats: {
    totalClusters: number
    totalNodes: number
    totalGuests: number
    onlineNodes: number
    runningGuests: number
    totalPbsServers: number
    totalDatastores: number
    totalBackups: number
  }
}

// Version of the CachedInventory payload shape. v1 had `storages` carrying two
// incompatible shapes depending on the writer; v2 separates them. v3 adds
// `pools` on every cluster (issue #978): a v2 entry carries none, and serving
// it would keep hiding the empty pools until its TTL runs out. v4 adds
// `diskTotal` on every guest (#938): a v3 entry would keep showing the boot
// disk alone in the Disk column. Since v4 the stream route also writes
// `storageResources`, and fills a missing `storages` when it serves an entry
// fetchRawInventory wrote: both readers of one key always get their half.
const SCHEMA_VERSION = 4

type CacheEntry = {
  data: CachedInventory
  timestamp: number
  version: number
}

/** Data is considered fresh for 2 minutes — served without revalidation */
const FRESH_TTL_MS = 2 * 60 * 1_000 // 2 minutes

/** Data is usable (stale) for up to 15 minutes — served while revalidating in background */
const STALE_TTL_MS = 15 * 60 * 1_000 // 15 minutes

// Use globalThis to survive Next.js hot-reload in development
const CACHE_KEY = '__proxcenter_inventory_cache__' as const

function getCacheStore(): Map<string, CacheEntry> {
  if (!(globalThis as any)[CACHE_KEY]) {
    ;(globalThis as any)[CACHE_KEY] = new Map<string, CacheEntry>()
  }
  return (globalThis as any)[CACHE_KEY]
}

// Lock to prevent concurrent fetches per tenant (thundering herd)
const INFLIGHT_KEY = '__proxcenter_inventory_inflight__' as const

function getInflightStore(): Map<string, Promise<CachedInventory>> {
  if (!(globalThis as any)[INFLIGHT_KEY]) {
    ;(globalThis as any)[INFLIGHT_KEY] = new Map<string, Promise<CachedInventory>>()
  }
  return (globalThis as any)[INFLIGHT_KEY]
}

type CacheResult =
  | { status: 'fresh'; data: CachedInventory }
  | { status: 'stale'; data: CachedInventory }
  | { status: 'miss' }

/** Composite cache key: `${tenantId}::${vdcContext ?? 'all'}`. The vDC view
 *  context is part of the identity of a cached payload — a narrowed
 *  inventory must never be served to the union view (or vice-versa). */
export function inventoryCacheKey(tenantId: string, vdcContext: string | null = null): string {
  return `${tenantId}::${vdcContext ?? 'all'}`
}

// Bumped by every invalidation. A fetch remembers the epoch it started in and
// may only write the cache while it is still current: a read begun before a
// VM action would otherwise land after the invalidation and put the
// pre-action inventory back for the next 15 minutes.
const EPOCH_KEY = '__proxcenter_inventory_epoch__' as const

export function inventoryCacheEpoch(): number {
  return (globalThis as any)[EPOCH_KEY] ?? 0
}

/**
 * Returns the cached inventory with its freshness status.
 *   - `fresh`  → data is recent, no revalidation needed
 *   - `stale`  → data is usable but should be revalidated in background
 *   - `miss`   → no usable data, blocking fetch required
 */
export function getInventoryFromCache(tenantId = 'default', vdcContext: string | null = null): CacheResult {
  const store = getCacheStore()
  const entry = store.get(inventoryCacheKey(tenantId, vdcContext))
  if (!entry) return { status: 'miss' }

  // A payload shape change must never be served to a process that expects the
  // new one: entries written by an older build are discarded here rather than
  // waiting out their TTL. Bump SCHEMA_VERSION whenever CachedInventory changes.
  if (entry.version !== SCHEMA_VERSION) return { status: 'miss' }

  const age = Date.now() - entry.timestamp

  if (age <= FRESH_TTL_MS) {
    return { status: 'fresh', data: entry.data }
  }

  if (age <= STALE_TTL_MS) {
    return { status: 'stale', data: entry.data }
  }

  return { status: 'miss' }
}

/** `epoch`: the one the fetch started in; the write is dropped when the cache
 *  was invalidated since. */
export function setCachedInventory(data: CachedInventory, tenantId = 'default', vdcContext: string | null = null, epoch?: number): void {
  if (epoch !== undefined && epoch !== inventoryCacheEpoch()) return
  const store = getCacheStore()
  store.set(inventoryCacheKey(tenantId, vdcContext), { data: withoutTombstoned(data), timestamp: Date.now(), version: SCHEMA_VERSION })
}

/* ------------------------------------------------------------------ */
/* Guest-set patches (roadmap#192)                                     */
/* ------------------------------------------------------------------ */
//
// A fresh entry used to be corrected by its TTL alone: a guest destroyed in
// Proxmox came back on every reload for up to FRESH_TTL_MS, and a new one
// stayed missing as long. The inventory poller, which already reads
// /cluster/resources every 15 s, and the routes that add or destroy guests
// now patch the guest set of every entry holding the connection instead.
// Patching rather than invalidating: an invalidation costs a full Proxmox
// fan-out per tenant and vDC context on the next read, a patch costs none.
// The timestamp of a patched entry is kept, so its freshness is unchanged.

/** A guest row as /cluster/resources lists it. */
export type ResourceGuestRow = {
  vmid: string | number
  type: string
  node?: string
  status?: string
  name?: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
  disk?: number
  maxdisk?: number
  uptime?: number
  pool?: string
  tags?: string
  lock?: string
  template?: number | boolean
  netin?: number
  netout?: number
  diskread?: number
  diskwrite?: number
  memhost?: number
}

// Guests ProxCenter just destroyed, by `${connId}:${type}/${vmid}`, with the
// time the mark lapses. Proxmox keeps listing a guest until its destroy task
// ends, so a read made in between (a fetch, a poll) would put it back.
const TOMBSTONE_KEY = '__proxcenter_inventory_tombstones__' as const

function getTombstones(): Map<string, number> {
  if (!(globalThis as any)[TOMBSTONE_KEY]) {
    ;(globalThis as any)[TOMBSTONE_KEY] = new Map<string, number>()
  }
  return (globalThis as any)[TOMBSTONE_KEY]
}

function liveTombstones(): Map<string, number> {
  const tombstones = getTombstones()
  const now = Date.now()
  for (const [key, lapsesAt] of tombstones) {
    if (lapsesAt <= now) tombstones.delete(key)
  }
  return tombstones
}

const guestId = (type: unknown, vmid: unknown) => `${type}/${vmid}`
const tombstoneKey = (connId: string, id: string) => `${connId}:${id}`

const isGuestType = (type: unknown) => type === 'qemu' || type === 'lxc'

/** The guest projection both inventory producers build from the same row. */
function guestFromRow(r: ResourceGuestRow): any {
  return {
    vmid: r.vmid,
    name: r.name || guestId(r.type, r.vmid),
    type: r.type || 'qemu',
    status: r.status || 'unknown',
    node: r.node,
    cpu: r.cpu,
    maxcpu: r.maxcpu,
    mem: r.mem,
    maxmem: r.maxmem,
    disk: r.disk,
    maxdisk: r.maxdisk,
    uptime: r.uptime,
    pool: r.pool,
    tags: r.tags,
    lock: r.lock,
    template: r.template === 1 || r.template === true,
    netin: r.netin,
    netout: r.netout,
    diskread: r.diskread,
    diskwrite: r.diskwrite,
    cores: r.maxcpu,
    memhost: r.memhost,
  }
}

// What a patch refreshes on a guest the entry already holds: placement and
// state. The usage counters move every poll and are left to the next full
// read, which also owns the fields no /cluster/resources row carries (HA
// state, disk totals).
const SYNCED_FIELDS = ['node', 'status', 'name', 'pool', 'tags', 'lock', 'template'] as const

function syncGuest(cachedGuest: any, r: ResourceGuestRow): any {
  const fresh = guestFromRow(r)
  if (SYNCED_FIELDS.every(f => cachedGuest[f] === fresh[f])) return cachedGuest
  const next = { ...cachedGuest }
  for (const f of SYNCED_FIELDS) next[f] = fresh[f]
  return next
}

function byVmid(a: any, b: any): number {
  return (Number.parseInt(String(a.vmid), 10) || 0) - (Number.parseInt(String(b.vmid), 10) || 0)
}

/** Rebuilds the nodes of `cluster` from guests already placed by node name. */
function withPlacedGuests(cluster: any, placed: Map<string, any[]>): any {
  const nodes = cluster.nodes.map((n: any) => ({ ...n, guests: (placed.get(n.node) ?? []).sort(byVmid) }))
  for (const [node, guests] of placed) {
    if (!cluster.nodes.some((n: any) => n.node === node)) nodes.push({ node, status: 'unknown', guests: guests.sort(byVmid) })
  }
  nodes.sort((a: any, b: any) => String(a.node).localeCompare(String(b.node)))
  return { ...cluster, nodes }
}

function place(placed: Map<string, any[]>, guest: any): void {
  const list = placed.get(guest.node)
  if (list) list.push(guest)
  else placed.set(guest.node, [guest])
}

/** `cluster` with exactly the guests of `rows`, or itself when it already has them. */
function reconcileCluster(cluster: any, rows: Map<string, ResourceGuestRow>): any {
  const placed = new Map<string, any[]>()
  const seen = new Set<string>()
  let changed = false
  for (const node of cluster.nodes) {
    for (const g of node.guests ?? []) {
      const id = guestId(g.type, g.vmid)
      const r = rows.get(id)
      if (!r || seen.has(id)) {
        changed = true
        continue
      }
      seen.add(id)
      const next = syncGuest(g, r)
      if (next !== g) changed = true
      place(placed, next)
    }
  }
  for (const [id, r] of rows) {
    if (seen.has(id)) continue
    changed = true
    place(placed, guestFromRow(r))
  }
  return changed ? withPlacedGuests(cluster, placed) : cluster
}

/** `cluster` without guest `id`, or itself when it does not hold it. */
function dropGuest(cluster: any, id: string): any {
  const holds = (cluster.nodes ?? []).some((n: any) => (n.guests ?? []).some((g: any) => guestId(g.type, g.vmid) === id))
  if (!holds) return cluster
  return {
    ...cluster,
    nodes: cluster.nodes.map((n: any) => ({ ...n, guests: (n.guests ?? []).filter((g: any) => guestId(g.type, g.vmid) !== id) })),
  }
}

/** `data` with `clusters`, and the guest counters recomputed from them. */
function withClusters(data: CachedInventory, clusters: any[]): CachedInventory {
  let totalGuests = 0
  let runningGuests = 0
  for (const cluster of clusters) {
    for (const node of cluster?.nodes ?? []) {
      for (const g of node.guests ?? []) {
        totalGuests++
        if (g.status === 'running') runningGuests++
      }
    }
  }
  return { ...data, clusters, stats: { ...data.stats, totalGuests, runningGuests } }
}

/** Applies `patch` to the clusters of `data`; `data` itself when none changed. */
function patchClusters(data: CachedInventory, patch: (cluster: any) => any): CachedInventory {
  if (!Array.isArray(data?.clusters)) return data
  let changed = false
  const clusters = data.clusters.map(cluster => {
    const next = patch(cluster)
    if (next !== cluster) changed = true
    return next
  })
  return changed ? withClusters(data, clusters) : data
}

/** Patches the cluster `connId` in every current entry, keeping each timestamp. */
function patchCachedConnection(connId: string, patch: (cluster: any) => any): void {
  const store = getCacheStore()
  for (const [key, entry] of store) {
    if (entry.version !== SCHEMA_VERSION) continue
    const data = patchClusters(entry.data, c => (c?.id === connId ? patch(c) : c))
    if (data !== entry.data) store.set(key, { ...entry, data })
  }
}

function withoutTombstoned(data: CachedInventory): CachedInventory {
  const tombstones = liveTombstones()
  if (tombstones.size === 0) return data
  return patchClusters(data, cluster => {
    let next = cluster
    for (const key of tombstones.keys()) {
      const prefix = `${cluster?.id}:`
      if (key.startsWith(prefix)) next = dropGuest(next, key.slice(prefix.length))
    }
    return next
  })
}

/**
 * Aligns the guest set of connection `connId`, in every cached inventory, on
 * `rows`: the full guest list Proxmox just returned for it (/cluster/resources,
 * other resource types are skipped). Guests it no longer lists are dropped,
 * new ones added, relocated ones moved; a cluster whose last read failed (no
 * node) is left to the next full read. A guest ProxCenter is destroying stays
 * out until a list shows it gone, after which its vmid may be reused.
 */
export function reconcileCachedGuests(connId: string, rows: ResourceGuestRow[]): void {
  const tombstones = liveTombstones()
  const listed = new Set<string>()
  const current = new Map<string, ResourceGuestRow>()
  for (const r of rows) {
    if (!r?.node || !isGuestType(r.type)) continue
    const id = guestId(r.type, r.vmid)
    listed.add(id)
    if (!tombstones.has(tombstoneKey(connId, id))) current.set(id, r)
  }
  for (const key of tombstones.keys()) {
    const prefix = `${connId}:`
    if (key.startsWith(prefix) && !listed.has(key.slice(prefix.length))) tombstones.delete(key)
  }
  patchCachedConnection(connId, cluster => (cluster.nodes?.length ? reconcileCluster(cluster, current) : cluster))
}

/**
 * A guest ProxCenter destroyed: out of every cached inventory now, and out of
 * whatever is read while Proxmox still lists it, for one fresh window at most.
 */
export function forgetCachedGuest(connId: string, type: string, vmid: string | number): void {
  const id = guestId(type, vmid)
  getTombstones().set(tombstoneKey(connId, id), Date.now() + FRESH_TTL_MS)
  patchCachedConnection(connId, cluster => dropGuest(cluster, id))
}

/** A guest ProxCenter is creating under this vmid: no longer the destroyed one. */
export function clearGuestTombstone(connId: string, type: string, vmid: string | number): void {
  getTombstones().delete(tombstoneKey(connId, guestId(type, vmid)))
}

/** Whether any current cached inventory holds connection `connId`. */
export function hasCachedConnection(connId: string): boolean {
  for (const entry of getCacheStore().values()) {
    if (entry.version === SCHEMA_VERSION && entry.data?.clusters?.some((c: any) => c?.id === connId)) return true
  }
  return false
}

/**
 * Every cached inventory of a tenant across all vDC contexts, freshest
 * first (fresh-or-stale only). For consumers whose derived data is
 * context-independent (per-VM meta): a narrowed entry holds a subset of
 * the tenant's guests, so merging entries adds coverage and can never
 * leak across tenants (the prefix is tenant-scoped).
 */
export function getTenantInventoriesFromCache(tenantId: string): CachedInventory[] {
  const prefix = `${tenantId}::`
  const hits: Array<{ entry: CacheEntry }> = []
  for (const [key, entry] of getCacheStore()) {
    if (!key.startsWith(prefix)) continue
    if (Date.now() - entry.timestamp > STALE_TTL_MS) continue
    hits.push({ entry })
  }
  return hits.sort((a, b) => b.entry.timestamp - a.entry.timestamp).map(h => h.entry.data)
}

export function invalidateInventoryCache(tenantId?: string): void {
  ;(globalThis as any)[EPOCH_KEY] = inventoryCacheEpoch() + 1
  // The fetches in flight keep running for whoever awaits them, but new
  // readers must not join them: they started before the change.
  for (const store of [getCacheStore(), getInflightStore()] as Map<string, unknown>[]) {
    if (tenantId) {
      const prefix = `${tenantId}::`
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key)
      }
    } else {
      store.clear()
    }
  }
}

/**
 * Returns the in-flight fetch promise if one is already running for the given tenant,
 * or null if the caller should start a new fetch.
 * This prevents multiple simultaneous requests from all hitting Proxmox.
 */
export function getInflightFetch(tenantId = 'default', vdcContext: string | null = null): Promise<CachedInventory> | null {
  return getInflightStore().get(inventoryCacheKey(tenantId, vdcContext)) ?? null
}

export function setInflightFetch(p: Promise<CachedInventory> | null, tenantId = 'default', vdcContext: string | null = null): void {
  const store = getInflightStore()
  const key = inventoryCacheKey(tenantId, vdcContext)
  if (p !== null) {
    store.set(key, p)
  } else {
    store.delete(key)
  }
}

/** Frees the slot only if it still holds `p`: a fetch that ends after an
 *  invalidation or a forced refresh must not drop the newer one. */
export function clearInflightFetch(p: Promise<CachedInventory>, tenantId = 'default', vdcContext: string | null = null): void {
  const store = getInflightStore()
  const key = inventoryCacheKey(tenantId, vdcContext)
  if (store.get(key) === p) store.delete(key)
}
