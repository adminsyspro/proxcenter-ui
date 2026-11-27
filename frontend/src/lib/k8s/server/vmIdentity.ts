/**
 * Proxmox VM identity map for K8s node correlation.
 *
 * parseVmIdentity  - pure: join a lightweight VM row with its fetched config.
 * buildVmIdentityMap - bounded I/O: enumerate visible connections, fetch VM
 *   configs in parallel (bounded concurrency), and build the identity map.
 *
 * Follows the enumeration pattern from the inventory route:
 *   1. Load PVE connections filtered by connectionFilter (null = all).
 *   2. For each connection: list VMs cheaply via /cluster/resources?type=vm.
 *   3. For each VM: fetch /nodes/{node}/{type}/{vmid}/config (per-VM try/catch).
 * Stops accepting new VMs when VM_SCAN_CAP is reached (sets capped: true).
 */

import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import { parseVmSmbiosUuid, parseVmStaticIPs } from '@/lib/proxmox/vmNetworkConfig'

// ---------------------------------------------------------------------------
// Constants (exported so tests can reference them)
// ---------------------------------------------------------------------------

/** Maximum number of VMs to scan before setting capped:true. */
export const VM_SCAN_CAP = 1_000

/** Per-VM config fetch timeout in milliseconds. */
const CONFIG_FETCH_TIMEOUT_MS = 6_000

/** Maximum concurrent config fetches across all connections. */
const CONCURRENCY = 8

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Lightweight row produced by the cluster-resources listing. */
export interface VmRow {
  vmid: number
  name: string
  node: string
  type: string
  connectionId: string
  clusterName?: string
}

/**
 * Resolved VM identity: fields sufficient to correlate a Proxmox VM with a
 * Kubernetes node (by UUID or static IP match).
 */
export interface VmIdentity {
  vmid: number
  name: string
  host: string
  connectionId: string
  clusterName?: string
  uuid: string | null
  ips: string[]
}

// ---------------------------------------------------------------------------
// parseVmIdentity (pure)
// ---------------------------------------------------------------------------

/**
 * Build a VmIdentity from a lightweight VM row and its raw Proxmox config.
 *
 * Pure: no I/O, no side-effects. Delegates UUID and IP parsing to the shared
 * parsers from @/lib/proxmox/vmNetworkConfig.
 */
export function parseVmIdentity(
  row: VmRow,
  config: Record<string, unknown>,
): VmIdentity {
  return {
    vmid: row.vmid,
    name: row.name,
    host: row.node,
    connectionId: row.connectionId,
    ...(row.clusterName !== undefined ? { clusterName: row.clusterName } : {}),
    uuid: parseVmSmbiosUuid(config),
    ips: parseVmStaticIPs(config, row.type),
  }
}

// ---------------------------------------------------------------------------
// buildVmIdentityMap
// ---------------------------------------------------------------------------

interface BuildVmIdentityMapInput {
  connectionFilter: Set<string> | null
}

interface BuildVmIdentityMapResult {
  ok: boolean
  vms: VmIdentity[]
  capped: boolean
  configFetchFailed: number
}

/**
 * Enumerate visible Proxmox connections, list all VMs cheaply, then fetch each
 * VM's config to extract UUID and static IPs.
 *
 * Scope filtering (connectionFilter) is applied BEFORE any config fetch:
 * the Prisma query restricts the connection set so connections outside the
 * filter are never contacted.
 *
 * Per-VM failures are isolated: a single config fetch error increments
 * configFetchFailed and continues; the map is never aborted for one bad VM.
 *
 * Returns ok:true even on partial failure. ok:false is reserved for cases
 * where the connection list itself cannot be loaded.
 */
export async function buildVmIdentityMap(
  input: BuildVmIdentityMapInput,
): Promise<BuildVmIdentityMapResult> {
  const { connectionFilter } = input

  // 1. Load visible PVE connections (scope filter applied at the DB query).
  let connectionRows: Array<{ id: string; name: string; tenantId: string }>
  try {
    const where = connectionFilter !== null
      ? { type: 'pve' as const, id: { in: [...connectionFilter] } }
      : { type: 'pve' as const }
    connectionRows = await prisma.connection.findMany({
      where,
      select: { id: true, name: true, tenantId: true },
      orderBy: { createdAt: 'desc' },
    })
  } catch (err) {
    console.error('[vmIdentity] Failed to load connections:', err)
    return { ok: false, vms: [], capped: false, configFetchFailed: 0 }
  }

  // 2. For each connection, resolve opts ONCE (with explicit tenantId) then
  //    enumerate VMs cheaply via cluster resources. Reusing the same opts for
  //    every VM fetch avoids re-resolving permission checks per VM and prevents
  //    silent drops when the session tenant differs from conn.tenantId (e.g. a
  //    provider fleet view over an MSP-owned connection).
  //    Collect lightweight rows up to VM_SCAN_CAP before fetching configs.

  /** Per-connection resolved opts, keyed by connection id. */
  const connOptsCache = new Map<string, Awaited<ReturnType<typeof getConnectionById>>>()
  const rows: VmRow[] = []
  let capped = false

  for (const conn of connectionRows) {
    if (capped) break
    try {
      // Resolve once with the connection's own tenantId.
      const connOpts = await getConnectionById(conn.id, conn.tenantId)
      connOptsCache.set(conn.id, connOpts)
      const guests = await pveFetch<Array<{
        vmid: number
        name?: string
        node?: string
        type?: string
      }>>(
        connOpts,
        '/cluster/resources?type=vm',
        {},
        { timeoutMs: CONFIG_FETCH_TIMEOUT_MS },
      )
      for (const g of guests ?? []) {
        if (!g?.vmid || !g?.node || !g?.type) continue
        if (rows.length >= VM_SCAN_CAP) {
          capped = true
          break
        }
        rows.push({
          vmid: Number(g.vmid),
          name: g.name ?? `${g.type}/${g.vmid}`,
          node: g.node,
          type: g.type,
          connectionId: conn.id,
          clusterName: conn.name,
        })
      }
    } catch (err) {
      console.error(`[vmIdentity] Failed to list VMs for connection ${conn.id}:`, err)
      // Continue to next connection.
    }
  }

  // 3. Fetch VM configs with bounded concurrency (CONCURRENCY at a time).
  //    Per-VM failures are isolated; configFetchFailed is incremented.
  //    Connection opts are reused from connOptsCache (resolved once per
  //    connection in step 2 with the explicit tenantId).
  const vms: VmIdentity[] = []
  let configFetchFailed = 0

  // Fetch a single row's config, returning a VmIdentity or null on error.
  async function fetchConfig(row: VmRow): Promise<VmIdentity | null> {
    try {
      // Reuse the per-connection opts resolved (with tenantId) in step 2.
      const connOpts = connOptsCache.get(row.connectionId)
      if (!connOpts) return null
      const config = await pveFetch<Record<string, unknown>>(
        connOpts,
        `/nodes/${encodeURIComponent(row.node)}/${row.type}/${row.vmid}/config`,
        {},
        { timeoutMs: CONFIG_FETCH_TIMEOUT_MS },
      )
      return parseVmIdentity(row, config ?? {})
    } catch {
      return null
    }
  }

  // Process in chunks of CONCURRENCY.
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const chunk = rows.slice(i, i + CONCURRENCY)
    const results = await Promise.all(chunk.map(fetchConfig))
    for (const result of results) {
      if (result !== null) {
        vms.push(result)
      } else {
        configFetchFailed++
      }
    }
  }

  return { ok: true, vms, capped, configFetchFailed }
}
