/**
 * Storage ranking for the agentic assistant (#459).
 *
 * Answers "what is the biggest storage device?" and "which storage device has
 * the least free space?", neither of which the snapshot in
 * `@/lib/tools/snapshot` can answer: it carries guests and hosts, not pools.
 *
 * The whole difficulty is the aggregation, and it is deliberately NOT
 * reimplemented here. Proxmox reports a shared pool (Ceph RBD, CephFS, NFS)
 * once per node in `/cluster/resources`, so a naive sum makes a three-node
 * Ceph cluster look like three times its real capacity and every ranking
 * derived from it is wrong. `aggregateStorage` already collapses shared pools
 * to a single row and sums local ones per node, exactly as
 * `/api/v1/storage` does, so both views agree on what a pool holds.
 */

import { pveFetch } from '@/lib/proxmox/client'
import { getConnectionById, type PveConn } from '@/lib/connections/getConnection'
import { resolveStorageCaller, storageVisibilityFilter } from '@/lib/storage/storageVisibility'
import {
  normalizeStorageEntry,
  aggregateStorage,
  isSharedStorage,
  type RawStorageEntry,
} from '@/lib/proxmox/storage'

import {
  argEnum,
  argNumber,
  argString,
  resolveConnection,
  visibleConnections,
  ToolArgumentError,
  ToolScopeError,
  type ToolContext,
  type CatalogTool,
  type ResolvedConnection,
} from './types'

const BYTES_PER_GB = 1024 * 1024 * 1024

const METRICS = ['total', 'free', 'used_pct'] as const

/** Values a model sends to mean "no content filter". */
const NO_CONTENT_FILTER = new Set(['none', 'all', 'any', '*'])

type StorageMetric = (typeof METRICS)[number]

function gb(bytes: unknown, digits = 1): number {
  const value = Number(bytes)

  if (!Number.isFinite(value) || value <= 0) return 0

  return Number((value / BYTES_PER_GB).toFixed(digits))
}

/**
 * Raw per-node storage rows for one connection, or null when the connection
 * could not be read at all.
 *
 * `/cluster/resources` is the only source of used/total, so losing it means
 * losing the connection. Losing `/storage` alone only costs the backend type
 * and the content list, which is a degradation worth keeping the rows for.
 */
async function collectConnectionStorage(
  connection: ResolvedConnection,
  tenantId: string
): Promise<RawStorageEntry[] | null> {
  let conn: PveConn

  try {
    conn = await getConnectionById(connection.id, tenantId)
  } catch (e) {
    console.error(`[ai:rank_storage] Cannot load connection ${connection.name}:`, e)

    return null
  }

  const [resourcesResult, configResult] = await Promise.allSettled([
    pveFetch<any[]>(conn, '/cluster/resources?type=storage'),
    pveFetch<any[]>(conn, '/storage'),
  ])

  if (resourcesResult.status === 'rejected') {
    console.error(`[ai:rank_storage] ${connection.name} unreachable:`, resourcesResult.reason)

    return null
  }

  const resources = Array.isArray(resourcesResult.value) ? resourcesResult.value : []
  const configs = configResult.status === 'fulfilled' && Array.isArray(configResult.value)
    ? configResult.value
    : []

  const configByStorage = new Map<string, any>()

  for (const cfg of configs) {
    if (cfg?.storage) configByStorage.set(cfg.storage, cfg)
  }

  const entries: RawStorageEntry[] = []

  for (const resource of resources) {
    if (!resource?.storage) continue

    const config = configByStorage.get(resource.storage) || {}

    // `/cluster/resources` labels every row `type: 'storage'`; the real backend
    // type lives in the /storage config, with `plugintype` as the fallback.
    const type = config.type || resource.plugintype || 'unknown'

    entries.push(
      normalizeStorageEntry({
        connId: connection.id,
        connName: connection.name,
        node: resource.node,
        storage: resource.storage,
        type,
        // Resolved here rather than left to aggregateStorage: a transient PVE
        // response can omit `shared` on an inherently shared backend (#249),
        // and a pool that is not marked shared gets summed per node instead of
        // collapsed, which is the 3x capacity bug this tool must never report.
        shared: isSharedStorage({ shared: config.shared ?? resource.shared, type }) ? 1 : 0,
        disk: resource.disk,
        maxdisk: resource.maxdisk,
        content: config.content ?? resource.content,
        disable: config.disable,
        status: resource.status || (resource.disk !== undefined ? 'available' : 'unknown'),
      })
    )
  }

  return entries
}

/**
 * One row per device: a shared pool once, a local pool once per host.
 *
 * `aggregateStorage` sums a local pool across the hosts that carry it, which is
 * right for the storage dashboard's cluster totals and wrong here. Against the
 * lab it reported three 96 GB ZFS-Pool as one 289 GB device, and hid
 * local@pve1, 5.9 GB free, behind the summed `local` when asked which storage
 * had the least free space.
 */
function rankableStorage(entries: RawStorageEntry[]) {
  const localByNode = new Map<string, RawStorageEntry[]>()

  for (const entry of entries) {
    if (isSharedStorage(entry)) continue

    const key = `${entry.connId}:${entry.node}`

    localByNode.set(key, [...(localByNode.get(key) ?? []), entry])
  }

  return [
    ...aggregateStorage(entries.filter(entry => isSharedStorage(entry))),
    ...[...localByNode.values()].flatMap(group => aggregateStorage(group)),
  ]
}

type RankableStorage = { total: number; free: number; usedPct: number }

function sortByMetric(metric: StorageMetric) {
  return (a: RankableStorage, b: RankableStorage) => {
    // `free` ascending: the question is which pool has the LEAST free space.
    if (metric === 'free') return a.free - b.free
    if (metric === 'used_pct') return b.usedPct - a.usedPct

    return b.total - a.total
  }
}

function matchesContent(contentTypes: string[], wanted: string): boolean {
  return contentTypes.some(c => c.trim().toLowerCase() === wanted)
}

/** Which connections to sweep. The snapshot is already RBAC-filtered. */
function targetConnections(ctx: ToolContext, clusterRef?: string): ResolvedConnection[] {
  if (clusterRef) return [resolveConnection(ctx, clusterRef)]

  const all = visibleConnections(ctx.snapshot)

  if (all.length === 0) throw new ToolScopeError('No cluster is visible to you.')

  return all
}

export const rankStorageTool: CatalogTool = {
  name: 'rank_storage',
  readOnly: true,

  description:
    'Rank storage pools by size, free space or fill level. Answers "what is the biggest storage?" and "which storage has the least free space?". Shared pools (Ceph, NFS) count once; a local pool is ranked once per host, with its host. Example: metric=\'free\', limit=5',

  parameters: {
    type: 'object',
    properties: {
      metric: {
        type: 'string',
        description: 'What to rank on: total capacity, free space (smallest first) or fill percentage.',
        enum: [...METRICS],
        default: 'total',
      },
      limit: {
        type: 'integer',
        description: 'How many storages to return.',
        default: 10,
        minimum: 1,
        maximum: 50,
      },
      cluster: {
        type: 'string',
        description: 'Cluster name, only when the user names one. Omit it to rank across every visible cluster.',
      },
      content: {
        type: 'string',
        description: 'Keep only storages holding this content type, for example images, backup or iso.',
      },
    },
  },

  async execute(args, ctx) {
    const metric = argEnum<StorageMetric>(args, 'metric', METRICS, 'total')
    const limit = argNumber(args, 'limit', 10, { min: 1, max: 50 })
    // llama3.1:8b pads unused arguments with Python's "None"; read as a
    // filter, it matched nothing and the model made up a ranking.
    const rawContent = argString(args, 'content')?.toLowerCase()
    const content = rawContent && !NO_CONTENT_FILTER.has(rawContent) ? rawContent : undefined

    const connections = targetConnections(ctx, argString(args, 'cluster'))

    const collected = await Promise.all(
      connections.map(async connection => {
        // The storage list route's own rule (vDC mask, guest perimeter, node
        // or storage scope): the snapshot carries no storage to resolve on.
        const caller = await resolveStorageCaller(connection.id)

        if (!caller.allowed) return { connection, entries: [] as RawStorageEntry[] }

        const [entries, visible] = await Promise.all([
          collectConnectionStorage(connection, ctx.tenantId),
          storageVisibilityFilter(connection.id, ctx.tenantId, caller),
        ])

        return { connection, entries: entries === null ? null : entries.filter(e => visible(e)) }
      })
    )

    const unavailable: string[] = []
    const rawEntries: RawStorageEntry[] = []

    for (const { connection, entries } of collected) {
      if (entries === null) {
        unavailable.push(connection.name)
        continue
      }

      rawEntries.push(...entries)
    }

    let pools = rankableStorage(rawEntries)

    if (content) {
      const present = [...new Set(pools.flatMap(pool => pool.content || []))].sort((a, b) => a.localeCompare(b))

      pools = pools.filter(pool => matchesContent(pool.content || [], content))

      // An empty ranking is something a small model fills in on its own.
      if (pools.length === 0) {
        throw new ToolArgumentError(`No storage holds content "${content}". Content types present: ${present.join(', ') || 'none'}. Omit "content" to rank every storage.`)
      }
    }

    // A disabled or unreachable storage reports 0/0. Left in, it wins the
    // "least free space" ranking with 0 bytes free and buries the pool that is
    // genuinely about to fill up.
    const inactive = pools
      .filter(pool => !(pool.total > 0))
      .map(pool => `${pool.storage} (${pool.connName})`)

    const eligible = pools.filter(pool => pool.total > 0)

    const ranking = [...eligible]
      .sort(sortByMetric(metric))
      .slice(0, limit)
      .map((pool, index) => ({
        rank: index + 1,
        name: pool.storage,
        cluster: pool.connName,
        // Null for a shared pool, which no single host owns.
        host: pool.shared ? null : (pool.allNodes[0] ?? null),
        type: pool.type,
        shared: pool.shared,
        totalGb: gb(pool.total),
        usedGb: gb(pool.used),
        freeGb: gb(pool.free),
        usedPct: pool.usedPct,
        contentTypes: pool.content || [],
        nodeCount: pool.allNodes.length,
      }))

    return {
      metric,
      unit: 'GB',
      totalConsidered: eligible.length,
      unavailable,
      inactive,
      ranking,
    }
  },
}
