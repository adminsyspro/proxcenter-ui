// Resolve the effective Green-IT config for a (connection, node) pair by
// walking the inheritance chain: node → cluster → datacentre → constants.
// The datacentre owns its own server-spec defaults (TDP/core, W/GB RAM,
// overhead) plus the energy parameters (PUE, electricity, CO₂ factor), so
// the chain is self-contained and doesn't fall back on a global settings
// row anymore.

import { getConnectionGreenConfig, getNodeGreenConfig } from '@/lib/db/greenConfig'
import {
  ensureDefaultDatacenter, getDatacenterById, type DatacenterRow,
} from '@/lib/db/datacenters'

export interface ResolvedGreenConfig {
  datacenter: {
    id: string | null
    name: string
    pue: number
    electricityPrice: number
    currency: string
    co2Factor: number
  }
  tdpPerCore: number
  wattsPerGbRam: number
  overheadPerNode: number
}

interface CacheEntry {
  data: ResolvedGreenConfig
  expiry: number
}

const cache = new Map<string, CacheEntry>()
const TTL_MS = 30_000

// Hard-coded constants for the bottom of the inheritance chain — only used
// when even the Default DC can't be created (no settings row, broken DB).
const HARDCODED_DEFAULTS = {
  pue: 1.4,
  electricityPrice: 0.18,
  currency: 'EUR',
  co2Factor: 0.052,
  tdpPerCore: 10,
  wattsPerGbRam: 0.375,
  overheadPerNode: 50,
}

function fromDatacenter(dc: DatacenterRow): ResolvedGreenConfig['datacenter'] {
  return {
    id: dc.id,
    name: dc.name,
    pue: dc.pue,
    electricityPrice: dc.electricityPrice,
    currency: dc.currency,
    co2Factor: dc.co2Factor,
  }
}

/**
 * Resolves the effective config for a node. Walks node → cluster → DC →
 * hardcoded constants for each spec field; resolves the datacentre row
 * from the most specific level that points to one. Caches results for
 * 30 s — invalidate on any green-config write via
 * {@link invalidateGreenResolution}.
 */
export async function resolveGreenConfigForNode(
  connectionId: string,
  nodeName: string,
): Promise<ResolvedGreenConfig> {
  const cacheKey = `${connectionId}|${nodeName}`
  const cached = cache.get(cacheKey)

  if (cached && cached.expiry > Date.now()) return cached.data

  const node = await getNodeGreenConfig(connectionId, nodeName)
  const cluster = await getConnectionGreenConfig(connectionId)

  // Datacentre: most specific non-null DC ID wins; fall back to is_default DC.
  let dcRow: DatacenterRow | null = null

  if (node?.datacenterId) dcRow = await getDatacenterById(node.datacenterId)
  if (!dcRow && cluster?.datacenterId) dcRow = await getDatacenterById(cluster.datacenterId)
  if (!dcRow) dcRow = await ensureDefaultDatacenter()

  const datacenter: ResolvedGreenConfig['datacenter'] = dcRow
    ? fromDatacenter(dcRow)
    : {
      id: null,
      name: 'Default',
      pue: HARDCODED_DEFAULTS.pue,
      electricityPrice: HARDCODED_DEFAULTS.electricityPrice,
      currency: HARDCODED_DEFAULTS.currency,
      co2Factor: HARDCODED_DEFAULTS.co2Factor,
    }

  const tdpPerCore = node?.tdpPerCoreW
    ?? cluster?.tdpPerCoreW
    ?? dcRow?.tdpPerCoreW
    ?? HARDCODED_DEFAULTS.tdpPerCore

  const wattsPerGbRam = node?.wattsPerGbRam
    ?? cluster?.wattsPerGbRam
    ?? dcRow?.wattsPerGbRam
    ?? HARDCODED_DEFAULTS.wattsPerGbRam

  const overheadPerNode = node?.overheadPerNodeW
    ?? cluster?.overheadPerNodeW
    ?? dcRow?.overheadPerNodeW
    ?? HARDCODED_DEFAULTS.overheadPerNode

  const resolved: ResolvedGreenConfig = {
    datacenter,
    tdpPerCore,
    wattsPerGbRam,
    overheadPerNode,
  }

  cache.set(cacheKey, { data: resolved, expiry: Date.now() + TTL_MS })

return resolved
}

export function invalidateGreenResolution(connectionId?: string, nodeName?: string) {
  if (connectionId && nodeName) {
    cache.delete(`${connectionId}|${nodeName}`)

return
  }

  if (connectionId) {
    for (const k of cache.keys()) if (k.startsWith(`${connectionId}|`)) cache.delete(k)

return
  }

  cache.clear()
}
