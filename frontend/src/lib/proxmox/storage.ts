import { formatBytes } from '@/utils/format'

/** File-based storage types that support PVE download-url API */
export const FILE_BASED_STORAGE_TYPES = ["dir", "nfs", "cifs", "glusterfs", "cephfs", "btrfs"] as const

export function isFileBasedStorage(type: string): boolean {
  return FILE_BASED_STORAGE_TYPES.includes(type as any)
}

/** Storage types that are inherently shared across cluster nodes */
export const SHARED_STORAGE_TYPES = ["rbd", "cephfs", "nfs", "cifs", "glusterfs", "iscsi", "iscsidirect", "zfs", "pbs"] as const

/**
 * Check if a storage is shared, using both the PVE `shared` flag AND type-based detection.
 * This guards against transient API responses where the `shared` field is missing or 0
 * for inherently-shared backends like RBD/Ceph during cluster events (issue #249).
 */
export function isSharedStorage(storage: { shared?: number | boolean; type?: string }): boolean {
  return !!storage.shared || SHARED_STORAGE_TYPES.includes(storage.type as any)
}

/** Storage types that support VM disk images (content type "images") */
export const VM_DISK_STORAGE_TYPES = ["dir", "nfs", "cifs", "glusterfs", "btrfs", "rbd", "lvm", "lvmthin", "zfspool", "zfs"] as const

export function supportsVmDisks(type: string): boolean {
  return VM_DISK_STORAGE_TYPES.includes(type as any)
}

export type RawStorageEntry = {
  connId: string
  connName: string
  node: string
  storage: string
  type: string
  shared?: boolean | number
  used: number
  total: number
  content?: string[]
  enabled?: boolean
  status?: string
  path?: string | null
  server?: string | null
  export?: string | null
  pool?: string | null
  monhost?: string | null
  fsName?: string | null
  datastore?: string | null
}

export type StorageNodeUsage = {
  node: string
  used: number
  total: number
  usedPct: number
  usedFormatted: string
  totalFormatted: string
}

export type AggregatedStorage = {
  id: string
  storage: string
  type: string
  shared: boolean
  connId: string
  connName: string
  connectionName: string
  connections: { id: string; name: string }[]
  node: string
  allNodes: string[]
  used: number
  total: number
  usedPct: number
  free: number
  usedFormatted: string
  totalFormatted: string
  freeFormatted: string
  nodeBreakdown: StorageNodeUsage[]
  content: string[]
  enabled: boolean
  status: string
  path?: string | null
  server?: string | null
  export?: string | null
  pool?: string | null
  monhost?: string | null
  fsName?: string | null
  datastore?: string | null
}

function storagePct(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100 * 10) / 10 : 0
}

function toNodeUsage(node: string, used: number, total: number): StorageNodeUsage {
  return {
    node,
    used,
    total,
    usedPct: storagePct(used, total),
    usedFormatted: formatBytes(used),
    totalFormatted: formatBytes(total),
  }
}

export function normalizeStorageEntry(raw: any): RawStorageEntry {
  const used = Number(raw.used ?? raw.disk ?? 0)
  const total = Number(raw.total ?? raw.maxdisk ?? 0)

  return {
    connId: raw.connId,
    connName: raw.connName ?? raw.connectionName ?? '',
    node: raw.node || '',
    storage: raw.storage,
    type: raw.type || raw.plugintype || 'unknown',
    shared: raw.shared === 1 || raw.shared === true,
    used,
    total,
    content: Array.isArray(raw.content)
      ? raw.content
      : (raw.content ? String(raw.content).split(',') : []),
    enabled: raw.enabled !== false && raw.disable !== 1,
    status: raw.status,
    path: raw.path ?? null,
    server: raw.server ?? null,
    export: raw.export ?? null,
    pool: raw.pool ?? null,
    monhost: raw.monhost ?? null,
    fsName: raw.fsName ?? raw['fs-name'] ?? null,
    datastore: raw.datastore ?? null,
  }
}

/**
 * Aggregate raw per-node storage entries into one row per (connId, storage).
 * Never merges across connections. Shared storages collapse to the pool;
 * local storages sum across nodes with a per-node breakdown.
 */
export function aggregateStorage(entries: RawStorageEntry[]): AggregatedStorage[] {
  const groups = new Map<string, RawStorageEntry[]>()

  for (const e of entries) {
    const key = `${e.connId}:${e.storage}`
    const arr = groups.get(key)

    if (arr) arr.push(e)
    else groups.set(key, [e])
  }

  const result: AggregatedStorage[] = []

  for (const [key, group] of groups) {
    const rep = group[0]
    const shared = group.some(e => isSharedStorage(e))

    const allNodes = Array.from(
      new Set(group.map(e => e.node).filter((n): n is string => !!n))
    )

    let used = 0
    let total = 0
    const nodeBreakdown: StorageNodeUsage[] = []

    if (shared) {
      const withCap = group.find(e => Number(e.total) > 0)

      used = withCap ? Number(withCap.used) || 0 : 0
      total = withCap ? Number(withCap.total) || 0 : 0
      nodeBreakdown.push(toNodeUsage(withCap?.node || allNodes[0] || '', used, total))
    } else {
      const byNode = new Map<string, RawStorageEntry>()

      for (const e of group) {
        if (!byNode.has(e.node)) byNode.set(e.node, e)
      }
      for (const e of byNode.values()) {
        const u = Number(e.used) || 0
        const t = Number(e.total) || 0

        used += u
        total += t
        nodeBreakdown.push(toNodeUsage(e.node, u, t))
      }
    }

    const usedPct = storagePct(used, total)
    const free = Math.max(0, total - used)

    result.push({
      id: key,
      storage: rep.storage,
      type: rep.type,
      shared,
      connId: rep.connId,
      connName: rep.connName,
      connectionName: rep.connName,
      connections: [{ id: rep.connId, name: rep.connName }],
      node: allNodes[0] || rep.node || '',
      allNodes,
      used,
      total,
      usedPct,
      free,
      usedFormatted: formatBytes(used),
      totalFormatted: formatBytes(total),
      freeFormatted: formatBytes(free),
      nodeBreakdown,
      content: rep.content || [],
      enabled: rep.enabled !== false,
      status: group.some(e => e.status === 'available' || e.status === 'active')
        ? 'available'
        : (rep.status || 'unknown'),
      path: rep.path ?? null,
      server: rep.server ?? null,
      export: rep.export ?? null,
      pool: rep.pool ?? null,
      monhost: rep.monhost ?? null,
      fsName: rep.fsName ?? null,
      datastore: rep.datastore ?? null,
    })
  }

  return result
}
