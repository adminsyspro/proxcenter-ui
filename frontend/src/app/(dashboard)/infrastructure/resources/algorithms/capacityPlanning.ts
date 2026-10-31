import type { ClusterCapacity, KpiData, NodeCapacity, PredictiveAlert, ResourceThresholds, StoppedAllocation, StoragePool } from '../types'
import { calculateImprovedPredictions } from './improvedPrediction'

const GiB = 1024 ** 3

// A VM size used to express headroom as "how many more VMs fit".
export type VmTemplate = { vcpu: number; ramGiB: number }

export type PlanningAssumptions = {
  template: VmTemplate
  // vCPU:pCPU ratio the team accepts; vCPU headroom is measured against it.
  maxVcpuRatio: number
}

export const VM_TEMPLATE_PRESETS: Record<'s' | 'm' | 'l' | 'xl', VmTemplate> = {
  s: { vcpu: 2, ramGiB: 4 },
  m: { vcpu: 4, ramGiB: 8 },
  l: { vcpu: 8, ramGiB: 16 },
  xl: { vcpu: 16, ramGiB: 64 },
}

export const DEFAULT_ASSUMPTIONS: PlanningAssumptions = { template: VM_TEMPLATE_PRESETS.m, maxVcpuRatio: 4 }

export type CapacityPool = {
  cores: number
  coresUsed: number
  vcpuAllocated: number
  ramTotal: number
  ramUsed: number
}

export type Headroom = { byRam: number; byCpu: number; count: number; limitedBy: 'ram' | 'cpu' | null }

export function poolFromClusters(clusters: ClusterCapacity[]): CapacityPool {
  return clusters.reduce<CapacityPool>((acc, c) => ({
    cores: acc.cores + c.cpu.cores,
    coresUsed: acc.coresUsed + (c.cpu.usedPct / 100) * c.cpu.cores,
    vcpuAllocated: acc.vcpuAllocated + c.cpu.vcpuAllocated,
    ramTotal: acc.ramTotal + c.ram.total,
    ramUsed: acc.ramUsed + c.ram.used,
  }), { cores: 0, coresUsed: 0, vcpuAllocated: 0, ramTotal: 0, ramUsed: 0 })
}

// How many VMs of the template still fit: RAM up to its warning threshold, vCPU up
// to the accepted overcommit ratio. The tighter of the two wins.
export function computeHeadroom(pool: CapacityPool, assumptions: PlanningAssumptions, thresholds: ResourceThresholds): Headroom {
  const { template, maxVcpuRatio } = assumptions
  const ramRoom = pool.ramTotal * (thresholds.ram.warning / 100) - pool.ramUsed
  const vcpuRoom = pool.cores * maxVcpuRatio - pool.vcpuAllocated
  const byRam = template.ramGiB > 0 ? Math.max(0, Math.floor(ramRoom / (template.ramGiB * GiB))) : 0
  const byCpu = template.vcpu > 0 ? Math.max(0, Math.floor(vcpuRoom / template.vcpu)) : 0

  if (pool.cores === 0 && pool.ramTotal === 0) return { byRam: 0, byCpu: 0, count: 0, limitedBy: null }

  return { byRam, byCpu, count: Math.min(byRam, byCpu), limitedBy: byRam <= byCpu ? 'ram' : 'cpu' }
}

export type Scenario = {
  addVms: number
  loseLargestNode: boolean
  addNodes: number
}

export type ScenarioResult = {
  pool: CapacityPool
  ramPct: number
  cpuPct: number
  vcpuRatio: number
  headroom: Headroom
  ramOk: boolean
  cpuOk: boolean
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0)

// What-if on the selected scope. New VMs are counted at their full RAM (a running
// KVM guest ends up holding most of it) and at the CPU the current guests draw per
// vCPU; added nodes copy the largest online one; a lost node is the largest one.
export function simulateScenario(
  nodes: NodeCapacity[],
  scenario: Scenario,
  assumptions: PlanningAssumptions,
  thresholds: ResourceThresholds,
): ScenarioResult {
  const online = nodes.filter(n => n.online)
  const largest = online.reduce<NodeCapacity | null>((best, n) => (!best || n.memTotal > best.memTotal ? n : best), null)

  let pool: CapacityPool = online.reduce<CapacityPool>((acc, n) => ({
    cores: acc.cores + n.cores,
    coresUsed: acc.coresUsed + (n.cpuPct / 100) * n.cores,
    vcpuAllocated: acc.vcpuAllocated + n.vcpuAllocated,
    ramTotal: acc.ramTotal + n.memTotal,
    ramUsed: acc.ramUsed + n.memUsed,
  }), { cores: 0, coresUsed: 0, vcpuAllocated: 0, ramTotal: 0, ramUsed: 0 })

  const cpuPerVcpu = pool.vcpuAllocated > 0 ? pool.coresUsed / pool.vcpuAllocated : 0
  const { template } = assumptions
  const addVms = Math.max(0, Math.floor(scenario.addVms))
  const addNodes = Math.max(0, Math.floor(scenario.addNodes))

  pool = {
    ...pool,
    vcpuAllocated: pool.vcpuAllocated + addVms * template.vcpu,
    coresUsed: pool.coresUsed + addVms * template.vcpu * cpuPerVcpu,
    ramUsed: pool.ramUsed + addVms * template.ramGiB * GiB,
  }

  if (largest && addNodes > 0) {
    pool = { ...pool, cores: pool.cores + addNodes * largest.cores, ramTotal: pool.ramTotal + addNodes * largest.memTotal }
  }

  if (largest && scenario.loseLargestNode && online.length + addNodes > 1) {
    pool = { ...pool, cores: pool.cores - largest.cores, ramTotal: pool.ramTotal - largest.memTotal }
  }

  const ramPct = pct(pool.ramUsed, pool.ramTotal)
  const cpuPct = pct(pool.coresUsed, pool.cores)

  return {
    pool,
    ramPct,
    cpuPct,
    vcpuRatio: pool.cores > 0 ? Math.round((pool.vcpuAllocated / pool.cores) * 100) / 100 : 0,
    headroom: computeHeadroom(pool, assumptions, thresholds),
    ramOk: ramPct <= thresholds.ram.critical,
    cpuOk: cpuPct <= thresholds.cpu.critical,
  }
}

export type ClusterRunway = { clusterId: string; alerts: PredictiveAlert[]; soonest: PredictiveAlert | null }

// Runway of one cluster, with the forecast the page already uses for the whole
// estate, fed with that cluster's own daily history.
export function computeClusterRunway(cluster: ClusterCapacity, thresholds: ResourceThresholds, historyDays: number): ClusterRunway {
  const kpis: KpiData = {
    cpu: { used: cluster.cpu.usedPct, allocated: cluster.cpu.vcpuAllocated, total: cluster.cpu.cores, trend: 0 },
    ram: { used: cluster.ram.usedPct, allocated: cluster.ram.allocated, total: cluster.ram.total, trend: 0 },
    storage: { used: cluster.storage.used, total: cluster.storage.total, trend: 0 },
    vms: { total: cluster.guests.running + cluster.guests.stopped, running: cluster.guests.running, stopped: cluster.guests.stopped },
    efficiency: 0,
  }
  const { alerts } = calculateImprovedPredictions(kpis, cluster.trends.slice(-historyDays), thresholds)
  const soonest = alerts
    .filter(a => a.daysToThreshold !== null)
    .sort((a, b) => (a.daysToThreshold ?? 0) - (b.daysToThreshold ?? 0))[0] ?? null

  return { clusterId: cluster.id, alerts, soonest }
}

export type ActionSeverity = 'critical' | 'warning' | 'info'

export type ActionTab = 'capacity' | 'simulation' | 'efficiency'

/** Where an item leads on the page: a section, and the row (or row group) to point at. */
export type ActionSection = 'clusters' | 'nodes' | 'pools' | 'simulator' | 'efficiency'

export type ActionTarget = { section: ActionSection; key?: string }

export type ActionItem = {
  id: string
  severity: ActionSeverity
  // i18n key under resources.actions.*
  kind: 'runway' | 'nPlusOne' | 'nPlusOneEmpty' | 'poolRunway' | 'poolFull' | 'nodeOffline' | 'imbalance' | 'dormant'
  params: Record<string, string | number>
  tab: ActionTab
  target: ActionTarget
}

const IMBALANCE_WARNING_POINTS = 15
const SEVERITY_ORDER: Record<ActionSeverity, number> = { critical: 0, warning: 1, info: 2 }

export function buildActionItems(input: {
  clusters: ClusterCapacity[]
  runways: ClusterRunway[]
  nodes: NodeCapacity[]
  pools: StoragePool[]
  stopped: StoppedAllocation | null
  thresholds: ResourceThresholds
}): ActionItem[] {
  const items: ActionItem[] = []
  const { clusters, runways, nodes, pools, stopped, thresholds } = input
  const clusterName = (id: string) => clusters.find(c => c.id === id)?.name ?? id

  for (const runway of runways) {
    for (const alert of runway.alerts) {
      if (alert.severity === 'ok' || alert.daysToThreshold === null) continue
      items.push({
        id: `runway:${runway.clusterId}:${alert.resource}`,
        severity: alert.severity === 'critical' ? 'critical' : 'warning',
        kind: 'runway',
        params: { cluster: clusterName(runway.clusterId), resource: alert.resource, days: alert.daysToThreshold, threshold: alert.threshold },
        tab: 'capacity',
        target: { section: 'clusters', key: runway.clusterId },
      })
    }
  }

  for (const cluster of clusters) {
    if (cluster.nPlusOne.applicable && cluster.nPlusOne.ok === false) {
      items.push({
        id: `n1:${cluster.id}`,
        severity: 'critical',
        // No figure when the remaining nodes report no capacity at all.
        kind: cluster.nPlusOne.ramPctAfter === null || cluster.nPlusOne.cpuPctAfter === null ? 'nPlusOneEmpty' : 'nPlusOne',
        params: {
          cluster: cluster.name,
          node: cluster.nPlusOne.largestNode ?? '',
          ram: cluster.nPlusOne.ramPctAfter ?? 0,
          cpu: cluster.nPlusOne.cpuPctAfter ?? 0,
        },
        tab: 'simulation',
        target: { section: 'simulator', key: cluster.id },
      })
    }
    if (cluster.imbalance.ram >= IMBALANCE_WARNING_POINTS) {
      items.push({ id: `imb:${cluster.id}`, severity: 'warning', kind: 'imbalance', params: { cluster: cluster.name, points: cluster.imbalance.ram }, tab: 'capacity', target: { section: 'nodes', key: cluster.id } })
    }
  }

  for (const node of nodes) {
    if (!node.online) {
      items.push({ id: `off:${node.key}`, severity: 'critical', kind: 'nodeOffline', params: { cluster: node.connectionName, node: node.node }, tab: 'capacity', target: { section: 'nodes', key: node.key } })
    }
  }

  for (const pool of pools) {
    const where = pool.node ? `${pool.name} (${pool.node})` : pool.name
    if (pool.pct >= thresholds.storage.critical) {
      items.push({ id: `full:${pool.key}`, severity: 'critical', kind: 'poolFull', params: { pool: where, cluster: pool.connectionName, pct: pool.pct }, tab: 'capacity', target: { section: 'pools', key: pool.key } })
    } else if (pool.daysToThreshold !== null && pool.daysToThreshold <= 30) {
      items.push({
        id: `pool:${pool.key}`,
        severity: pool.daysToThreshold <= 14 ? 'critical' : 'warning',
        kind: 'poolRunway',
        params: { pool: where, cluster: pool.connectionName, days: pool.daysToThreshold },
        tab: 'capacity',
        target: { section: 'pools', key: pool.key },
      })
    } else if (pool.pct >= thresholds.storage.warning) {
      items.push({ id: `full:${pool.key}`, severity: 'warning', kind: 'poolFull', params: { pool: where, cluster: pool.connectionName, pct: pool.pct }, tab: 'capacity', target: { section: 'pools', key: pool.key } })
    }
  }

  if (stopped && stopped.count > 0 && stopped.ramBytes >= 64 * GiB) {
    items.push({
      id: 'dormant',
      severity: 'info',
      kind: 'dormant',
      params: { count: stopped.count, ramGiB: Math.round(stopped.ramBytes / GiB), vcpu: stopped.vcpu },
      tab: 'efficiency',
      target: { section: 'efficiency' },
    })
  }

  return items.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}
