// Capacity model of the resources page. Everything here is derived from what the
// overview already reads from Proxmox (/nodes, /cluster/resources, node and
// storage RRD): no function in this file calls Proxmox.

import { findThresholdDayLinear, linearRegression } from '@/app/(dashboard)/infrastructure/resources/algorithms/linearRegression'

export type Thresholds = {
  cpu: { warning: number; critical: number }
  ram: { warning: number; critical: number }
  storage: { warning: number; critical: number }
}

export type RawNode = {
  node: string
  status: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
}

export type RawGuest = {
  vmid: number
  node: string
  type: string
  status: string
  template?: number | boolean
  maxcpu?: number
  maxmem?: number
  maxdisk?: number
}

export type RawStorage = {
  storage?: string
  node?: string
  status?: string
  shared?: number | boolean
  disk?: number
  maxdisk?: number
  plugintype?: string
  type?: string
}

export type ConnectionSnapshot = {
  id: string
  name: string
  nodes: RawNode[]
  guests: RawGuest[]
  storages: RawStorage[]
}

export type NodeCapacity = {
  key: string
  connectionId: string
  connectionName: string
  node: string
  online: boolean
  cores: number
  cpuPct: number
  memTotal: number
  memUsed: number
  ramPct: number
  vcpuAllocated: number
  ramAllocated: number
  guestsRunning: number
  guestsTotal: number
}

export type NPlusOne = {
  // False when the cluster has fewer than two online nodes: losing one is losing all.
  applicable: boolean
  largestNode: string | null
  cpuPctAfter: number | null
  ramPctAfter: number | null
  ok: boolean | null
}

export type DailyTrend = { t: string; d?: string; cpu: number; ram: number; storage?: number }

export type ClusterCapacity = {
  id: string
  name: string
  nodesOnline: number
  nodesTotal: number
  cpu: { cores: number; usedPct: number; vcpuAllocated: number; ratio: number }
  ram: { total: number; used: number; usedPct: number; allocated: number; ratio: number }
  storage: { used: number; total: number; pct: number }
  guests: { running: number; stopped: number; templates: number }
  nPlusOne: NPlusOne
  // Standard deviation, in percentage points, of node usage inside the cluster.
  imbalance: { cpu: number; ram: number }
  trends: DailyTrend[]
}

export type StoragePoolCapacity = {
  key: string
  name: string
  type: string
  shared: boolean
  connectionId: string
  connectionName: string
  // Null for a shared pool, which belongs to the whole cluster.
  node: string | null
  used: number
  total: number
  pct: number
  growthPctPerDay: number | null
  daysToThreshold: number | null
}

export type StoppedAllocation = { count: number; vcpu: number; ramBytes: number; diskBytes: number }

const round1 = (value: number) => Math.round(value * 10) / 10

const isTemplate = (guest: RawGuest) => guest.template === 1 || guest.template === true

export function nodeKey(connectionId: string, node: string): string {
  return `${connectionId}:${node}`
}

export function buildNodeCapacities(snapshot: ConnectionSnapshot): NodeCapacity[] {
  return snapshot.nodes.map(node => {
    const online = node.status === 'online'
    const cores = node.maxcpu || 0
    const memTotal = node.maxmem || 0
    const memUsed = online ? node.mem || 0 : 0
    const guests = snapshot.guests.filter(guest => guest.node === node.node && !isTemplate(guest))
    const running = guests.filter(guest => guest.status === 'running')

    return {
      key: nodeKey(snapshot.id, node.node),
      connectionId: snapshot.id,
      connectionName: snapshot.name,
      node: node.node,
      online,
      cores,
      cpuPct: online ? round1((node.cpu || 0) * 100) : 0,
      memTotal,
      memUsed,
      ramPct: online && memTotal > 0 ? round1((memUsed / memTotal) * 100) : 0,
      vcpuAllocated: running.reduce((sum, guest) => sum + (guest.maxcpu || 0), 0),
      ramAllocated: running.reduce((sum, guest) => sum + (guest.maxmem || 0), 0),
      guestsRunning: running.length,
      guestsTotal: guests.length,
    }
  })
}

export function standardDeviation(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length

  return round1(Math.sqrt(variance))
}

// Can the cluster lose its largest node (by RAM, the resource HA restarts cannot
// overcommit) and still carry today's load under the critical thresholds?
export function computeNPlusOne(nodes: NodeCapacity[], thresholds: Thresholds): NPlusOne {
  const online = nodes.filter(node => node.online)

  if (online.length < 2) {
    return { applicable: false, largestNode: null, cpuPctAfter: null, ramPctAfter: null, ok: null }
  }

  const largest = online.reduce((best, node) => (node.memTotal > best.memTotal ? node : best), online[0])
  const memTotal = online.reduce((sum, node) => sum + node.memTotal, 0)
  const memUsed = online.reduce((sum, node) => sum + node.memUsed, 0)
  const cores = online.reduce((sum, node) => sum + node.cores, 0)
  const coresUsed = online.reduce((sum, node) => sum + (node.cpuPct / 100) * node.cores, 0)
  const memLeft = memTotal - largest.memTotal
  const coresLeft = cores - largest.cores
  const ramPctAfter = memLeft > 0 ? round1((memUsed / memLeft) * 100) : null
  const cpuPctAfter = coresLeft > 0 ? round1((coresUsed / coresLeft) * 100) : null

  return {
    applicable: true,
    largestNode: largest.node,
    cpuPctAfter,
    ramPctAfter,
    ok: ramPctAfter !== null && cpuPctAfter !== null
      && ramPctAfter <= thresholds.ram.critical
      && cpuPctAfter <= thresholds.cpu.critical,
  }
}

export function computeStoppedAllocation(guests: RawGuest[]): StoppedAllocation {
  const stopped = guests.filter(guest => guest.status === 'stopped' && !isTemplate(guest))

  return {
    count: stopped.length,
    vcpu: stopped.reduce((sum, guest) => sum + (guest.maxcpu || 0), 0),
    ramBytes: stopped.reduce((sum, guest) => sum + (guest.maxmem || 0), 0),
    diskBytes: stopped.reduce((sum, guest) => sum + (guest.maxdisk || 0), 0),
  }
}

export function storageEntryKey(connectionId: string, node: string, storage: string): string {
  return `${connectionId}:${node}:${storage}`
}

// Daily used percentage of one storage on one node, keyed by YYYY-MM-DD.
export type StorageDailyIndex = Map<string, Map<string, number>>

const GROWTH_WINDOW_DAYS = 90

export function storageGrowth(daily: Map<string, number> | undefined, currentPct: number, threshold: number) {
  if (!daily || daily.size < 7) return { growthPctPerDay: null, daysToThreshold: currentPct >= threshold ? 0 : null }

  const series = Array.from(daily.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-GROWTH_WINDOW_DAYS)
    .map(([, pct]) => pct)
  const { slope } = linearRegression(series)

  return {
    growthPctPerDay: Math.round(slope * 1000) / 1000,
    daysToThreshold: findThresholdDayLinear(currentPct, slope, threshold),
  }
}

// A shared storage (Ceph, NFS, iSCSI...) shows up once per node with the same
// figures: it is one pool for the cluster. A local one is a separate pool on each
// node, and dividing it by the node count would hide all but one of them.
export function buildStoragePools(
  snapshots: ConnectionSnapshot[],
  daily: StorageDailyIndex,
  thresholds: Thresholds,
): StoragePoolCapacity[] {
  const pools = new Map<string, StoragePoolCapacity & { series?: Map<string, number> }>()

  for (const snapshot of snapshots) {
    for (const storage of snapshot.storages) {
      if (storage.status !== 'available' || !storage.storage || !storage.node || !(storage.maxdisk && storage.maxdisk > 0)) continue
      const shared = storage.shared === 1 || storage.shared === true
      const key = shared ? `${snapshot.id}::${storage.storage}` : storageEntryKey(snapshot.id, storage.node, storage.storage)
      const series = daily.get(storageEntryKey(snapshot.id, storage.node, storage.storage))
      const existing = pools.get(key)

      if (existing) {
        if (!existing.series?.size && series?.size) existing.series = series
        continue
      }

      const used = storage.disk || 0
      const total = storage.maxdisk

      pools.set(key, {
        key,
        name: storage.storage,
        type: storage.plugintype || storage.type || 'unknown',
        shared,
        connectionId: snapshot.id,
        connectionName: snapshot.name,
        node: shared ? null : storage.node,
        used,
        total,
        pct: round1((used / total) * 100),
        growthPctPerDay: null,
        daysToThreshold: null,
        series,
      })
    }
  }

  return Array.from(pools.values())
    .map(({ series, ...pool }) => ({ ...pool, ...storageGrowth(series, pool.pct, thresholds.storage.critical) }))
    .sort((a, b) => b.pct - a.pct)
}

export function sumPools(pools: StoragePoolCapacity[]): { used: number; total: number } {
  return pools.reduce((acc, pool) => ({ used: acc.used + pool.used, total: acc.total + pool.total }), { used: 0, total: 0 })
}

export function buildClusterCapacity(
  snapshot: ConnectionSnapshot,
  nodes: NodeCapacity[],
  pools: StoragePoolCapacity[],
  thresholds: Thresholds,
  trends: DailyTrend[],
): ClusterCapacity {
  const online = nodes.filter(node => node.online)
  const cores = online.reduce((sum, node) => sum + node.cores, 0)
  const coresUsed = online.reduce((sum, node) => sum + (node.cpuPct / 100) * node.cores, 0)
  const memTotal = online.reduce((sum, node) => sum + node.memTotal, 0)
  const memUsed = online.reduce((sum, node) => sum + node.memUsed, 0)
  const vcpuAllocated = nodes.reduce((sum, node) => sum + node.vcpuAllocated, 0)
  const ramAllocated = nodes.reduce((sum, node) => sum + node.ramAllocated, 0)
  const storage = sumPools(pools.filter(pool => pool.connectionId === snapshot.id))
  const guests = snapshot.guests

  return {
    id: snapshot.id,
    name: snapshot.name,
    nodesOnline: online.length,
    nodesTotal: nodes.length,
    cpu: {
      cores,
      usedPct: cores > 0 ? round1((coresUsed / cores) * 100) : 0,
      vcpuAllocated,
      ratio: cores > 0 ? Math.round((vcpuAllocated / cores) * 100) / 100 : 0,
    },
    ram: {
      total: memTotal,
      used: memUsed,
      usedPct: memTotal > 0 ? round1((memUsed / memTotal) * 100) : 0,
      allocated: ramAllocated,
      ratio: memTotal > 0 ? Math.round((ramAllocated / memTotal) * 100) / 100 : 0,
    },
    storage: { ...storage, pct: storage.total > 0 ? round1((storage.used / storage.total) * 100) : 0 },
    guests: {
      running: guests.filter(guest => guest.status === 'running' && !isTemplate(guest)).length,
      stopped: guests.filter(guest => guest.status === 'stopped' && !isTemplate(guest)).length,
      templates: guests.filter(isTemplate).length,
    },
    nPlusOne: computeNPlusOne(nodes, thresholds),
    imbalance: {
      cpu: standardDeviation(online.map(node => node.cpuPct)),
      ram: standardDeviation(online.map(node => node.ramPct)),
    },
    trends,
  }
}

/** The KPIs of one scope that the health score reads. */
export type ScopeKpis = {
  cpu: { used: number; allocated: number; total: number; trend: number }
  ram: { used: number; allocated: number; total: number; trend: number }
  storage: { used: number; total: number; trend: number }
  vms: { total: number; running: number; stopped: number }
  efficiency: number
}

/**
 * KPIs of one cluster, worked out as the overview does when that cluster alone is
 * selected (usage of the online nodes, allocation of the running guests, same
 * efficiency formula), so a cluster's health score can be recorded every day
 * without anyone opening its view.
 */
export function clusterKpis(cluster: ClusterCapacity): ScopeKpis {
  const efficiencyOf = (usedPct: number, allocated: number, total: number) => {
    if (allocated <= 0 || total <= 0) return 100

    return Math.min(100, (usedPct / ((allocated / total) * 100)) * 100)
  }
  const cpuEfficiency = efficiencyOf(cluster.cpu.usedPct, cluster.cpu.vcpuAllocated, cluster.cpu.cores)
  const ramEfficiency = efficiencyOf(cluster.ram.usedPct, cluster.ram.allocated, cluster.ram.total)

  return {
    cpu: { used: cluster.cpu.usedPct, allocated: cluster.cpu.vcpuAllocated, total: cluster.cpu.cores, trend: 0 },
    ram: { used: cluster.ram.usedPct, allocated: cluster.ram.allocated, total: cluster.ram.total, trend: 0 },
    storage: { used: cluster.storage.used, total: cluster.storage.total, trend: 0 },
    vms: { total: cluster.guests.running + cluster.guests.stopped, running: cluster.guests.running, stopped: cluster.guests.stopped },
    efficiency: Math.round((cpuEfficiency + ramEfficiency) / 2),
  }
}
