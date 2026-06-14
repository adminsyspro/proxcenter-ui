// src/lib/vdc/ipamScan.ts
//
// External-IP scanner. Walks the VMs of a vDC's PVE pool, parses their
// netN/ipconfigN config lines, and returns the set of IPs already used
// inside a given subnet — including IPs that ProxCenter's IPAM doesn't
// know about (VMs created in CLI, restored from backup before the IPAM
// existed, etc.).
//
// Scope: limited to the vDC pool, NOT the full cluster — a provider with
// thousands of VMs across tenants would otherwise pay an N-VMs roundtrip
// cost on every allocation. The pool is the natural boundary.
//
// Result is consumed by allocateIp via the optional `externalIps` arg, so
// the allocator merges the IPAM DB rows with what's actually deployed and
// never picks an IP that some external tool has already pinned in qm
// config.
//
// Caching: 60s per (connectionId, subnetId). Invalidated on every
// allocateIp / releaseIp / releaseAllocationsForVm so consecutive deploys
// from the same wizard don't all rescan PVE. Drift inside the TTL window
// (someone running `qm set` in SSH between two scans) is the residual
// risk; an out-of-band IP creates a 1-shot collision that the next scan
// catches.

import type { ProxmoxClientOptions } from '@/lib/proxmox/client'
import { pveFetch } from '@/lib/proxmox/client'

import { ipToInt } from './network'

export interface ScannedIp {
  vmid: number
  mac: string | null
  ip: string
}

export interface ScanArgs {
  conn: ProxmoxClientOptions
  /** PVE pool name backing the vDC. Scoping the scan to this pool is the
   *  whole point — a provider's full inventory is out of bounds. */
  vdcPoolName: string
  /** PVE-side VNet ID (the 8-char hashed name we use as the bridge in
   *  netN). We only count IPs from NICs attached to THIS bridge. */
  vnetPveName: string
  /** Subnet identifier, used as the cache key. */
  subnetId: string
  /** Connection identifier, used as the cache key. */
  connectionId: string
}

// ---------------------------------------------------------------------------
// In-process cache
// ---------------------------------------------------------------------------

const CACHE_TTL_MS = 60_000

interface CacheEntry {
  expiresAt: number
  scanned: ScannedIp[]
}

const cache = new Map<string, CacheEntry>()

function cacheKey(connectionId: string, subnetId: string): string {
  return `${connectionId}::${subnetId}`
}

/**
 * Drop the cached scan for a (connection, subnet). Call this from any
 * code path that mutates the IPAM (allocateIp success, releaseIp, etc.)
 * so the next allocation sees an up-to-date "taken" set without paying
 * for another PVE roundtrip — the caller already knows what changed.
 */
export function invalidateScanCache(connectionId: string, subnetId: string): void {
  cache.delete(cacheKey(connectionId, subnetId))
}

/** Test helper — empties the entire cache. */
export function __clearScanCacheForTests(): void {
  cache.clear()
}

// ---------------------------------------------------------------------------
// Concurrency-limited fan-out
// ---------------------------------------------------------------------------

const MAX_CONCURRENCY = 10

async function mapWithLimit<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit = MAX_CONCURRENCY,
): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++
      if (i >= items.length) return
      out[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return out
}

// ---------------------------------------------------------------------------
// Config parsing
// ---------------------------------------------------------------------------

const NET_KEY_REGEX = /^net(\d+)$/

const NET_MODEL_TOKENS = new Set(['virtio', 'e1000', 'e1000-82540em', 'e1000-82544gc', 'e1000-82545em', 'rtl8139', 'vmxnet3'])

/**
 * Parse a `netN` line. Extract the bridge and MAC. PVE accepts two MAC
 * forms — both must be supported, otherwise IPAM sync silently drops
 * allocations on edits made via the UI:
 *
 *   1. Canonical (what PVE returns on read): `virtio=BC:24:11:AA:BB:CC,bridge=X`
 *   2. Alt form (what `EditNetworkDialog` writes): `virtio,bridge=X,macaddr=BC:24:11:AA:BB:CC`
 *
 * The canonical form wins when both are present; fall back to `macaddr=`
 * when the model token has no MAC pinned to it. MAC stays null when PVE
 * is going to auto-generate it (no MAC anywhere on the line).
 */
export function parseNetLine(value: string): { bridge: string | null; mac: string | null } {
  const parts = String(value || '').split(',')
  let bridge: string | null = null
  let modelMac: string | null = null
  let macaddrMac: string | null = null
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k === 'bridge') bridge = v
    else if (NET_MODEL_TOKENS.has(k)) modelMac = v.toUpperCase()
    else if (k === 'macaddr') macaddrMac = v.toUpperCase()
  }
  return { bridge, mac: modelMac ?? macaddrMac }
}

/**
 * Rewrite a `netN` line so PVE assigns a fresh MAC on the next config write.
 *
 * PVE's clone keeps the source MACs and the clone API's `unique` flag is not
 * portable across PVE versions (older builds reject it as an unknown
 * property). For NICs on an IPAM-managed VNet the duplicated MAC collides both
 * on the wire and on the (subnet, mac) UNIQUE constraint, so we strip the
 * pinned MAC — both the canonical `model=MAC` form and the `macaddr=` form —
 * and let PVE auto-generate one. A line with no pinned MAC is returned as-is.
 */
export function stripMacFromNet(value: string): string {
  const parts = String(value || '').split(',')
  const out: string[] = []

  for (const part of parts) {
    const eq = part.indexOf('=')

    if (eq >= 0) {
      const k = part.slice(0, eq).trim()

      // Canonical `model=MAC` → keep just the bare model token (drop the MAC).
      if (NET_MODEL_TOKENS.has(k)) {
        out.push(k)
        continue
      }

      // Alt `macaddr=MAC` → drop the token entirely.
      if (k === 'macaddr') continue
    }

    out.push(part)
  }

  return out.join(',')
}

/**
 * Parse an `ipconfigN` line. Returns the static IP if the line is in
 * `ip=A.B.C.D[/prefix],...` form. `ip=dhcp`, missing `ip=`, and SLAAC
 * (`ip6=...`) all yield null — we only track static v4 in the IPAM.
 */
export function parseIpconfigLine(value: string): { ip: string | null } {
  const parts = String(value || '').split(',')
  for (const part of parts) {
    const eq = part.indexOf('=')
    if (eq < 0) continue
    const k = part.slice(0, eq).trim()
    const v = part.slice(eq + 1).trim()
    if (k !== 'ip') continue
    if (!v || v.toLowerCase() === 'dhcp') return { ip: null }
    const ip = v.split('/')[0]
    return { ip: ipToInt(ip) === null ? null : ip }
  }
  return { ip: null }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan the vDC pool and return every static IPv4 currently bound to a
 * NIC attached to `vnetPveName`. Cached for 60s per (connection, subnet).
 *
 * Tolerates partial failures: if a single VM's config can't be fetched
 * (transient PVE error, RBAC mismatch on a foreign-tenant ghost VM), we
 * skip it. A degraded scan is better than a hard failure that blocks
 * deployments. The IPAM DB still serves as a safety net via its UNIQUE
 * (subnet_id, ip) constraint.
 */
export async function scanUsedIpsForSubnet(args: ScanArgs): Promise<ScannedIp[]> {
  const key = cacheKey(args.connectionId, args.subnetId)
  const cached = cache.get(key)
  const now = Date.now()
  if (cached && cached.expiresAt > now) return cached.scanned

  // Step 1: list pool members. PVE returns { members: [{ vmid, node, type, ... }] }.
  let members: Array<{ vmid: number; node: string; type: string }> = []
  try {
    const pool = await pveFetch<any>(args.conn, `/pools/${encodeURIComponent(args.vdcPoolName)}`)
    const list: any[] = Array.isArray(pool?.members) ? pool.members : []
    members = list
      .filter((m) => m && m.type === 'qemu' && Number.isFinite(Number(m.vmid)) && typeof m.node === 'string')
      .map((m) => ({ vmid: Number(m.vmid), node: String(m.node), type: 'qemu' }))
  } catch (err: any) {
    // Pool missing / RBAC denial — treat as empty scan. The IPAM DB still
    // protects us from collisions among ProxCenter-tracked VMs.
    console.warn(`[ipam-scan] /pools/${args.vdcPoolName} failed: ${err?.message ?? err}`)
    cache.set(key, { expiresAt: now + CACHE_TTL_MS, scanned: [] })
    return []
  }

  // Step 2: fan-out config fetches with bounded concurrency.
  const configs = await mapWithLimit(members, async (m) => {
    try {
      const cfg = await pveFetch<any>(
        args.conn,
        `/nodes/${encodeURIComponent(m.node)}/qemu/${encodeURIComponent(String(m.vmid))}/config`,
      )
      return { vmid: m.vmid, cfg }
    } catch (err: any) {
      console.warn(`[ipam-scan] config fetch failed for vmid=${m.vmid}: ${err?.message ?? err}`)
      return { vmid: m.vmid, cfg: null }
    }
  })

  // Step 3: extract (vmid, mac, ip) for every NIC attached to vnetPveName
  // that has a static ipconfigN. NICs without a static IP (ip=dhcp, no
  // ipconfigN) are intentionally skipped — we can't know their address.
  const out: ScannedIp[] = []
  for (const { vmid, cfg } of configs) {
    if (!cfg || typeof cfg !== 'object') continue
    for (const k of Object.keys(cfg)) {
      const m = NET_KEY_REGEX.exec(k)
      if (!m) continue
      const idx = m[1]
      const { bridge, mac } = parseNetLine(String(cfg[k] ?? ''))
      if (bridge !== args.vnetPveName) continue
      const ipconfigKey = `ipconfig${idx}`
      const { ip } = parseIpconfigLine(String(cfg[ipconfigKey] ?? ''))
      if (!ip) continue
      out.push({ vmid, mac, ip })
    }
  }

  cache.set(key, { expiresAt: now + CACHE_TTL_MS, scanned: out })
  return out
}

/** Convenience: convert the scan result to the uint32 set allocateIp consumes. */
export function scannedToIntSet(scanned: ScannedIp[]): Set<number> {
  const s = new Set<number>()
  for (const { ip } of scanned) {
    const n = ipToInt(ip)
    if (n !== null) s.add(n)
  }
  return s
}
