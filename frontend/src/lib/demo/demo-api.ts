/**
 * ProxCenter Demo Mode - API Interceptor
 *
 * Edge-compatible module that intercepts API requests in demo mode and returns
 * mock responses. Designed to be called from Next.js middleware so that NO
 * actual route handler files need modification.
 *
 * No `fs` or `path` imports — uses a static JSON import so it works in both
 * Node.js and Edge runtimes.
 */

import { NextResponse } from 'next/server'

import { aggregateStorage, normalizeStorageEntry } from '@/lib/proxmox/storage'

import mockDataJson from './mock-data.json'
import cloudImagesJson from '@/data/cloudImages.json'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MockDataMap = Record<string, any>

// ---------------------------------------------------------------------------
// In-memory cache (JSON import is already cached by the bundler, but we keep
// a typed reference for clarity)
// ---------------------------------------------------------------------------

const MOCK_DATA: MockDataMap = mockDataJson as MockDataMap

// ---------------------------------------------------------------------------
// Known demo identifiers
// ---------------------------------------------------------------------------

const DEMO_CONNECTION_ID = 'demo-pve-cluster-001'
const DEMO_NODE_NAME = 'pve-node-01'

// ---------------------------------------------------------------------------
// Load spread
//
// Every node in the seed sat between 1.8% and 5.4% CPU and 64% to 70% RAM, and
// every guest was just as tightly bunched. On a 0-100% axis that draws twelve
// curves on top of each other, which is what made the cluster Performance
// charts and the dashboard widgets look synthetic: a real cluster has hot
// nodes, quiet nodes and a long tail of small guests.
//
// The spread is applied ONCE to MOCK_DATA at module load, so every consumer
// agrees: the inventory gauges, the dashboard aggregates, the DRS metrics and
// the RRD history all read the same per-element figures.
// ---------------------------------------------------------------------------

/**
 * Read a demo dataset whatever side it lives on. Node and resource lists are
 * split between mock-data.json (production) and EXTRA_MOCKS getters (DR), and
 * a bare MOCK_DATA lookup silently yields an empty DR cluster.
 */
function demoDataset(path: string): any[] {
  const extra = (EXTRA_MOCKS as any)?.[`GET:${path}`]
  if (extra !== undefined) return extra?.data || []
  return (MOCK_DATA[path] as any)?.data || []
}

/** Deterministic 32-bit hash, so a given node or guest always draws the same curve. */
function demoHash(seed: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** Deterministic [0,1) stream from a seed, so refreshing does not reshuffle history. */
function demoRandom(seed: string): () => number {
  let a = demoHash(seed)
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Per-node load, hand-written rather than generated: a demo cluster reads far
 * better when the shape tells a story (a database node pinned on RAM, a CI
 * fleet spiking on CPU, a spare node nearly idle) than when it is noise.
 * cpu and ram are percentages; diurnalOffset shifts the node's own business
 * hours so the fleet does not step up and down in unison; diurnalDepth is how
 * much of its load actually follows office hours (a database never idles).
 */
const DEMO_NODE_LOAD: Record<string, { cpu: number, ram: number, role: string, diurnalOffset: number, diurnalDepth: number, burstiness: number }> = {
  'pve-node-01': { cpu: 22, ram: 71, role: 'web front-end', diurnalOffset: 0, diurnalDepth: 0.55, burstiness: 0.35 },
  'pve-node-02': { cpu: 41, ram: 88, role: 'database', diurnalOffset: -2, diurnalDepth: 0.15, burstiness: 0.18 },
  'pve-node-03': { cpu: 14, ram: 63, role: 'application', diurnalOffset: 1, diurnalDepth: 0.45, burstiness: 0.30 },
  'pve-node-04': { cpu: 9, ram: 57, role: 'application', diurnalOffset: 3, diurnalDepth: 0.40, burstiness: 0.25 },
  'pve-node-05': { cpu: 47, ram: 66, role: 'CI runners', diurnalOffset: -1, diurnalDepth: 0.30, burstiness: 0.85 },
  'pve-node-06': { cpu: 3, ram: 34, role: 'spare capacity', diurnalOffset: 2, diurnalDepth: 0.20, burstiness: 0.10 },
  'pve-node-07': { cpu: 28, ram: 79, role: 'analytics', diurnalOffset: -4, diurnalDepth: 0.60, burstiness: 0.55 },
  'pve-node-08': { cpu: 11, ram: 82, role: 'cache tier', diurnalOffset: 4, diurnalDepth: 0.10, burstiness: 0.15 },
  'pve-node-09': { cpu: 17, ram: 68, role: 'mixed workload', diurnalOffset: -3, diurnalDepth: 0.50, burstiness: 0.40 },
  'pve-node-10': { cpu: 5, ram: 41, role: 'staging', diurnalOffset: 5, diurnalDepth: 0.65, burstiness: 0.20 },
  'pve-node-11': { cpu: 33, ram: 59, role: 'batch processing', diurnalOffset: 8, diurnalDepth: 0.35, burstiness: 0.70 },
  'pve-node-12': { cpu: 8, ram: 52, role: 'mixed workload', diurnalOffset: 6, diurnalDepth: 0.45, burstiness: 0.28 },
  // The DR site only holds stopped replicas, so it idles.
  'pve-dr-01': { cpu: 4, ram: 22, role: 'DR replica target', diurnalOffset: 0, diurnalDepth: 0.10, burstiness: 0.45 },
  'pve-dr-02': { cpu: 2, ram: 18, role: 'DR replica target', diurnalOffset: 3, diurnalDepth: 0.10, burstiness: 0.40 },
  'pve-dr-03': { cpu: 3, ram: 25, role: 'DR replica target', diurnalOffset: -2, diurnalDepth: 0.10, burstiness: 0.50 },
  'pve-dr-04': { cpu: 2, ram: 16, role: 'DR replica target', diurnalOffset: 5, diurnalDepth: 0.10, burstiness: 0.35 },
}

const DEMO_DEFAULT_NODE_LOAD = { cpu: 10, ram: 55, role: 'node', diurnalOffset: 0, diurnalDepth: 0.4, burstiness: 0.3 }

function demoNodeLoad(node: string) {
  return DEMO_NODE_LOAD[node] || DEMO_DEFAULT_NODE_LOAD
}

/** vCPU count from the memory footprint, shared by the spread and the guest config. */
function demoGuestCores(maxmemBytes: number): number {
  const memMb = Math.round(maxmemBytes / (1024 * 1024))
  return memMb >= 16384 ? 8 : memMb >= 8192 ? 4 : 2
}

/**
 * Per-guest load. A long tail, not a uniform band: most guests idle, a handful
 * carry the cluster. The bucket is picked from the vmid hash, so a guest keeps
 * its personality across reloads and matches its own RRD history.
 */
function demoGuestLoad(vmid: number, name: string): { cpu: number, ram: number, diurnalOffset: number, diurnalDepth: number, burstiness: number } {
  const rnd = demoRandom(`guest:${vmid}:${name}`)
  const bucket = rnd()
  let cpu: number
  if (bucket > 0.94) cpu = 55 + rnd() * 35          // a few saturated guests
  else if (bucket > 0.80) cpu = 22 + rnd() * 28     // busy
  else if (bucket > 0.50) cpu = 6 + rnd() * 14      // working
  else if (bucket > 0.18) cpu = 1.5 + rnd() * 4     // ticking over
  else cpu = 0.1 + rnd() * 1.2                      // idle
  // RAM correlates loosely with CPU but has its own spread: a cache box is
  // full and idle, a batch job is busy on a small footprint.
  const ram = Math.max(8, Math.min(97, cpu * 0.6 + 20 + rnd() * 55))
  return {
    cpu: Math.round(cpu * 10) / 10,
    ram: Math.round(ram * 10) / 10,
    diurnalOffset: Math.round((rnd() * 12) - 6),
    diurnalDepth: Math.round(rnd() * 70) / 100,
    burstiness: Math.round(rnd() * 90) / 100,
  }
}

let loadSpreadApplied = false

function applyDemoLoadSpread(): void {
  // Lazy: EXTRA_MOCKS is declared further down the module, so this cannot run
  // at import time if it is to reach the DR datasets.
  if (loadSpreadApplied) return
  loadSpreadApplied = true
  for (const connId of ['demo-pve-cluster-001', 'demo-pve-dr-001']) {
    const nodes = demoDataset(`/api/v1/connections/${connId}/nodes`)
    for (const n of nodes) {
      const load = demoNodeLoad(n.node)
      n.cpu = Math.round((load.cpu / 100) * 10000) / 10000
      n.mem = Math.round((n.maxmem || 0) * (load.ram / 100))
    }
    const resources = demoDataset(`/api/v1/connections/${connId}/resources`)
    for (const g of resources) {
      if (!g.vmid) continue
      if (g.status !== 'running') {
        g.cpu = 0
        g.mem = 0
        g.maxcpu = demoGuestCores(g.maxmem || 0)
        continue
      }
      const load = demoGuestLoad(Number(g.vmid), String(g.name || ''))
      g.cpu = Math.round((load.cpu / 100) * 10000) / 10000
      g.mem = Math.round((g.maxmem || 0) * (load.ram / 100))
      // vCPU count, same rule as buildDemoGuestConfig: without it the
      // "provisioned vCPU" gauge sums undefined and shows a flat zero.
      g.maxcpu = demoGuestCores(g.maxmem || 0)
    }
  }
}

/** Node list for a connection, load spread applied. */
function demoNodes(connId: string): any[] {
  applyDemoLoadSpread()
  return demoDataset(`/api/v1/connections/${connId}/nodes`)
}

/** Resource list for a connection, load spread applied. */
function demoResources(connId: string): any[] {
  applyDemoLoadSpread()
  return demoDataset(`/api/v1/connections/${connId}/resources`)
}

/** Cluster-wide averages, recomputed from the spread instead of hardcoded. */
function demoClusterAverages(connId: string): { cpu: number, ram: number, memUsedBytes: number, memTotalBytes: number } {
  const nodes = demoNodes(connId)
  if (nodes.length === 0) return { cpu: 0, ram: 0, memUsedBytes: 0, memTotalBytes: 0 }
  const memUsedBytes = nodes.reduce((sum, n) => sum + (n.mem || 0), 0)
  const memTotalBytes = nodes.reduce((sum, n) => sum + (n.maxmem || 0), 0)
  const cpu = nodes.reduce((sum, n) => sum + (n.cpu || 0), 0) / nodes.length * 100
  return {
    cpu: Math.round(cpu * 10) / 10,
    ram: memTotalBytes > 0 ? Math.round((memUsedBytes / memTotalBytes) * 1000) / 10 : 0,
    memUsedBytes,
    memTotalBytes,
  }
}

// ---------------------------------------------------------------------------
// Dynamic RRD data generator
// ---------------------------------------------------------------------------

function generateRrdData(
  timeframe: string = 'hour',
  baseValues?: { cpu?: number, mem?: number, memTotal?: number },
  seed: string = 'default',
): any[] {
  const now = Math.floor(Date.now() / 1000)
  const memTotal = baseValues?.memTotal ?? 270138527744
  const rnd = demoRandom(`rrd:${seed}`)

  // Per-series personality. Two series drawn on the same chart must not share
  // a phase, a period or an amplitude, otherwise twelve nodes trace one curve
  // twelve times (which is exactly what the cluster charts used to show).
  const phase1 = rnd() * Math.PI * 2
  const phase2 = rnd() * Math.PI * 2
  const freq1 = 2 + rnd() * 5
  const freq2 = 6 + rnd() * 11
  const amp1 = 0.18 + rnd() * 0.42
  const amp2 = 0.05 + rnd() * 0.18
  const diurnalOffset = (rnd() * 10) - 5
  const diurnalDepth = 0.1 + rnd() * 0.6
  const burstiness = rnd()
  // One or two idiosyncratic events per series: a deploy, a backup window, a
  // batch job. They are what stops the fleet looking like one waveform.
  const eventCount = burstiness > 0.6 ? 2 : burstiness > 0.3 ? 1 : 0
  const events = Array.from({ length: eventCount }, () => ({
    at: rnd(),
    width: 0.02 + rnd() * 0.09,
    height: 0.4 + rnd() * 1.6,
  }))

  const cpuBase = baseValues?.cpu ?? 0.03 + rnd() * 0.05
  const memBase = baseValues?.mem ?? memTotal * (0.3 + rnd() * 0.5)
  const netBase = 8_000_000 + rnd() * 90_000_000
  const diskBase = 1_500_000 + rnd() * 12_000_000
  const loadBase = 0.2 + cpuBase * 24

  const config: Record<string, { points: number, interval: number }> = {
    hour: { points: 70, interval: 60 },
    day: { points: 70, interval: 1200 },
    week: { points: 70, interval: 8640 },
    month: { points: 70, interval: 43200 },
    year: { points: 70, interval: 432000 },
  }
  const { points, interval } = config[timeframe] || config.hour

  return Array.from({ length: points }, (_, i) => {
    const time = now - (points - 1 - i) * interval
    const t = i / points

    // Office hours, shifted per series so the fleet does not step together.
    const hour = ((new Date(time * 1000).getHours() + diurnalOffset) + 24) % 24
    const dayShape = 0.5 - 0.5 * Math.cos(((hour - 3 + 24) % 24) / 24 * Math.PI * 2)
    const diurnal = 1 - diurnalDepth + diurnalDepth * dayShape

    const wave = Math.sin(t * Math.PI * freq1 + phase1) * amp1
      + Math.sin(t * Math.PI * freq2 + phase2) * amp2

    // Deterministic per-point jitter: the same minute keeps the same value
    // across a reload, so the chart scrolls instead of reshuffling.
    const jitter = (demoRandom(`${seed}:${time}`)() - 0.5) * 0.06

    const burst = events.reduce((acc, e) => {
      const d = (t - e.at) / e.width
      return acc + e.height * Math.exp(-d * d)
    }, 0)

    const factor = Math.max(0.05, diurnal * (1 + wave * 0.55 + jitter) + burst * 0.35)

    const cpuVal = Math.max(0.0005, Math.min(0.98, cpuBase * factor))
    // Memory moves far less than CPU: a guest does not hand its pages back
    // every evening.
    const memVal = Math.max(0, Math.min(memTotal, memBase * (1 + (factor - 1) * 0.18 + jitter * 0.4)))

    return {
      time,
      cpu: cpuVal,
      maxcpu: 64,
      memused: memVal,
      memtotal: memTotal,
      netin: Math.max(0, netBase * factor * (1 + jitter * 3)),
      netout: Math.max(0, netBase * 0.6 * factor * (1 + jitter * 3)),
      diskread: Math.max(0, diskBase * factor * (1 + jitter * 4)),
      diskwrite: Math.max(0, diskBase * 0.7 * factor * (1 + jitter * 4)),
      rootused: 8_500_000_000 + rnd() * 500_000_000,
      roottotal: 20939620352,
      swapused: 100_000_000 * factor,
      swaptotal: 8589934592,
      iowait: Math.max(0, cpuVal * 0.25 * (1 + jitter * 6)),
      loadavg: Math.max(0.02, loadBase * factor),
    }
  })
}

/**
 * Centre a series on the element the caller asked for. `path` is the PVE RRD
 * path the UI sends (`/nodes/<name>`, `/qemu/<vmid>`, `/lxc/<vmid>`), and the
 * series is built around that element's OWN current CPU and memory, so its
 * history and its gauge agree.
 */
function generateRrdForPath(connId: string, path: string, timeframe: string): any[] {
  const nodeMatch = path.match(/\/nodes\/([^/]+)/)
  if (nodeMatch) {
    const nodes = demoNodes(connId)
    const n = nodes.find(x => x.node === nodeMatch[1])
    if (n) {
      return generateRrdData(timeframe, { cpu: n.cpu, mem: n.mem, memTotal: n.maxmem }, `${connId}:${nodeMatch[1]}`)
    }
    return generateRrdData(timeframe, undefined, `${connId}:${nodeMatch[1]}`)
  }

  const guestMatch = path.match(/\/(qemu|lxc)\/(\d+)/)
  if (guestMatch) {
    const vmid = Number(guestMatch[2])
    const resources = demoResources(connId)
    const g = resources.find(x => Number(x.vmid) === vmid)
    if (g) {
      return generateRrdData(timeframe, { cpu: g.cpu, mem: g.mem, memTotal: g.maxmem }, `${connId}:${guestMatch[1]}:${vmid}`)
    }
    return generateRrdData(timeframe, undefined, `${connId}:${guestMatch[1]}:${vmid}`)
  }

  return generateRrdData(timeframe, undefined, `${connId}:${path}`)
}


// ---------------------------------------------------------------------------
// Helper: generate demo backup entries
// ---------------------------------------------------------------------------

function formatBytesUtil(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

function generateBackupEntries(count: number, prefix: string, datastore: string): any[] {
  const now = Date.now()
  const vmNames = ['web-prod-01','db-master','api-gateway','redis-cache','monitoring','mail-server','dns-primary','ldap-auth','ci-runner','vault-prod']
  const backupTypes = ['vm', 'vm', 'vm', 'vm', 'vm', 'vm', 'vm', 'vm', 'ct', 'ct']
  return Array.from({ length: count }, (_, i) => {
    const vmid = 100 + (i % 45)
    const name = vmNames[i % vmNames.length]
    const ageMs = Math.random() * 7 * 24 * 3600 * 1000
    const backupTime = Math.floor((now - ageMs) / 1000)
    const backupDate = new Date(backupTime * 1000)
    const size = 1073741824 + Math.floor(Math.random() * 10737418240)
    const bType = backupTypes[i % backupTypes.length]
    const verified = i < count - 2
    return {
      id: `${datastore}/${bType}/${vmid}/${backupTime}`,
      datastore,
      namespace: '',
      backupType: bType,
      backupId: String(vmid),
      vmName: name,
      backupTime,
      backupTimeFormatted: backupDate.toLocaleString('en-US'),
      backupTimeIso: backupDate.toISOString(),
      size,
      sizeFormatted: formatBytesUtil(size),
      files: [],
      fileCount: 0,
      verification: verified ? { state: 'ok', upid: null } : null,
      verified,
      verifiedAt: null,
      protected: i === 0,
      owner: 'root@pam',
      comment: name,
    }
  })
}

// ---------------------------------------------------------------------------
// Helper: build a /connections/<id>/ceph payload
//
// The Ceph screen consumes the shape produced by
// src/app/api/v1/connections/[id]/ceph/route.ts, NOT the raw PVE status. Two
// differences bite: the route turns `health.checks` into a LIST (page.jsx does
// `(cephData.health?.checks || []).map`, and an object literal is truthy, so a
// raw `{}` throws instead of falling back), and it derives `capacity`,
// `performance`, `pgs` and `mds`, which the raw status does not carry.
// ---------------------------------------------------------------------------

const TiB = 1024 ** 4

function formatBytesPerSecUtil(bytesPerSec: number): string {
  return `${formatBytesUtil(bytesPerSec)}/s`
}

function buildCephData(opts: {
  nodeName: string
  healthStatus: string
  checks?: { name: string, severity: string, summary: string, detail?: string[] }[]
  osdCount: number
  osdUp: number
  osdHost: (i: number) => string
  osdDeviceClass?: (i: number) => string
  osdUtilisation: number
  pgTotal: number
  pgStates: Record<string, number>
  totalBytes: number
  usedBytes: number
  replication: number
  readBytesSec: number
  writeBytesSec: number
  readOpsSec: number
  writeOpsSec: number
  pools: any[]
  monitorHosts: { name: string, addr: string }[]
  mds?: any[]
}): any {
  const checks = opts.checks || []
  const availBytes = opts.totalBytes - opts.usedBytes
  const osds = Array.from({ length: opts.osdCount }, (_, i) => {
    const up = i < opts.osdUp
    const totalBytes = Math.round((opts.totalBytes * opts.replication) / opts.osdCount)
    const usedPct = up ? Math.round((opts.osdUtilisation + ((i % 7) - 3)) * 10) / 10 : 0
    const usedBytes = Math.round(totalBytes * (usedPct / 100))
    return {
      id: i,
      name: `osd.${i}`,
      host: opts.osdHost(i),
      status: up ? 'up' : 'down',
      up,
      in: up,
      deviceClass: opts.osdDeviceClass ? opts.osdDeviceClass(i) : 'ssd',
      totalBytes,
      usedBytes,
      availBytes: totalBytes - usedBytes,
      usedPct,
      commitLatencyMs: up ? Math.round((0.6 + (i % 5) * 0.3) * 10) / 10 : 0,
      applyLatencyMs: up ? Math.round((0.4 + (i % 4) * 0.25) * 10) / 10 : 0,
      reweight: up ? 1 : 0,
      pgs: up ? Math.round((opts.pgTotal * opts.replication) / opts.osdUp) : 0,
      version: '19.2.1',
    }
  })
  const monitors = opts.monitorHosts.map((m, rank) => ({
    name: m.name,
    host: m.name,
    addr: m.addr,
    rank,
    status: rank === 0 ? 'leader' : 'peon',
  }))
  const quorumNames = monitors.map(m => m.name)
  return {
    hasCeph: true,
    nodeName: opts.nodeName,
    health: {
      status: opts.healthStatus,
      checks,
      numChecks: checks.length,
    },
    capacity: {
      totalBytes: opts.totalBytes,
      usedBytes: opts.usedBytes,
      availBytes,
      usedPct: Math.round((opts.usedBytes / opts.totalBytes) * 1000) / 10,
      totalFormatted: formatBytesUtil(opts.totalBytes),
      usedFormatted: formatBytesUtil(opts.usedBytes),
      availFormatted: formatBytesUtil(availBytes),
      rawTotalBytes: opts.totalBytes * opts.replication,
      rawUsedBytes: opts.usedBytes * opts.replication,
      rawTotalFormatted: formatBytesUtil(opts.totalBytes * opts.replication),
      rawUsedFormatted: formatBytesUtil(opts.usedBytes * opts.replication),
    },
    performance: {
      readBytesSec: opts.readBytesSec,
      writeBytesSec: opts.writeBytesSec,
      readOpsSec: opts.readOpsSec,
      writeOpsSec: opts.writeOpsSec,
      readFormatted: formatBytesPerSecUtil(opts.readBytesSec),
      writeFormatted: formatBytesPerSecUtil(opts.writeBytesSec),
      totalIops: opts.readOpsSec + opts.writeOpsSec,
    },
    pgs: { total: opts.pgTotal, states: opts.pgStates },
    osds: {
      total: opts.osdCount,
      up: opts.osdUp,
      in: opts.osdUp,
      down: opts.osdCount - opts.osdUp,
      out: opts.osdCount - opts.osdUp,
      list: osds,
    },
    monitors: {
      total: monitors.length,
      inQuorum: quorumNames.length,
      quorumNames,
      list: monitors,
    },
    pools: { total: opts.pools.length, list: opts.pools },
    mds: { total: (opts.mds || []).length, list: opts.mds || [] },
    crushTree: null,
    crushRules: [],
    managers: [],
  }
}

// ---------------------------------------------------------------------------
// Helper: hardening report
//
// /api/v1/compliance/hardening/<id> returns its body FLAT (no { data } wrapper)
// with a `summary` computed by computeScore() (lib/compliance/hardening.ts),
// and its checks use pass/fail/warning/skip plus maxPoints and earned. The old
// mock wrapped everything in { data } with passed/failed counters of its own,
// so the Hardening tab read undefined everywhere and printed a flat zero.
// ---------------------------------------------------------------------------

const DEMO_HARDENING_CHECKS: any[] = [
  { id: 'cluster_fw_enabled', name: 'Cluster firewall enabled', category: 'cluster', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'cluster_policy_in', name: 'Inbound policy = DROP', category: 'cluster', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'cluster_policy_out', name: 'Outbound policy = DROP', category: 'cluster', severity: 'medium', maxPoints: 10, status: 'fail', entity: 'Cluster', details: 'Datacenter outbound policy is ACCEPT on both clusters' },
  { id: 'pve_version', name: 'PVE version up to date', category: 'cluster', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'backup_schedule', name: 'Backup jobs configured', category: 'cluster', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'ha_enabled', name: 'High availability configured', category: 'cluster', severity: 'medium', maxPoints: 10, status: 'warning', entity: 'Cluster', details: '11 of 24 protected guests are in the HA manager' },
  { id: 'storage_replication', name: 'Storage replication configured', category: 'cluster', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'pool_isolation', name: 'Resource pool isolation', category: 'cluster', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'node_subscriptions', name: 'Valid subscriptions', category: 'node', severity: 'medium', maxPoints: 10, status: 'fail', entity: 'Cluster', details: '2 of 12 nodes have no active subscription' },
  { id: 'apt_repo_consistency', name: 'APT repository consistency', category: 'node', severity: 'low', maxPoints: 5, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'tls_certificates', name: 'Valid TLS certificates', category: 'node', severity: 'high', maxPoints: 15, status: 'warning', entity: 'Cluster', details: '3 nodes still serve the self-signed PVE certificate' },
  { id: 'node_firewalls', name: 'Node firewalls enabled', category: 'node', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'node_firewall_logging', name: 'Firewall logging enabled', category: 'node', severity: 'low', maxPoints: 5, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'root_tfa', name: 'TFA for root@pam', category: 'access', severity: 'critical', maxPoints: 20, status: 'fail', entity: 'Cluster', details: 'root@pam has no TOTP factor enrolled' },
  { id: 'admins_tfa', name: 'TFA for admin users', category: 'access', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'no_default_tokens', name: 'No default API tokens', category: 'access', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'least_privilege_users', name: 'Least privilege access', category: 'access', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'vm_firewalls', name: 'Firewall on all VMs', category: 'vm', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'vm_security_groups', name: 'VMs have security groups', category: 'vm', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'vm_vlan_isolation', name: 'VMs use VLAN isolation', category: 'vm', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'vm_guest_agent', name: 'QEMU guest agent enabled', category: 'vm', severity: 'low', maxPoints: 5, status: 'warning', entity: 'Cluster', details: 'QEMU guest agent missing on 22 guests' },
  { id: 'vm_secure_boot', name: 'UEFI boot enabled', category: 'vm', severity: 'medium', maxPoints: 10, status: 'fail', entity: 'Cluster', details: '38 guests still boot in SeaBIOS without secure boot' },
  { id: 'vm_no_usb_passthrough', name: 'No USB/PCI passthrough', category: 'vm', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'vm_cpu_isolation', name: 'CPU type isolation', category: 'vm', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'vm_ip_filter', name: 'VM IP filter enabled', category: 'vm', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'os_kernel_modules', name: 'Dangerous kernel modules disabled', category: 'os', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'os_coredumps_disabled', name: 'Core dumps disabled', category: 'os', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'os_mount_options', name: 'Secure mount options on /dev/shm, /tmp', category: 'os', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'os_auto_updates', name: 'Automatic security updates', category: 'os', severity: 'medium', maxPoints: 10, status: 'fail', entity: 'Cluster', details: 'unattended-upgrades is not installed on 4 nodes' },
  { id: 'os_cpu_microcode', name: 'CPU microcode installed', category: 'os', severity: 'low', maxPoints: 5, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'os_disk_encryption', name: 'Disk encryption (LUKS/ZFS)', category: 'os', severity: 'low', maxPoints: 5, status: 'warning', entity: 'Cluster', details: 'LUKS on the data pool, OS disks left in the clear' },
  { id: 'os_sysctl_hardening', name: 'Kernel security parameters', category: 'os', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'access_pam_faillock', name: 'Account lockout (PAM faillock)', category: 'os', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'access_password_aging', name: 'Password aging policy', category: 'os', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'access_pw_quality', name: 'Password quality enforcement', category: 'os', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'access_shell_timeout', name: 'Shell idle timeout (TMOUT)', category: 'os', severity: 'low', maxPoints: 5, status: 'warning', entity: 'Cluster', details: 'TMOUT set on 9 of 12 nodes' },
  { id: 'access_login_banner', name: 'Login warning banner', category: 'os', severity: 'low', maxPoints: 5, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'ssh_strong_ciphers', name: 'SSH strong ciphers only', category: 'ssh', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'ssh_strong_kex', name: 'SSH strong key exchange', category: 'ssh', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'ssh_strong_macs', name: 'SSH strong MACs', category: 'ssh', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'ssh_root_login', name: 'SSH root login restricted', category: 'ssh', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'ssh_max_auth_tries', name: 'SSH MaxAuthTries <= 4', category: 'ssh', severity: 'medium', maxPoints: 10, status: 'fail', entity: 'Cluster', details: 'MaxAuthTries is 6 on every node, recommended 4' },
  { id: 'ssh_empty_passwords', name: 'SSH empty passwords disabled', category: 'ssh', severity: 'critical', maxPoints: 20, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'ssh_idle_timeout', name: 'SSH idle timeout configured', category: 'ssh', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'ssh_file_perms', name: 'SSH file permissions', category: 'ssh', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'net_ip_forward', name: 'IP forwarding disabled', category: 'network', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'net_icmp_redirects', name: 'ICMP redirects disabled', category: 'network', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'net_source_routing', name: 'Source routing disabled', category: 'network', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'net_syn_cookies', name: 'TCP SYN cookies enabled', category: 'network', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'net_rp_filter', name: 'Reverse path filtering enabled', category: 'network', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'svc_unnecessary_disabled', name: 'Unnecessary services disabled', category: 'services', severity: 'low', maxPoints: 5, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'svc_apparmor', name: 'AppArmor enabled', category: 'services', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'svc_auditd', name: 'Audit daemon installed and running', category: 'services', severity: 'medium', maxPoints: 10, status: 'warning', entity: 'Cluster', details: 'auditd installed everywhere, stopped on pve-node-11' },
  { id: 'svc_ntp_sync', name: 'NTP time synchronization', category: 'services', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'svc_fail2ban', name: 'Fail2Ban installed and running', category: 'services', severity: 'medium', maxPoints: 10, status: 'fail', entity: 'Cluster', details: 'Fail2Ban is not installed on any node' },
  { id: 'fs_permissions', name: 'Critical file permissions', category: 'filesystem', severity: 'high', maxPoints: 15, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'fs_suid_audit', name: 'SUID/SGID files audit', category: 'filesystem', severity: 'medium', maxPoints: 10, status: 'warning', entity: 'Cluster', details: '2 unexpected SUID binaries under /usr/local/bin' },
  { id: 'fs_world_writable', name: 'No world-writable files', category: 'filesystem', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'fs_integrity', name: 'File integrity monitoring', category: 'filesystem', severity: 'medium', maxPoints: 10, status: 'fail', entity: 'Cluster', details: 'No AIDE or Tripwire database found' },
  { id: 'log_journald_persistent', name: 'Journald persistent storage', category: 'logging', severity: 'medium', maxPoints: 10, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
  { id: 'log_syslog_forwarding', name: 'Syslog remote forwarding', category: 'logging', severity: 'medium', maxPoints: 10, status: 'fail', entity: 'Cluster', details: 'No remote syslog target configured' },
  { id: 'log_file_permissions', name: 'Log file permissions', category: 'logging', severity: 'low', maxPoints: 5, status: 'pass', entity: 'Cluster', details: 'Compliant on every node checked' },
]

function scoreDemoHardening(checks: any[]): any {
  const applicable = checks.filter(c => c.status !== 'skip')
  const earned = applicable.reduce((sum, c) => sum + c.earned, 0)
  const maxApplicable = applicable.reduce((sum, c) => sum + c.maxPoints, 0)
  const score = maxApplicable > 0 ? Math.round((earned / maxApplicable) * 100) : 0
  return {
    score,
    earned,
    maxApplicable,
    total: checks.length,
    passed: checks.filter(c => c.status === 'pass').length,
    failed: checks.filter(c => c.status === 'fail').length,
    warnings: checks.filter(c => c.status === 'warning').length,
    skipped: checks.filter(c => c.status === 'skip').length,
    critical: checks.filter(c => c.status === 'fail' && c.severity === 'critical').length,
    color: score >= 80 ? 'success' : score >= 50 ? 'warning' : 'error',
  }
}

function buildHardeningReport(connectionId: string, connectionName: string, degrade: boolean, scannedHoursAgo: number): any {
  const checks = DEMO_HARDENING_CHECKS.map((c, i) => {
    // The DR cluster is deliberately a notch behind production.
    const status = degrade && i % 6 === 5 ? 'fail' : c.status
    const details = status === c.status ? c.details : 'Not applied on the DR cluster'
    const earned = status === 'pass' ? c.maxPoints : status === 'warning' ? Math.round(c.maxPoints / 2) : 0
    return { ...c, status, details, earned }
  })
  const summary = scoreDemoHardening(checks)
  return {
    connectionId,
    connectionName,
    node: null,
    score: summary.score,
    checks,
    summary,
    profileId: null,
    sshStatus: { available: 12, total: 12, enabled: true },
    scannedAt: new Date(Date.now() - scannedHoursAgo * 3600 * 1000).toISOString(),
  }
}

// ---------------------------------------------------------------------------
// Helper: DR cluster guests
//
// The DR site advertised 4 nodes and zero guests, so the inventory tree, the
// dashboard cluster card and every DR-scoped selector showed an empty cluster
// while Site Recovery claimed 24 protected VMs. These are those 24 replicas:
// stopped copies of the protected production guests, vmid 5xxx, on the DR
// Ceph pool.
// ---------------------------------------------------------------------------

function generateDrResources(): any[] {
  const prod = demoResources('demo-pve-cluster-001')
  const protectedGuests = prod.filter(r => r.vmid && !r.template).slice(0, 24)
  const drNodes = ['pve-dr-01', 'pve-dr-02', 'pve-dr-03', 'pve-dr-04']
  return protectedGuests.map((g, i) => ({
    id: `qemu-qemu/${5000 + Number(g.vmid)}`,
    type: 'qemu',
    name: `${g.name}-replica`,
    node: drNodes[i % drNodes.length],
    status: 'stopped',
    cpu: 0,
    mem: 0,
    maxmem: g.maxmem,
    disk: 0,
    maxdisk: g.maxdisk,
    uptime: 0,
    pool: 'vdc-acme-acme-dr',
    tags: ['replica', 'dr'],
    template: false,
    vmid: 5000 + Number(g.vmid),
  }))
}

// ---------------------------------------------------------------------------
// Helper: guest configs and firewall state
//
// /automation/network walks every guest, asking for its config then its
// firewall options and rules. That is 480+ requests, so these are generated
// from the inventory instead of being spelled out as 160 mock keys. They also
// need the query string (`?type=rules` vs `?type=options` hit the same path),
// which lookupMock cannot see because it strips it — hence a handler in
// demoResponse rather than an EXTRA_MOCKS entry.
//
// A guest is firewalled when its vmid is not a multiple of 3, which puts the
// Zero Trust coverage around two thirds: high enough to look like a managed
// estate, low enough that the recommendations panel still has something to say.
// ---------------------------------------------------------------------------

function demoGuestByVmid(vmid: number): any | null {
  const resources = demoResources('demo-pve-cluster-001')
  return resources.find(r => Number(r.vmid) === vmid) || null
}

function isDemoGuestFirewalled(vmid: number): boolean {
  return vmid % 3 !== 0
}

function buildDemoGuestConfig(vmid: number, node: string, type: string): any {
  const g = demoGuestByVmid(vmid)
  const memMb = Math.round((g?.maxmem || 4 * 1024 ** 3) / (1024 * 1024))
  const diskGb = Math.max(16, Math.round((g?.maxdisk || 32 * 1024 ** 3) / 1024 ** 3))
  const cores = demoGuestCores(g?.maxmem || 4 * 1024 ** 3)
  const fw = isDemoGuestFirewalled(vmid) ? 1 : 0
  const mac = `BC:24:11:${((vmid * 7) % 256).toString(16).padStart(2, '0').toUpperCase()}:${((vmid * 13) % 256).toString(16).padStart(2, '0').toUpperCase()}:${(vmid % 256).toString(16).padStart(2, '0').toUpperCase()}`
  if (type === 'lxc') {
    return {
      arch: 'amd64', cores, hostname: g?.name || `ct-${vmid}`, memory: memMb, swap: 512,
      ostype: 'debian', rootfs: `CephStoragePool:vm-${vmid}-disk-0,size=${diskGb}G`,
      net0: `name=eth0,bridge=vmbr0,hwaddr=${mac},ip=dhcp,type=veth,firewall=${fw}`,
      onboot: 1, unprivileged: 1, digest: `demo${vmid}`,
    }
  }
  return {
    name: g?.name || `vm-${vmid}`,
    cores, sockets: 1, cpu: 'host', memory: memMb, balloon: Math.round(memMb / 2),
    ostype: 'l26', agent: '1', boot: 'order=scsi0;ide2;net0', bios: 'seabios', machine: 'q35',
    scsihw: 'virtio-scsi-single',
    scsi0: `CephStoragePool:vm-${vmid}-disk-0,iothread=1,size=${diskGb}G`,
    ide2: 'none,media=cdrom',
    net0: `virtio=${mac},bridge=vmbr0,firewall=${fw}${vmid % 4 === 0 ? ',tag=20' : ''}`,
    vmgenid: `00000000-0000-4000-8000-${String(vmid).padStart(12, '0')}`,
    smbios1: `uuid=00000000-0000-4000-9000-${String(vmid).padStart(12, '0')}`,
    numa: 0, onboot: 1, protection: 0, tags: (g?.tags || []).join(';'),
    node, digest: `demo${vmid}`,
  }
}

function buildDemoVmFirewallRules(vmid: number): any[] {
  if (!isDemoGuestFirewalled(vmid)) return []
  const rules: any[] = [
    { pos: 0, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '22', source: '10.10.0.0/16', enable: 1, comment: 'SSH from the management network', iface: 'net0' },
    { pos: 1, type: 'in', action: 'ACCEPT', proto: 'icmp', enable: 1, comment: 'Ping', iface: 'net0' },
  ]
  if (vmid % 2 === 0) {
    rules.push({ pos: rules.length, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '443', source: '+web-clients', enable: 1, comment: 'HTTPS', iface: 'net0' })
  }
  if (vmid % 5 === 0) {
    rules.push({ pos: rules.length, type: 'in', action: 'DROP', proto: 'tcp', dport: '3389', enable: 1, comment: 'No RDP from anywhere', iface: 'net0' })
  }
  return rules
}

function buildDemoVmFirewallOptions(vmid: number): any {
  const on = isDemoGuestFirewalled(vmid)
  return {
    enable: on ? 1 : 0,
    policy_in: on ? 'DROP' : 'ACCEPT',
    policy_out: 'ACCEPT',
    dhcp: 1,
    ipfilter: on && vmid % 7 === 0 ? 1 : 0,
    macfilter: 1,
    ndp: 1,
    radv: 0,
    log_level_in: on ? 'info' : 'nolog',
    log_level_out: 'nolog',
  }
}

const DEMO_CLUSTER_FW_RULES: any[] = [
  { pos: 0, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '8006', source: '10.10.0.0/16', enable: 1, comment: 'Proxmox web UI from the management network' },
  { pos: 1, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '22', source: '+management', enable: 1, comment: 'SSH from the management IP set' },
  { pos: 2, type: 'in', action: 'ACCEPT', proto: 'udp', dport: '5405:5412', source: '10.10.10.0/24', enable: 1, comment: 'Corosync' },
  { pos: 3, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '3300,6789,6800:7300', source: '10.10.20.0/24', enable: 1, comment: 'Ceph public and cluster network' },
  { pos: 4, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '8007', source: '10.10.30.0/24', enable: 1, comment: 'Proxmox Backup Server' },
  { pos: 5, type: 'in', action: 'DROP', enable: 1, log: 'info', comment: 'Default deny, logged' },
  { pos: 6, type: 'group', action: 'management', enable: 1, comment: 'Management security group' },
]

const DEMO_FW_ALIASES: any[] = [
  { name: 'mgmt-net', cidr: '10.10.0.0/16', comment: 'Management network', digest: 'demoalias1' },
  { name: 'ceph-net', cidr: '10.10.20.0/24', comment: 'Ceph public network', digest: 'demoalias2' },
  { name: 'pbs-primary', cidr: '10.10.30.9/32', comment: 'PBS Server', digest: 'demoalias3' },
  { name: 'dr-site', cidr: '10.20.0.0/16', comment: 'DR Cluster (GRA)', digest: 'demoalias4' },
  { name: 'office-vpn', cidr: '192.168.240.0/22', comment: 'Office VPN pool', digest: 'demoalias5' },
]

const DEMO_FW_IPSETS: any[] = [
  {
    name: 'management', comment: 'Operators allowed to reach the API and SSH', digest: 'demoipset1',
    members: [
      { cidr: '10.10.0.10', comment: 'Jump host' },
      { cidr: '10.10.0.11', comment: 'Backup jump host' },
      { cidr: '192.168.240.0/22', comment: 'Office VPN pool' },
    ],
  },
  {
    name: 'web-clients', comment: 'Front-end reverse proxies', digest: 'demoipset2',
    members: [
      { cidr: '203.0.113.10', comment: 'Edge proxy 1' },
      { cidr: '203.0.113.11', comment: 'Edge proxy 2' },
    ],
  },
  {
    name: 'blocklist', comment: 'Manually blocked sources', digest: 'demoipset3',
    members: [
      { cidr: '198.51.100.66', comment: 'Repeated failed logins', nomatch: 0 },
    ],
  },
]

/**
 * One CSV per report, the shape the export produces: frozen English headers,
 * raw values, a single file (no archive). Enough rows to show the format.
 */
function buildDemoReportCsv(report: any): string {
  const rows: Record<string, string[][]> = {
    infrastructure: [
      ['cluster', 'node', 'status', 'cpu_percent', 'memory_percent', 'guests'],
      ['Production Cluster', 'pve-node-01', 'online', '22.0', '71.0', '18'],
      ['Production Cluster', 'pve-node-02', 'online', '41.0', '88.0', '26'],
      ['Production Cluster', 'pve-node-06', 'online', '3.0', '34.0', '7'],
      ['DR Cluster (GRA)', 'pve-dr-01', 'online', '4.0', '22.0', '6'],
    ],
    backup: [
      ['vmid', 'name', 'datastore', 'started_at', 'duration_seconds', 'size_bytes', 'transferred_bytes', 'status'],
      ['100', 'web-prod-01', 'backup-main', '2026-09-09T01:24:47Z', '188', '10639572992', '2415919104', 'ok'],
      ['101', 'db-master', 'backup-main', '2026-09-09T01:31:02Z', '742', '44446351360', '9126805504', 'ok'],
      ['117', 'ci-runner-02', 'backup-main', '2026-09-09T01:48:19Z', '96', '5368709120', '1073741824', 'warning'],
    ],
    site_recovery: [
      ['job', 'source_cluster', 'target_cluster', 'vmid', 'rpo_target_minutes', 'last_sync_minutes_ago', 'compliant'],
      ['Critical Infrastructure DR', 'Production Cluster', 'DR Cluster (GRA)', '100', '15', '7', 'true'],
      ['Database Servers', 'Production Cluster', 'DR Cluster (GRA)', '101', '30', '41', 'false'],
      ['Web Frontends', 'Production Cluster', 'DR Cluster (GRA)', '118', '60', '18', 'true'],
    ],
    security: [
      ['node', 'package', 'installed_version', 'cve', 'severity', 'fixed_version'],
      ['pve-node-01', 'openssl', '3.0.14-1', 'CVE-2026-1234', 'high', '3.0.15-1'],
      ['pve-node-03', 'curl', '8.5.0-2', 'CVE-2026-5678', 'medium', '8.5.1-1'],
      ['pve-node-11', 'libxml2', '2.12.4-1', 'CVE-2026-9012', 'critical', '2.12.6-1'],
    ],
    compliance: [
      ['check', 'category', 'severity', 'status', 'earned_points', 'max_points', 'details'],
      ['root_tfa', 'access', 'critical', 'fail', '0', '20', 'root@pam has no TOTP factor enrolled'],
      ['cluster_fw_enabled', 'cluster', 'high', 'pass', '15', '15', 'Compliant on every node checked'],
      ['svc_fail2ban', 'services', 'medium', 'fail', '0', '10', 'Fail2Ban is not installed on any node'],
    ],
    vdc: [
      ['tenant', 'vdc', 'cluster', 'pool', 'vcpu_quota', 'vcpu_used', 'memory_quota_gb', 'memory_used_gb'],
      ['Acme Corporation', 'Acme Production', 'Production Cluster', 'vdc-acme-acme-prod', '128', '96', '512', '384'],
      ['Globex SAS', 'Globex Production', 'Production Cluster', 'vdc-globex-globex-prod', '64', '38', '256', '162'],
      ['Initech', 'Initech Production', 'Production Cluster', 'vdc-initech-initech-prod', '32', '21', '128', '77'],
    ],
    utilization: [
      ['date', 'cpu_percent', 'memory_percent', 'storage_percent', 'network_in_bytes', 'network_out_bytes'],
      ['2026-09-07', '18.4', '62.1', '54.6', '4821992243', '2914384112'],
      ['2026-09-08', '20.9', '63.8', '54.9', '5233918744', '3102884519'],
      ['2026-09-09', '19.8', '63.3', '55.0', '5019283746', '2998172630'],
    ],
  }
  const table = rows[report.type] || [
    ['report', 'type', 'generated_at', 'generated_by'],
    [report.name, report.type, report.created_at, report.generated_by],
  ]
  const escape = (v: string) => (/[",\n;]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v)
  return table.map(line => line.map(escape).join(',')).join('\n') + '\n'
}

/**
 * A one-page PDF, assembled with computed xref offsets so it is always valid.
 * The report history advertises completed reports with a Download button that
 * opens the file in a tab; without this it opened raw `{ "data": [] }` JSON.
 */
function buildDemoReportPdf(title: string): string {
  const esc = (v: string) => v.replace(/([()\\])/g, '\\$1')
  const lines = [
    `BT /F1 20 Tf 60 720 Td (${esc(title)}) Tj ET`,
    'BT /F1 11 Tf 60 690 Td (ProxCenter demo instance) Tj ET',
    'BT /F1 11 Tf 60 672 Td (Reports are generated by the orchestrator on a real install.) Tj ET',
    'BT /F1 11 Tf 60 654 Td (This placeholder stands in for the PDF it would return.) Tj ET',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${lines.length} >>\nstream\n${lines}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ]
  let body = '%PDF-1.4\n'
  const offsets: number[] = []
  objects.forEach((obj, i) => {
    offsets.push(body.length)
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefStart = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) body += `${String(off).padStart(10, '0')} 00000 n \n`
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`
  // Returned as a string: the document is pure ASCII, and Uint8Array is
  // not assignable to BodyInit under this TS lib configuration.
  return body
}

// ---------------------------------------------------------------------------
// Helper: template catalogue, blueprints and deployments
//
// The Images tab reads `{ data: { images, vendors, meta } }`; the flat
// `{ data: [] }` fallback made it render "No cloud images match your filters"
// on every vendor. The image list is the very document the real route falls
// back to when no remote catalogue is stored (src/data/cloudImages.json), so
// the demo and a fresh install advertise exactly the same catalogue.
// ---------------------------------------------------------------------------

function buildTemplateCatalog(): any {
  const doc = cloudImagesJson as any
  return {
    data: {
      images: (doc.images || []).map((img: any) => ({ ...img, isCustom: false, isShared: true })),
      vendors: doc.vendors || [],
      meta: {
        source: 'embedded',
        url: null,
        updatedAt: doc.updatedAt,
        checkedAt: new Date().toISOString(),
        lastResult: 'ok',
        lastError: null,
      },
    },
  }
}

function generateBlueprints(): any[] {
  const now = Date.now()
  const day = 24 * 3600 * 1000
  // [name, description, imageSlug, cores, memory, diskSize, tags, daysAgo]
  const rows: [string, string, string, number, number, string, string, number][] = [
    ['Web node', 'Nginx front-end, 4 vCPU, 8 GB, VLAN 20', 'ubuntu-2404', 4, 8192, '40G', 'web;production', 61],
    ['Database node', 'PostgreSQL 17, 8 vCPU, 32 GB, dedicated Ceph volume', 'debian-13', 8, 32768, '200G', 'db;production', 47],
    ['CI runner', 'Ephemeral build agent, 8 vCPU, 16 GB', 'rocky-10', 8, 16384, '80G', 'ci;ephemeral', 23],
    ['Edge proxy', 'HAProxy on Alpine, 2 vCPU, 2 GB', 'alpine-324', 2, 2048, '16G', 'edge;network', 9],
  ]
  return rows.map((r, i) => {
    const [name, description, imageSlug, cores, memory, diskSize, tags, daysAgo] = r
    return {
      id: `demo-bp-${String(i + 1).padStart(3, '0')}`,
      tenantId: 'default',
      name,
      description,
      imageSlug,
      hardware: {
        cores, sockets: 1, memory, diskSize,
        scsihw: 'virtio-scsi-single', networkModel: 'virtio', networkBridge: 'vmbr0',
        vlanTag: i === 0 ? 20 : null, ostype: 'l26', agent: 1, cpu: 'host',
      },
      cloudInit: {
        ciuser: 'proxcenter',
        sshKeys: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIDEMOKEYdemoKEYdemoKEYdemoKEYdemo admin@demo',
        ipconfig0: 'ip=dhcp',
        nameserver: '10.10.10.1',
        searchdomain: 'demo.proxcenter.io',
      },
      tags,
      isPublic: true,
      createdBy: 'demo-user-001',
      createdAt: new Date(now - daysAgo * day).toISOString(),
      updatedAt: new Date(now - (daysAgo - 1) * day).toISOString(),
    }
  })
}

function generateDeployments(): any[] {
  const now = Date.now()
  const min = 60 * 1000
  // [blueprintName, vmid, vmName, node, imageSlug, status, currentStep, startedMinAgo, durationMin]
  const rows: [string, number, string, string, string, string, string | null, number, number | null][] = [
    ['Web node', 274, 'web-prod-14', 'pve-node-07', 'ubuntu-2404', 'configuring', 'cloud-init', 3, null],
    ['CI runner', 273, 'ci-runner-04', 'pve-node-11', 'rocky-10', 'completed', null, 58, 4],
    ['Database node', 272, 'db-replica-02', 'pve-node-02', 'debian-13', 'completed', null, 320, 11],
    ['Edge proxy', 271, 'edge-proxy-02', 'pve-node-03', 'alpine-324', 'failed', 'downloading', 1450, 2],
    ['Web node', 270, 'web-prod-13', 'pve-node-02', 'ubuntu-2404', 'completed', null, 2900, 5],
  ]
  return rows.map((r, i) => {
    const [blueprintName, vmid, vmName, node, imageSlug, status, currentStep, startedMinAgo, durationMin] = r
    const started = now - startedMinAgo * min
    return {
      id: `demo-deploy-${String(i + 1).padStart(3, '0')}`,
      tenantId: 'default',
      blueprintId: `demo-bp-00${(i % 4) + 1}`,
      blueprintName,
      connectionId: 'demo-pve-cluster-001',
      node,
      vmid,
      vmName,
      imageSlug,
      config: { storage: 'CephStoragePool' },
      status,
      currentStep,
      error: status === 'failed' ? 'checksum mismatch on the downloaded image' : null,
      taskUpid: `UPID:${node}:000${i}ABCD:0EF01234:68C0D2${i}0:qmcreate:${vmid}:admin@pam:`,
      startedAt: new Date(started).toISOString(),
      completedAt: durationMin === null ? null : new Date(started + durationMin * min).toISOString(),
      createdAt: new Date(started - min).toISOString(),
      updatedAt: new Date(durationMin === null ? now : started + durationMin * min).toISOString(),
    }
  })
}

/**
 * Orchestrator alerts, projected into the dashboard shape the widgets read
 * (severity `crit`/`warn`/`info`, `source`, `entityName`, `currentValue`...).
 */
function demoDashboardAlerts(): any[] {
  const sev: Record<string, string> = { critical: 'crit', warning: 'warn', info: 'info' }
  return generateOrchestratorAlerts()
    .filter(a => a.status === 'active')
    .map(a => ({
      severity: sev[a.severity] || 'info',
      message: a.message,
      source: a.resource,
      sourceType: 'pve',
      entityType: a.resource_type,
      entityId: String(a.resource_id ?? ''),
      entityName: a.resource_name || a.resource,
      connId: a.connection_id,
      metric: a.type,
      currentValue: a.current_value,
      threshold: a.threshold,
      unit: a.unit,
      time: a.last_seen_at,
    }))
}

function demoDashboardAlertsSummary(): { crit: number, warn: number } {
  const alerts = demoDashboardAlerts()
  return {
    crit: alerts.filter(a => a.severity === 'crit').length,
    warn: alerts.filter(a => a.severity === 'warn').length,
  }
}

// ---------------------------------------------------------------------------
// Helper: reports catalogue, history and schedules
//
// useReports (src/hooks/useReports.ts) requires RAW ARRAYS from
// /reports/types, /reports/schedules and /reports/languages, and `{ data }`
// from /reports itself. The `{ data: [] }` fallback is not an array, so
// Array.isArray() rejected it and the report type selector stayed empty, which
// is what blocked the whole Generate tab. Types and sections mirror
// GetReportTypeInfos() in internal/reports/types.go on the orchestrator side.
// ---------------------------------------------------------------------------

const SUMMARY_SECTION = { id: 'summary', name: 'Executive Summary', description: 'High-level overview' }

const DEMO_REPORT_TYPES: any[] = [
  {
    type: 'infrastructure', name: 'Infrastructure Report',
    description: 'Overview of clusters, nodes, VMs, and storage',
    sections: [SUMMARY_SECTION,
      { id: 'clusters', name: 'Clusters', description: 'Cluster status and configuration' },
      { id: 'nodes', name: 'Nodes', description: 'Node details and health' },
      { id: 'vms', name: 'Virtual Machines', description: 'VM inventory and status' },
      { id: 'storage', name: 'Storage', description: 'Storage pools and usage' }],
  },
  {
    type: 'alerts', name: 'Alerts Report',
    description: 'Alert history, statistics, and trends',
    sections: [SUMMARY_SECTION,
      { id: 'active', name: 'Active Alerts', description: 'Currently active alerts' },
      { id: 'history', name: 'Alert History', description: 'Historical alerts' },
      { id: 'statistics', name: 'Statistics', description: 'Alert statistics by type and severity' },
      { id: 'trends', name: 'Trends', description: 'Alert trends over time' }],
  },
  {
    type: 'utilization', name: 'Utilization Report',
    description: 'Resource utilization metrics and trends',
    sections: [SUMMARY_SECTION,
      { id: 'cpu', name: 'CPU Utilization', description: 'CPU usage across resources' },
      { id: 'memory', name: 'Memory Utilization', description: 'Memory usage across resources' },
      { id: 'storage', name: 'Storage Utilization', description: 'Storage usage and growth' },
      { id: 'network', name: 'Network Utilization', description: 'Network traffic metrics' },
      { id: 'trends', name: 'Trends', description: 'Utilization trends over time' }],
  },
  {
    type: 'inventory', name: 'Inventory Report',
    description: 'Complete inventory of VMs, containers, and templates',
    sections: [SUMMARY_SECTION,
      { id: 'vms', name: 'Virtual Machines', description: 'Complete VM list with specifications' },
      { id: 'containers', name: 'Containers', description: 'LXC container inventory' },
      { id: 'templates', name: 'Templates', description: 'Available VM and CT templates' },
      { id: 'specs', name: 'Specifications', description: 'Hardware specifications summary' }],
  },
  {
    type: 'capacity', name: 'Capacity Report',
    description: 'Capacity planning with predictions and recommendations',
    sections: [SUMMARY_SECTION,
      { id: 'current', name: 'Current Capacity', description: 'Current resource allocation' },
      { id: 'predictions', name: 'Predictions', description: 'Capacity growth predictions' },
      { id: 'recommendations', name: 'Recommendations', description: 'Capacity planning recommendations' }],
  },
  {
    type: 'security', name: 'Security Report',
    description: 'CVE vulnerability analysis across all nodes',
    sections: [SUMMARY_SECTION,
      { id: 'critical_high', name: 'Critical & High', description: 'Critical and high severity vulnerabilities' },
      { id: 'all_vulnerabilities', name: 'All Vulnerabilities', description: 'Complete vulnerability listing' },
      { id: 'per_node', name: 'Per Node', description: 'Vulnerabilities grouped by node' },
      { id: 'recommendations', name: 'Recommendations', description: 'Security recommendations' }],
  },
  {
    type: 'site_recovery', name: 'Site Recovery Report',
    description: 'DR readiness with RPO compliance, protection coverage, and replication jobs',
    sections: [SUMMARY_SECTION,
      { id: 'rpo_compliance', name: 'RPO Compliance', description: 'Per-job RPO target vs actual analysis' },
      { id: 'protection_coverage', name: 'Protection Coverage', description: 'Protected and unprotected VMs' },
      { id: 'replication_jobs', name: 'Replication Jobs', description: 'Job details, status, and performance' },
      { id: 'recommendations', name: 'Recommendations', description: 'DR improvement suggestions' }],
  },
  {
    type: 'compliance', name: 'Compliance Report',
    description: 'Hardening compliance analysis with framework mapping and recommendations',
    sections: [SUMMARY_SECTION,
      { id: 'framework_overview', name: 'Framework Overview', description: 'Score breakdown by framework category' },
      { id: 'check_details', name: 'Check Details', description: 'Detailed results per connection' },
      { id: 'by_category', name: 'By Category', description: 'Checks grouped by framework category' },
      { id: 'recommendations', name: 'Recommendations', description: 'Remediation recommendations' }],
  },
  {
    type: 'backup', name: 'Backup Report',
    description: 'Backup job results per VM: status, duration, size and transferred data',
    sections: [SUMMARY_SECTION,
      { id: 'jobs', name: 'Backup Jobs', description: 'Per-VM backup status, duration, size and transferred data' }],
  },
  {
    type: 'vdc', name: 'vDC Report',
    description: 'Cross-tenant view of every Virtual Data Center: tenant ownership, quota vs usage, network, IPAM and backup bindings',
    sections: [SUMMARY_SECTION,
      { id: 'vdcs', name: 'vDC Inventory', description: 'Per-vDC ownership, cluster, pool, nodes and primary storage' },
      { id: 'quotas', name: 'Quotas vs Usage', description: 'vCPU/RAM/storage/VM allocation and current consumption per vDC' },
      { id: 'network', name: 'Network', description: 'Tenant SDN VNets, VXLAN tags and firewall flag' },
      { id: 'ipam', name: 'IPAM', description: 'Subnets per VNet: CIDR, gateway, DHCP range and addressable host count' },
      { id: 'backup', name: 'Backup Bindings', description: 'PBS datastore + namespace bindings per vDC' }],
  },
]

function generateReportHistory(): any[] {
  const now = Date.now()
  const day = 24 * 3600 * 1000
  // [type, name, status, fileSize, generatedBy, createdDaysAgo, windowDays]
  const rows: [string, string, string, number, string, number, number][] = [
    ['infrastructure', 'Infrastructure Report - September', 'completed', 2_411_233, 'admin@demo.proxcenter.io', 0.2, 30],
    ['backup', 'Backup Report - last 7 days', 'completed', 986_442, 'admin@demo.proxcenter.io', 1, 7],
    ['site_recovery', 'Site Recovery readiness - Acme', 'completed', 1_204_889, 'alice@demo.proxcenter.io', 2, 30],
    ['security', 'Security Report - CVE sweep', 'completed', 3_872_015, 'admin@demo.proxcenter.io', 3, 30],
    ['capacity', 'Capacity planning - Q4', 'pending', 0, 'admin@demo.proxcenter.io', 0.02, 90],
    ['compliance', 'Compliance Report - CIS mapping', 'failed', 0, 'alice@demo.proxcenter.io', 5, 30],
    ['vdc', 'vDC Report - all tenants', 'completed', 745_190, 'admin@demo.proxcenter.io', 7, 30],
    ['utilization', 'Utilization Report - August', 'completed', 1_655_308, 'admin@demo.proxcenter.io', 12, 31],
  ]
  return rows.map((r, i) => {
    const [type, name, status, fileSize, generatedBy, createdDaysAgo, windowDays] = r
    const created = now - createdDaysAgo * day
    return {
      id: `demo-report-${String(i + 1).padStart(3, '0')}`,
      name,
      type,
      status,
      file_size: fileSize,
      // The CSV action in ReportHistory is gated on csv_size, so a report
      // without it stays PDF-only. The two oldest are left without one, the
      // way a report generated before the export existed would be.
      csv_size: status === 'completed' && i < 5 ? Math.round(fileSize * 0.11) : undefined,
      file_path: status === 'completed' ? `/var/lib/proxcenter/reports/demo-report-${i + 1}.pdf` : null,
      language: i % 3 === 0 ? 'fr' : 'en',
      date_from: new Date(created - windowDays * day).toISOString(),
      date_to: new Date(created).toISOString(),
      generated_by: generatedBy,
      created_at: new Date(created).toISOString(),
      completed_at: status === 'completed' ? new Date(created + 42_000).toISOString() : null,
      error: status === 'failed' ? 'Hardening scan timed out on DR Cluster (GRA)' : null,
      connections: ['demo-pve-cluster-001'],
    }
  })
}

function generateReportSchedules(): any[] {
  const now = Date.now()
  const day = 24 * 3600 * 1000
  return [
    {
      id: 'demo-sched-001', name: 'Weekly infrastructure review', type: 'infrastructure',
      frequency: 'weekly', day_of_week: 1, day_of_month: null, time_of_day: '07:00',
      recipients: ['ops@demo.proxcenter.io', 'admin@demo.proxcenter.io'],
      language: 'en', enabled: true, connections: ['demo-pve-cluster-001', 'demo-pve-dr-001'],
      last_run_at: new Date(now - 3 * day).toISOString(),
      next_run_at: new Date(now + 4 * day).toISOString(),
    },
    {
      id: 'demo-sched-002', name: 'Daily backup digest', type: 'backup',
      frequency: 'daily', day_of_week: null, day_of_month: null, time_of_day: '06:30',
      recipients: ['backup-team@demo.proxcenter.io'],
      language: 'en', enabled: true, connections: ['demo-pve-cluster-001'],
      last_run_at: new Date(now - 0.6 * day).toISOString(),
      next_run_at: new Date(now + 0.4 * day).toISOString(),
    },
    {
      id: 'demo-sched-003', name: 'Monthly capacity plan', type: 'capacity',
      frequency: 'monthly', day_of_week: null, day_of_month: 1, time_of_day: '08:00',
      recipients: ['cto@demo.proxcenter.io'],
      language: 'fr', enabled: false, connections: ['demo-pve-cluster-001'],
      last_run_at: new Date(now - 9 * day).toISOString(),
      next_run_at: null,
    },
  ]
}

// ---------------------------------------------------------------------------
// Helper: orchestrator jobs (Task Center) and live PVE tasks
//
// /operations/task-center reads /api/v1/orchestrator/jobs through useJobs(),
// with `{ data, stats }`. Both were empty, so the four counters sat at zero and
// the grid showed "No tasks" while the bottom bar advertised a migration in
// flight. Stats are derived from the job list exactly the way
// src/app/api/v1/orchestrator/jobs/route.ts derives them.
// ---------------------------------------------------------------------------

function generateOrchestratorJobs(): any[] {
  const now = Date.now()
  const min = 60 * 1000
  // [name, type, status, progress, target, detail, startedMinAgo, endedMinAgo]
  const rows: [string, string, string, number, string, string, number, number | null][] = [
    ['Migration api-gateway to pve-node-07', 'migration', 'running', 62, 'api-gateway (103)', 'Transferring disk 1/2, 24.1 GB of 40.0 GB', 4, null],
    ['Rolling Update - Production Cluster', 'rolling_update', 'paused', 42, 'Production Cluster', 'Waiting for approval on pve-node-06 (5/12 nodes)', 96, null],
    ['DRS rebalance - Production Cluster', 'drs', 'queued', 0, 'Production Cluster', '5 recommendations pending, manual mode', 12, null],
    ['Replication db-master to pve-dr-02', 'replication', 'failed', 18, 'db-master (101)', 'connection reset by peer after 41 min', 51, 43],
    ['Replication web-prod-01 to pve-dr-01', 'replication', 'success', 100, 'web-prod-01 (100)', '9.9 GB replicated in 3m 12s', 74, 71],
    ['Site Recovery test - Acme Production', 'site_recovery', 'success', 100, 'Recovery plan: Critical Infrastructure DR', '24 guests booted on DR Cluster (GRA), 0 error', 420, 388],
    ['Migration redis-cache to pve-node-11', 'migration', 'success', 100, 'redis-cache (103)', 'Online migration completed in 47s', 190, 189],
    ['DRS rebalance - Production Cluster', 'drs', 'success', 100, 'Production Cluster', '3 guests moved, imbalance 9% to 4%', 700, 688],
    ['Rolling Update - DR Cluster (GRA)', 'rolling_update', 'success', 100, 'DR Cluster (GRA)', '4/4 nodes updated to 8.4.1', 1500, 1402],
  ]
  return rows.map((r, i) => {
    const [name, type, status, progress, target, detail, startedMinAgo, endedMinAgo] = r
    return {
      id: `demo-job-${String(i + 1).padStart(3, '0')}`,
      name,
      type,
      status,
      progress,
      target,
      detail,
      startedAt: new Date(now - startedMinAgo * min).toISOString(),
      endedAt: endedMinAgo === null ? null : new Date(now - endedMinAgo * min).toISOString(),
      createdAt: new Date(now - (startedMinAgo + 1) * min).toISOString(),
      metadata: { connectionId: target.includes('DR') ? 'demo-pve-dr-001' : 'demo-pve-cluster-001' },
    }
  })
}

function summariseDemoJobs(jobs: any[]): any {
  return {
    total: jobs.length,
    running: jobs.filter(j => j.status === 'running').length,
    pending: jobs.filter(j => j.status === 'pending' || j.status === 'queued').length,
    success: jobs.filter(j => j.status === 'success' || j.status === 'completed').length,
    failed: jobs.filter(j => j.status === 'failed' || j.status === 'cancelled').length,
    paused: jobs.filter(j => j.status === 'paused').length,
  }
}

function generateRunningPveTasks(): any[] {
  const now = Date.now()
  // Mirrors the running migration the Task Center and the Events screen show.
  return [
    {
      id: 'UPID:pve-node-03:0001A2B3:0C4D5E6F:68C0D1E2:qmigrate:103:admin@pam:',
      startTime: new Date(now - 4 * 60 * 1000).toISOString(),
      type: 'qmigrate',
      typeLabel: 'Migrate VM',
      icon: 'ri-arrow-left-right-line',
      entity: '103',
      node: 'pve-node-03',
      user: 'admin@pam',
      durationSec: 240,
      connectionId: 'demo-pve-cluster-001',
      connectionName: 'Production Cluster',
    },
    {
      id: 'UPID:pve-node-08:0002C3D4:0E5F6071:68C0D1F0:vzdump:117:root@pam:',
      startTime: new Date(now - 95 * 1000).toISOString(),
      type: 'vzdump',
      typeLabel: 'Backup',
      icon: 'ri-archive-line',
      entity: '117',
      node: 'pve-node-08',
      user: 'root@pam',
      durationSec: 95,
      connectionId: 'demo-pve-cluster-001',
      connectionName: 'Production Cluster',
    },
  ]
}

function generateSharedTasks(): any[] {
  const now = Date.now()
  return [
    {
      id: 'demo-shared-001',
      kind: 'migration',
      label: 'Cross-cluster migration of web-prod-02',
      sourceVmName: 'web-prod-02',
      targetNode: 'pve-dr-01',
      targetVmid: 5102,
      status: 'running',
      currentStep: 'disk_transfer',
      progress: 38,
      totalDisks: 2,
      currentDisk: 1,
      bytesTransferred: 16 * 1024 ** 3,
      totalBytes: 42 * 1024 ** 3,
      transferSpeed: '412 MB/s',
      error: null,
      isMine: true,
      createdByName: 'Admin Demo',
      createdAt: new Date(now - 11 * 60 * 1000).toISOString(),
      startedAt: new Date(now - 10 * 60 * 1000).toISOString(),
      completedAt: null,
    },
  ]
}

// ---------------------------------------------------------------------------
// Helper: generate orchestrator alerts
//
// The alert wire contract is the Go orchestrator's, i.e. the `Alert` interface
// in src/lib/orchestrator/client.ts: snake_case, with `resource`,
// `resource_name`, `current_value`, `unit` and `last_seen_at`. The alert grid
// (/operations/alerts) reads those exact names, so camelCase left the Resource,
// Value and Last seen columns showing a dash. The summary is derived from the
// same list, the way src/app/api/v1/orchestrator/alerts/summary/route.ts
// derives it, so the two can never drift apart again.
// ---------------------------------------------------------------------------

function generateOrchestratorAlerts(): any[] {
  const now = Date.now()
  // [type, severity, message, resource, resourceType, resourceId, resourceName,
  //  currentValue, threshold, unit, status, connectionId]
  const rows: [string, string, string, string, string, number, string | null, number, number, string, string, string][] = [
    ['memory', 'critical', 'Node pve-node-03: RAM usage critical (94%)', 'pve-node-03', 'node', 0, null, 94, 90, '%', 'active', 'demo-pve-cluster-001'],
    ['cpu', 'warning', 'Node pve-node-07: CPU usage high (82%)', 'pve-node-07', 'node', 0, null, 82, 80, '%', 'active', 'demo-pve-cluster-001'],
    ['disk_latency', 'warning', 'VM db-master: disk I/O latency above 50ms', 'pve-node-02', 'vm', 101, 'db-master', 78, 50, 'ms', 'acknowledged', 'demo-pve-cluster-001'],
    ['event', 'info', 'Backup job vzdump-weekly completed with warnings', 'PBS_MASTER', 'storage', 0, null, 0, 0, '', 'resolved', 'demo-pve-cluster-001'],
    ['storage', 'critical', 'Ceph osd.10 is down on pve-dr-03', 'pve-dr-03', 'node', 0, null, 0, 0, '', 'active', 'demo-pve-dr-001'],
    ['storage', 'warning', 'Node pve-node-11: storage pool local-zfs usage 87%', 'pve-node-11', 'storage', 0, null, 87, 85, '%', 'active', 'demo-pve-cluster-001'],
    ['event', 'info', 'PBS datastore backup-main: garbage collection completed', 'PBS_MASTER', 'storage', 0, null, 0, 0, '', 'resolved', 'demo-pve-cluster-001'],
    ['custom', 'warning', 'VM web-prod-01: high network packet loss detected', 'pve-node-01', 'vm', 100, 'web-prod-01', 2.4, 1, '%', 'resolved', 'demo-pve-cluster-001'],
    ['osd_latency', 'critical', 'Ceph osd.3 on pve-node-04: apply latency 412ms (critical above 250ms)', 'pve-node-04', 'node', 0, null, 412, 250, 'ms', 'active', 'demo-pve-cluster-001'],
    ['replication_rpo', 'warning', 'Replication job 102-0 (db-master to pve-dr-02): last sync 41min ago, past its 30min RPO target', 'pve-node-02', 'vm', 101, 'db-master', 41, 30, 'min', 'active', 'demo-pve-cluster-001'],
    ['replication_failed', 'critical', 'Replication job 118-0 (mail-relay to pve-dr-02) failed: connection reset by peer', 'pve-node-05', 'vm', 118, 'mail-relay', 0, 0, '', 'active', 'demo-pve-cluster-001'],
  ]
  return rows.map((r, i) => {
    const [type, severity, message, resource, resourceType, resourceId, resourceName,
           currentValue, threshold, unit, status, connectionId] = r
    const firstSeen = new Date(now - (i + 1) * 3600000).toISOString()
    const lastSeen = new Date(now - i * 600000).toISOString()
    return {
      id: `alert-demo-${i}`,
      fingerprint: `fp-${i}`,
      _fingerprint: `fp-${i}`,
      connection_id: connectionId,
      type,
      severity,
      status,
      message,
      resource,
      resource_type: resourceType,
      resource_id: resourceId,
      resource_name: resourceName,
      current_value: currentValue,
      threshold,
      unit,
      occurrences: 2 + ((i * 3) % 9),
      first_seen_at: firstSeen,
      last_seen_at: lastSeen,
      acknowledged_at: status === 'acknowledged' ? new Date(now - 1800000).toISOString() : undefined,
      acknowledged_by: status === 'acknowledged' ? 'admin@demo.proxcenter.io' : undefined,
      resolved_at: status === 'resolved' ? new Date(now - i * 300000).toISOString() : undefined,
      notified_at: lastSeen,
      created_at: firstSeen,
      updated_at: lastSeen,
      silenced_until: null,
    }
  })
}

function summariseDemoAlerts(alerts: any[]): any {
  const today = new Date().toISOString().slice(0, 10)
  const active = alerts.filter(a => a.status === 'active')
  return {
    total_active: active.length,
    critical: active.filter(a => a.severity === 'critical').length,
    warning: active.filter(a => a.severity === 'warning').length,
    info: active.filter(a => a.severity === 'info').length,
    acknowledged: alerts.filter(a => a.status === 'acknowledged').length,
    resolved_today: alerts.filter(a => a.status === 'resolved' && String(a.resolved_at || '').startsWith(today)).length,
  }
}

// ---------------------------------------------------------------------------
// Helper: generate audit log entries
//
// getAuditLogs() (src/lib/audit/index.ts) re-maps Prisma camelCase to the
// snake_case wire contract the audit screen reads: `timestamp`, `user_email`,
// `resource_type`, `resource_name`, `ip_address`, `status`, `category` and a
// `details` JSON STRING. Emitting camelCase here left every one of those
// columns showing a dash.
// ---------------------------------------------------------------------------

const DEMO_AUDIT_ACTORS = [
  { id: 'demo-user-001', email: 'admin@demo.proxcenter.io', ip: '203.0.113.24' },
  { id: 'demo-user-002', email: 'alice@demo.proxcenter.io', ip: '203.0.113.31' },
  { id: 'demo-user-003', email: 'bob@acme.example', ip: '198.51.100.14' },
  { id: 'demo-user-005', email: 'dave@globex.example', ip: '198.51.100.77' },
  { id: 'demo-user-007', email: 'frank@initech.example', ip: '192.0.2.53' },
]

function generateAuditEntries(): any[] {
  // [category, action, resourceType, resourceId, resourceName, details, status, actorIndex]
  const rows: [string, string, string | null, string | null, string | null, Record<string, any> | null, string, number][] = [
    ['auth', 'login', 'user', 'demo-user-001', 'Admin Demo', { method: 'credentials', mfa: false }, 'success', 0],
    ['vms', 'start', 'vm', '100', 'web-prod-01', { node: 'pve-node-01', previousStatus: 'stopped' }, 'success', 0],
    ['backups', 'create', 'backup_job', 'job-nightly', 'vzdump-nightly', { schedule: '02:30', datastore: 'backup-main', guests: 42 }, 'success', 1],
    ['vms', 'migrate', 'vm', '102', 'api-gateway', { from: 'pve-node-03', to: 'pve-node-07', mode: 'online', durationSec: 47 }, 'success', 0],
    ['auth', 'login', 'user', 'demo-user-003', 'Bob Smith', { method: 'oidc', provider: 'keycloak' }, 'success', 2],
    ['storage', 'update', 'storage', 'CephStoragePool', 'CephStoragePool', { field: 'krbd', from: 0, to: 1 }, 'success', 1],
    ['vms', 'snapshot_create', 'vm', '101', 'db-master', { name: 'pre-upgrade', withRam: false }, 'success', 2],
    ['auth', 'login_failed', 'user', null, 'eve@globex.example', { method: 'credentials', reason: 'bad password', attempts: 3 }, 'failure', 3],
    ['security', 'role_assigned', 'rbac_assignment', 'demo-asg-006', 'Tenant Admin on Acme Corporation', { role: 'role_tenant_admin', target: 'bob@acme.example' }, 'success', 0],
    ['connections', 'test', 'connection', 'demo-pve-dr-001', 'DR Cluster (GRA)', { latencyMs: 18, tlsVerified: true }, 'success', 1],
    ['vms', 'stop', 'vm', '118', 'mail-relay', { node: 'pve-node-05', graceful: true }, 'success', 3],
    ['backups', 'restore', 'backup', 'backup-main/vm/104/1757308800', 'monitoring', { targetVmid: 904, storage: 'CephStoragePool' }, 'warning', 1],
    ['settings', 'update', 'settings', 'alerts', 'Alert thresholds', { cpuWarn: 80, ramWarn: 85, storageWarn: 85 }, 'success', 0],
    ['templates', 'create', 'blueprint', 'bp-web-node', 'Web node (Ubuntu 24.04)', { image: 'ubuntu-24.04-cloud', cores: 4, memoryMb: 8192 }, 'success', 4],
    ['nodes', 'update', 'node', 'pve-node-09', 'pve-node-09', { action: 'maintenance mode', enabled: true }, 'success', 0],
    ['users', 'create', 'user', 'demo-user-008', 'grace@initech.example', { tenant: 'Initech', role: 'role_tenant_admin' }, 'success', 0],
    ['vms', 'create', 'vm', '131', 'kafka-03', { node: 'pve-node-11', cores: 8, memoryMb: 16384, disk: '200G' }, 'success', 4],
    ['security', 'update', 'firewall_rule', 'grp-web-servers', 'web-servers', { direction: 'in', action: 'ACCEPT', dport: '443' }, 'success', 2],
    ['backups', 'delete', 'backup', 'backup-main/vm/112/1756704000', 'ci-runner', { reason: 'retention policy', keepDaily: 7 }, 'success', 1],
    ['connections', 'create', 'connection', 'demo-pbs-002', 'PBS Replica', { type: 'pbs', endpoint: 'https://10.20.30.9:8007' }, 'success', 0],
    ['vms', 'delete', 'vm', '905', 'monitoring-restore-test', { reason: 'DR test cleanup' }, 'success', 1],
    ['storage', 'create', 'storage', 'PBS_REPLICA', 'PBS_REPLICA', { type: 'pbs', datastore: 'backup-replica', nodes: 12 }, 'success', 0],
    ['auth', 'sessions_revoked_all', 'user', 'demo-user-006', 'eve@globex.example', { reason: 'repeated failed logins', sessions: 2 }, 'success', 0],
    ['system', 'update', 'system', 'orchestrator', 'Orchestrator', { from: '1.4.8', to: '1.4.9', restartSec: 12 }, 'success', 0],
  ]
  const now = Date.now()
  return rows.map((r, i) => {
    const [category, action, resourceType, resourceId, resourceName, details, status, actorIdx] = r
    const actor = DEMO_AUDIT_ACTORS[actorIdx]
    return {
      id: `demo-audit-${String(i + 1).padStart(3, '0')}`,
      timestamp: new Date(now - i * 47 * 60 * 1000).toISOString(),
      user_id: action === 'login_failed' ? null : actor.id,
      user_email: actor.email,
      action,
      category,
      resource_type: resourceType,
      resource_id: resourceId,
      resource_name: resourceName,
      details: details === null ? null : JSON.stringify(details),
      ip_address: actor.ip,
      user_agent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
      status,
      error_message: status === 'failure' ? 'Invalid credentials' : null,
      tenant_id: 'default',
    }
  })
}

/**
 * Build the /connections/<id>/ceph/rrd body. The route maps raw PVE RRD rows
 * into chart-ready keys (cpu in %, memUsed/netIn/diskRead...), so the mock has
 * to emit the MAPPED shape, not what generateRrdData() returns. Without it the
 * Ceph page shows "No RRD data available" under both node charts.
 */
function buildCephRrd(ceph: any, nodeName: string, timeframe: string): any {
  const rrd = generateRrdData(timeframe, undefined, `ceph:${nodeName}`).map(d => ({
    time: d.time,
    cpu: Math.round(d.cpu * 100 * 10) / 10,
    iowait: Math.round(d.iowait * 100 * 10) / 10,
    memUsed: d.memused,
    memTotal: d.memtotal,
    memPct: Math.round((d.memused / d.memtotal) * 100 * 10) / 10,
    netIn: d.netin,
    netOut: d.netout,
    diskRead: d.diskread,
    diskWrite: d.diskwrite,
    loadAvg: d.loadavg,
    swapUsed: d.swapused,
    swapTotal: d.swaptotal,
  }))
  const osds = ceph.osds.list.map((o: any) => ({
    id: o.id, name: o.name, host: o.host, status: o.status, up: o.up, in: o.in,
    deviceClass: o.deviceClass, commitLatencyMs: o.commitLatencyMs,
    applyLatencyMs: o.applyLatencyMs, usedPct: o.usedPct,
  }))
  const avg = (f: (o: any) => number) => osds.length
    ? Math.round((osds.reduce((acc: number, o: any) => acc + f(o), 0) / osds.length) * 10) / 10
    : 0
  const current = {
    readBytesSec: ceph.performance.readBytesSec,
    writeBytesSec: ceph.performance.writeBytesSec,
    readOpsSec: ceph.performance.readOpsSec,
    writeOpsSec: ceph.performance.writeOpsSec,
    recoveringBytesPerSec: 0,
    recoveringKeysPerSec: 0,
    recoveringObjectsPerSec: 0,
  }
  return {
    data: {
      timeframe,
      nodeName,
      rrd,
      current,
      pools: ceph.pools.list.map((pool: any) => ({
        name: pool.name, id: pool.id, bytesUsed: pool.bytes_used,
        percentUsed: pool.percent_used, maxAvail: pool.max_avail,
        objects: Math.round(pool.bytes_used / (4 * 1024 * 1024)),
      })),
      osds,
      latency: {
        avgCommit: avg(o => o.commitLatencyMs),
        avgApply: avg(o => o.applyLatencyMs),
        maxCommit: Math.max(...osds.map((o: any) => o.commitLatencyMs), 0),
        maxApply: Math.max(...osds.map((o: any) => o.applyLatencyMs), 0),
      },
      iops: {
        read: current.readOpsSec,
        write: current.writeOpsSec,
        total: current.readOpsSec + current.writeOpsSec,
        readThroughput: current.readBytesSec,
        writeThroughput: current.writeBytesSec,
      },
    },
  }
}

// ---------------------------------------------------------------------------
// Helper: generate change entries
// ---------------------------------------------------------------------------

function generateChangeEntries(): any[] {
  const now = Date.now()
  const actions: { action: string, field: string, oldValue: string, newValue: string }[] = [
    { action: 'config_change', field: 'memory', oldValue: '4096', newValue: '8192' },
    { action: 'config_change', field: 'cores', oldValue: '2', newValue: '4' },
    { action: 'config_change', field: 'description', oldValue: '', newValue: 'Production web server' },
    { action: 'status_change', field: 'status', oldValue: 'stopped', newValue: 'running' },
    { action: 'status_change', field: 'status', oldValue: 'running', newValue: 'stopped' },
    { action: 'migration', field: 'node', oldValue: 'pve-node-01', newValue: 'pve-node-03' },
    { action: 'migration', field: 'node', oldValue: 'pve-node-05', newValue: 'pve-node-02' },
    { action: 'config_change', field: 'net0', oldValue: 'virtio=AA:BB:CC:DD:EE:01,bridge=vmbr0', newValue: 'virtio=AA:BB:CC:DD:EE:01,bridge=vmbr1' },
    { action: 'snapshot', field: 'snapshot', oldValue: '', newValue: 'pre-upgrade-2026-03' },
    { action: 'config_change', field: 'boot', oldValue: 'order=scsi0', newValue: 'order=scsi0;net0' },
    { action: 'config_change', field: 'balloon', oldValue: '0', newValue: '2048' },
    { action: 'status_change', field: 'status', oldValue: 'paused', newValue: 'running' },
    { action: 'config_change', field: 'tags', oldValue: 'prod', newValue: 'prod;critical' },
    { action: 'config_change', field: 'onboot', oldValue: '0', newValue: '1' },
    { action: 'config_change', field: 'scsihw', oldValue: 'lsi', newValue: 'virtio-scsi-single' },
  ]
  const vmNames = ['web-prod-01','db-master','api-gateway','redis-cache','monitoring','mail-server','dns-primary','ldap-auth','ci-runner','vault-prod','web-prod-02','web-prod-03','db-replica-01','proxy-lb','elastic-node-01']
  const nodes = ['pve-node-01','pve-node-02','pve-node-03','pve-node-04','pve-node-05','pve-node-06']

  return actions.map((a, i) => ({
    id: `chg-${String(i + 1).padStart(3, '0')}`,
    resourceType: 'vm',
    resourceId: String(100 + i),
    resourceName: vmNames[i % vmNames.length],
    action: a.action,
    field: a.field,
    oldValue: a.oldValue,
    newValue: a.newValue,
    connectionId: 'demo-pve-cluster-001',
    connectionName: 'Production Cluster',
    node: nodes[i % nodes.length],
    timestamp: new Date(now - i * 3600 * 1000).toISOString(),
    detectedBy: 'polling',
  }))
}

// ---------------------------------------------------------------------------
// Helper: health score history (30 days)
// ---------------------------------------------------------------------------

function generateHealthHistory(): { date: string, score: number }[] {
  const now = new Date()
  return Array.from({ length: 30 }, (_, i) => {
    const d = new Date(now)
    d.setDate(d.getDate() - (29 - i))
    const score = 88 + Math.round(Math.random() * 8)
    return { date: d.toISOString().slice(0, 10), score: Math.min(96, score) }
  })
}

// ---------------------------------------------------------------------------
// Demo lockout response for mutations on flagship MSP routes.
// Returned by lookupMock to keep route handlers from running against an empty DB.
// ---------------------------------------------------------------------------

function demoLocked(): Response {
  return new Response(
    JSON.stringify({ error: "Action désactivée en mode démo" }),
    { status: 403, headers: { "Content-Type": "application/json" } }
  )
}

// ---------------------------------------------------------------------------
// Hardcoded mock responses for endpoints not in mock-data.json
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// RBAC catalogue
//
// The permission list is a named const because the role mocks below cite it:
// /api/v1/rbac/roles is expected to carry its own resolved permission rows
// (see src/app/api/v1/rbac/roles/route.ts), not just a count.
// ---------------------------------------------------------------------------

const DEMO_PERMISSIONS: any[] = [
  { id: 'perm-infra-view', name: 'infrastructure.view', category: 'Infrastructure', description: 'View infrastructure connections and overview', is_dangerous: false },
  { id: 'perm-infra-manage', name: 'infrastructure.manage', category: 'Infrastructure', description: 'Add, edit and remove infrastructure connections', is_dangerous: true },
  { id: 'perm-infra-nodes', name: 'infrastructure.nodes.view', category: 'Infrastructure', description: 'View node details and metrics', is_dangerous: false },
  { id: 'perm-vm-view', name: 'vms.view', category: 'VMs', description: 'View virtual machines list and details', is_dangerous: false },
  { id: 'perm-vm-start', name: 'vms.start', category: 'VMs', description: 'Start virtual machines', is_dangerous: false },
  { id: 'perm-vm-stop', name: 'vms.stop', category: 'VMs', description: 'Stop virtual machines', is_dangerous: true },
  { id: 'perm-vm-migrate', name: 'vms.migrate', category: 'VMs', description: 'Migrate virtual machines between nodes', is_dangerous: true },
  { id: 'perm-vm-snapshot', name: 'vms.snapshot', category: 'VMs', description: 'Create and manage VM snapshots', is_dangerous: false },
  { id: 'perm-vm-console', name: 'vms.console', category: 'VMs', description: 'Access VM console (noVNC / xterm)', is_dangerous: false },
  { id: 'perm-storage-view', name: 'storage.view', category: 'Storage', description: 'View storage pools and usage', is_dangerous: false },
  { id: 'perm-storage-manage', name: 'storage.manage', category: 'Storage', description: 'Create and configure storage pools', is_dangerous: true },
  { id: 'perm-storage-ceph', name: 'storage.ceph.manage', category: 'Storage', description: 'Manage Ceph cluster and replication', is_dangerous: true },
  { id: 'perm-backup-view', name: 'backups.view', category: 'Backups', description: 'View backup jobs and history', is_dangerous: false },
  { id: 'perm-backup-create', name: 'backups.create', category: 'Backups', description: 'Create backup jobs', is_dangerous: false },
  { id: 'perm-backup-restore', name: 'backups.restore', category: 'Backups', description: 'Restore from backups', is_dangerous: true },
  { id: 'perm-backup-pbs', name: 'backups.pbs.manage', category: 'Backups', description: 'Manage PBS connections and settings', is_dangerous: false },
  { id: 'perm-auto-playbooks', name: 'automation.playbooks', category: 'Automation', description: 'Create and run automation playbooks', is_dangerous: false },
  { id: 'perm-auto-schedules', name: 'automation.schedules', category: 'Automation', description: 'Manage scheduled tasks', is_dangerous: false },
  { id: 'perm-auto-drs', name: 'automation.drs', category: 'Automation', description: 'Configure Dynamic Resource Scheduling', is_dangerous: false },
  { id: 'perm-sec-audit', name: 'security.audit', category: 'Security', description: 'View audit logs', is_dangerous: false },
  { id: 'perm-sec-compliance', name: 'security.compliance', category: 'Security', description: 'Run compliance scans and view reports', is_dangerous: false },
  { id: 'perm-sec-cve', name: 'security.cve', category: 'Security', description: 'View CVE scanning results', is_dangerous: false },
  { id: 'perm-settings-general', name: 'settings.general', category: 'Settings', description: 'Manage general application settings', is_dangerous: false },
  { id: 'perm-settings-users', name: 'settings.users', category: 'Settings', description: 'Manage users and roles', is_dangerous: true },
  { id: 'perm-settings-branding', name: 'settings.branding', category: 'Settings', description: 'Configure white-label branding', is_dangerous: false },
  { id: 'perm-settings-auth', name: 'settings.auth', category: 'Settings', description: 'Configure SSO, LDAP and OIDC providers', is_dangerous: true },
  { id: 'perm-settings-notifications', name: 'settings.notifications', category: 'Settings', description: 'Configure notification channels and templates', is_dangerous: false },
]

function demoRole(id: string, name: string, description: string, color: string,
                  isSystem: boolean, permNames: string[] | '*', userCount: number): any {
  const granted = permNames === '*' ? DEMO_PERMISSIONS : DEMO_PERMISSIONS.filter(x => permNames.includes(x.name))
  return {
    id,
    name,
    description,
    is_system: isSystem,
    color,
    widget_overrides: null,
    default_scopes: null,
    tenant_id: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    permissions: granted,
    user_count: userCount,
  }
}

const DEMO_CEPH_PROD = buildCephData({
  nodeName: 'pve-node-01',
  healthStatus: 'HEALTH_OK',
  checks: [],
  osdCount: 36,
  osdUp: 36,
  osdHost: i => `pve-node-${String((i % 12) + 1).padStart(2, '0')}`,
  osdDeviceClass: i => (i < 24 ? 'ssd' : 'hdd'),
  osdUtilisation: 60,
  pgTotal: 256,
  pgStates: { 'active+clean': 256 },
  totalBytes: Math.round(21.67 * TiB / 0.602),
  usedBytes: Math.round(21.67 * TiB),
  replication: 3,
  readBytesSec: 52428800,
  writeBytesSec: 31457280,
  readOpsSec: 1840,
  writeOpsSec: 920,
  pools: [
    { id: 0, name: 'rbd-pool', size: 3, min_size: 2, pg_num: 128, type: 'replicated', crush_rule: 0, application: 'rbd', bytes_used: Math.round(51.6 * TiB), max_avail: Math.round(14.3 * TiB), percent_used: 55 },
    { id: 1, name: 'cephfs-data', size: 3, min_size: 2, pg_num: 64, type: 'replicated', crush_rule: 0, application: 'cephfs', bytes_used: Math.round(9.9 * TiB), max_avail: Math.round(14.3 * TiB), percent_used: 19 },
    { id: 2, name: 'rgw-pool', size: 3, min_size: 2, pg_num: 64, type: 'replicated', crush_rule: 0, application: 'rgw', bytes_used: Math.round(3.6 * TiB), max_avail: Math.round(14.3 * TiB), percent_used: 8 },
  ],
  monitorHosts: [
    { name: 'pve-node-01', addr: '10.10.20.1:6789/0' },
    { name: 'pve-node-02', addr: '10.10.20.2:6789/0' },
    { name: 'pve-node-03', addr: '10.10.20.3:6789/0' },
  ],
  mds: [
    { name: 'pve-node-01', host: 'pve-node-01', addr: '10.10.20.1:6801/1', state: 'active', rank: 0 },
    { name: 'pve-node-02', host: 'pve-node-02', addr: '10.10.20.2:6801/1', state: 'standby', rank: null },
  ],
})

const DEMO_CEPH_DR = buildCephData({
  nodeName: 'pve-dr-01',
  healthStatus: 'HEALTH_ERR',
  checks: [
    {
      name: 'OSD_DOWN',
      severity: 'HEALTH_ERR',
      summary: '2 osds down',
      detail: [
        'osd.10 (root=default,host=pve-dr-03) is down',
        'osd.11 (root=default,host=pve-dr-04) is down',
      ],
    },
    {
      name: 'PG_DEGRADED',
      severity: 'HEALTH_WARN',
      summary: 'Degraded data redundancy: 10 pgs undersized',
      detail: ['pg 1.3f is stuck undersized for 41m, acting [2,5]'],
    },
  ],
  osdCount: 12,
  osdUp: 10,
  osdHost: i => `pve-dr-0${(i % 4) + 1}`,
  osdUtilisation: 60,
  pgTotal: 128,
  pgStates: { 'active+clean': 118, 'active+undersized+degraded': 10 },
  totalBytes: 10 * TiB,
  usedBytes: 6 * TiB,
  replication: 3,
  readBytesSec: 10485760,
  writeBytesSec: 5242880,
  readOpsSec: 410,
  writeOpsSec: 260,
  pools: [
    { id: 0, name: 'rbd-dr', size: 3, min_size: 2, pg_num: 128, type: 'replicated', crush_rule: 0, application: 'rbd', bytes_used: 18 * TiB, max_avail: 4 * TiB, percent_used: 60 },
  ],
  monitorHosts: [
    { name: 'pve-dr-01', addr: '10.20.10.1:6789/0' },
    { name: 'pve-dr-02', addr: '10.20.10.2:6789/0' },
    { name: 'pve-dr-03', addr: '10.20.10.3:6789/0' },
  ],
})

const DEMO_APP_VERSION = '1.4.9'

/** Usable cluster storage, the figure the storage screens already advertise. */
const DEMO_CLUSTER_STORAGE_BYTES = 50 * 1000 ** 4

export const EXTRA_MOCKS: MockDataMap = {
  // --- Auth ---
  'GET:/api/v1/auth/session': {
    user: {
      id: 'demo-user',
      name: 'Admin Demo',
      email: 'admin@demo.proxcenter.io',
      role: 'super_admin',
      image: null,
    },
  },

  'GET:/api/v1/auth/providers': {
    credentials: {
      id: 'credentials',
      name: 'Credentials',
      type: 'credentials',
    },
  },

  'POST:/api/v1/auth/callback/credentials': {
    ok: true,
    url: '/home',
  },

  // --- App / Settings ---
  'GET:/api/v1/app/status': {
    data: {
      configured: true,
      hasAdmin: true,
      version: DEMO_APP_VERSION,
    },
    connectionsConfigured: true,
    hasConnections: true,
  },

  'GET:/api/v1/settings/branding/public': {
    enabled: false,
    appName: 'ProxCenter',
    logoUrl: '',
    faviconUrl: '',
    loginLogoUrl: '',
    primaryColor: '',
    browserTitle: '',
    poweredByVisible: true,
  },

  'GET:/api/v1/settings/branding': {
    enabled: false,
    appName: 'ProxCenter',
    logoUrl: '',
    faviconUrl: '',
    loginLogoUrl: '',
    primaryColor: '',
    browserTitle: '',
    poweredByVisible: true,
  },

  'GET:/api/v1/version': {
    data: { version: DEMO_APP_VERSION, edition: 'Enterprise' },
  },

  'GET:/api/v1/license/features': {
    data: {
      edition: 'enterprise',
      features: [
        'white_label',
        'sso',
        'ldap',
        'compliance',
        'api_access',
        'priority_support',
        'custom_roles',
        'advanced_monitoring',
        'migration',
        'drs',
        'ceph_replication',
        'cve_scanning',
        'change_tracking',
      ],
      options: ['control_plane_ha'],
    },
  },

  // --- License ---
  'GET:/api/v1/license/status': {
    licensed: true,
    expired: false,
    edition: 'enterprise',
    plan: 'enterprise',
    expiresAt: '2027-12-31T23:59:59.000Z',
    options: ['control_plane_ha'],
  },

  // --- User / RBAC ---
  'GET:/api/v1/rbac/me': {
    data: {
      userId: 'demo-user',
      roles: ['super_admin'],
      permissions: ['*'],
    },
  },

  'GET:/api/v1/rbac/effective': {
    data: {
      permissions: ['*'],
      roles: ['super_admin'],
      is_super_admin: true,
    },
  },

  'GET:/api/v1/rbac/roles': {
    data: [
      demoRole('role_super_admin', 'Super Admin', 'Full access to every feature and every tenant', '#ef4444', true, '*', 2),
      demoRole('role_tenant_admin', 'Tenant Admin', 'Full control over the tenant own vDCs, guests and backups', '#f59e0b', true, [
        'infrastructure.view', 'infrastructure.nodes.view',
        'vms.view', 'vms.start', 'vms.stop', 'vms.migrate', 'vms.snapshot', 'vms.console',
        'storage.view', 'backups.view', 'backups.create', 'backups.restore',
        'automation.playbooks', 'automation.schedules', 'automation.drs',
        'security.audit', 'security.compliance',
      ], 6),
      demoRole('role_operator', 'Operator', 'Day to day guest operations, no configuration change', '#3b82f6', false, [
        'infrastructure.view', 'infrastructure.nodes.view',
        'vms.view', 'vms.start', 'vms.stop', 'vms.snapshot', 'vms.console',
        'storage.view', 'backups.view', 'backups.create',
      ], 0),
      demoRole('role_viewer', 'Read only', 'Sees everything, changes nothing', '#64748b', true, [
        'infrastructure.view', 'infrastructure.nodes.view', 'vms.view',
        'storage.view', 'backups.view', 'security.audit',
      ], 0),
    ],
    meta: { total: 4 },
  },

  'GET:/api/v1/users/me': {
    data: {
      id: 'demo-user',
      name: 'Admin Demo',
      email: 'admin@demo.proxcenter.io',
      role: 'super_admin',
    },
  },

  // --- RBAC Assignments ---
  // --- Tenants ---
  'GET:/api/v1/tenants': {
    data: [
      { id: 'default', slug: 'default', name: 'ProxCenter Demo MSP', description: 'Provider workspace, manages every tenant.', enabled: true, operatingModel: 'msp', vmidRangeStart: null, vmidRangeEnd: null, settings: null, createdBy: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      { id: 'demo-tenant-acme', slug: 'acme', name: 'Acme Corporation', description: 'Customer with prod + DR vDCs.', enabled: true, operatingModel: 'iaas', vmidRangeStart: 1000, vmidRangeEnd: 1999, settings: null, createdBy: 'demo-user-001', createdAt: '2026-02-03T09:12:00.000Z', updatedAt: '2026-08-21T14:02:00.000Z' },
      { id: 'demo-tenant-globex', slug: 'globex', name: 'Globex SAS', description: 'Customer with a single production vDC.', enabled: true, operatingModel: 'iaas', vmidRangeStart: 2000, vmidRangeEnd: 2999, settings: null, createdBy: 'demo-user-001', createdAt: '2026-03-17T10:40:00.000Z', updatedAt: '2026-08-19T11:25:00.000Z' },
      { id: 'demo-tenant-initech', slug: 'initech', name: 'Initech', description: 'Customer with a single production vDC.', enabled: true, operatingModel: 'iaas', vmidRangeStart: 3000, vmidRangeEnd: 3999, settings: null, createdBy: 'demo-user-001', createdAt: '2026-04-02T15:05:00.000Z', updatedAt: '2026-09-01T08:47:00.000Z' },
    ],
  },

  // --- RBAC Permissions ---
  'GET:/api/v1/rbac/permissions': { data: DEMO_PERMISSIONS },

  // --- Compliance ---
  get 'GET:/api/v1/compliance/hardening/demo-pve-cluster-001'() {
    return buildHardeningReport('demo-pve-cluster-001', 'Production Cluster', false, 6)
  },
  get 'GET:/api/v1/compliance/hardening/demo-pve-dr-001'() {
    return buildHardeningReport('demo-pve-dr-001', 'DR Cluster (GRA)', true, 31)
  },
  'GET:/api/v1/compliance/policies': {
    data: [
      {
        id: 'pol-001',
        name: 'Production Security',
        description: 'Security policy for production clusters',
        enabled: true,
        rules: 12,
        lastEvaluation: '2026-03-10T14:30:00.000Z',
        score: 78,
      },
    ],
  },

  'GET:/api/v1/compliance/profiles': {
    data: [
      {
        id: 'prof-001',
        name: 'CIS Proxmox Benchmark',
        description: 'CIS compliance profile',
        type: 'cis',
        enabled: true,
        checkCount: 25,
        lastScan: '2026-03-10T14:30:00.000Z',
      },
    ],
  },

  // --- Settings AI ---
  'GET:/api/v1/settings/ai': {
    data: { enabled: false, provider: '', model: '', apiKey: '' },
  },

  // --- Settings Green IT ---
  'GET:/api/v1/settings/green': {
    data: { enabled: false },
  },

  // --- Notification settings ---
  'GET:/api/v1/orchestrator/notifications/settings': {
    data: {
      enabled: false,
      smtp: { host: '', port: 587, secure: true },
      slack: { webhookUrl: '' },
      discord: { webhookUrl: '' },
    },
  },

  // --- Auth providers (LDAP / OIDC) ---
  'GET:/api/v1/auth/ldap': {
    data: { enabled: false, url: '', baseDn: '', bindDn: '' },
  },

  'GET:/api/v1/auth/oidc': {
    data: { enabled: false, issuer: '', clientId: '', clientSecret: '' },
  },

  // --- Data endpoints ---
  'GET:/api/v1/alerts': { data: [] },
  'GET:/api/v1/alert-rules': { data: [] },

  // --- Orchestrator Alerts (for /operations/alerts page) ---
  get 'GET:/api/v1/orchestrator/alerts'() {
    const data = generateOrchestratorAlerts()
    return { data, total: data.length }
  },
  get 'GET:/api/v1/orchestrator/alerts/summary'() {
    return { data: summariseDemoAlerts(generateOrchestratorAlerts()) }
  },
  get 'GET:/api/v1/orchestrator/alerts/rules'() {
    return {
      data: [
        { id: 'rule-1', name: 'High CPU Usage', metric: 'cpu', operator: '>', threshold: 80, severity: 'warning', duration: 300, enabled: true, cooldown: 600 },
        { id: 'rule-2', name: 'Critical RAM Usage', metric: 'ram', operator: '>', threshold: 90, severity: 'critical', duration: 120, enabled: true, cooldown: 300 },
        { id: 'rule-3', name: 'Storage Almost Full', metric: 'storage', operator: '>', threshold: 85, severity: 'warning', duration: 600, enabled: true, cooldown: 1800 },
        { id: 'rule-4', name: 'Node Offline', metric: 'status', operator: '==', threshold: 0, severity: 'critical', duration: 60, enabled: true, cooldown: 120 },
        { id: 'rule-5', name: 'Backup Failed', metric: 'backup_status', operator: '==', threshold: 0, severity: 'warning', duration: 0, enabled: false, cooldown: 3600 },
      ],
    }
  },
  // Every key of DEFAULT_THRESHOLDS must appear here: a missing one renders its
  // card at the component default in demo mode, which reads as a feature that
  // silently forgot its own setting.
  //
  // The values are a demo tenant's choices, not the shipped defaults. The Ceph
  // latency check ships at 0, i.e. disabled, because no latency threshold suits
  // every disk; the demo turns it on so its card shows a configured state and
  // matches the osd_latency alert listed above.
  'GET:/api/v1/settings/alerts/thresholds': {
    cpu_warning: 80, cpu_critical: 90,
    memory_warning: 80, memory_critical: 90,
    storage_warning: 80, storage_critical: 90,
    snapshot_max_age_days: 7,
    recovery_margin: 5,
    recovery_confirmations: 3,
    osd_latency_warning: 100,
    osd_latency_critical: 250,
    // Same story for the guest disk latency check (#881): the demo has a
    // "Disk I/O latency" alert above, so its card shows the check enabled.
    disk_latency_warning: 30,
    disk_latency_critical: 100,
    disk_latency_window_minutes: 5,
    disk_latency_retention_days: 7,
    disk_latency_collection: 1,
    metrics_interval_seconds: 60,
    replication_rpo_grace_percent: 25,
    replication_failure_alerts: 1,
  },
  get 'GET:/api/v1/audit'() {
    const data = generateAuditEntries()
    return { data, meta: { total: data.length, limit: 100, offset: 0 } }
  },
  get 'GET:/api/v1/events'() {
    const now = Math.floor(Date.now() / 1000)
    const types = ['qmstart','qmstop','vzdump','qmmigrate','qmreboot','vzstart','pull','verify','garbage_collection']
    const labels = ['VM Start','VM Stop','Backup','Migration','VM Reboot','CT Start','Sync Pull','Verify','GC']
    const entities = ['web-prod-01','db-master','api-gateway','redis-cache','monitoring','mail-server','ci-runner','vault-prod','proxy-lb','elastic-node-01']
    const nodes = ['pve-node-01','pve-node-02','pve-node-03','pve-node-04','pve-node-05','pve-node-06']
    return {
      data: Array.from({ length: 20 }, (_, i) => {
        const startTs = now - i * 1800
        const endTs = i === 3 ? null : startTs + 30 + Math.floor(Math.random() * 120)
        const dur = endTs ? endTs - startTs : 0
        return {
          id: `UPID:${nodes[i % nodes.length]}:0000${String(i).padStart(4,'0')}:00000000:00000000:${types[i % types.length]}:${100 + i}:root@pam:`,
          type: types[i % types.length],
          status: i === 3 ? 'running' : (i === 7 ? 'WARNINGS' : 'OK'),
          level: i === 7 ? 'warning' : 'info',
          starttime: startTs,
          ts: new Date(startTs * 1000).toISOString(),
          endTs: endTs ? new Date(endTs * 1000).toISOString() : null,
          duration: dur > 60 ? `${Math.floor(dur / 60)}m ${dur % 60}s` : `${dur}s`,
          node: nodes[i % nodes.length],
          user: 'root@pam',
          entity: String(100 + i),
          entityName: entities[i % entities.length],
          typeLabel: labels[i % labels.length],
          message: labels[i % labels.length],
          connectionId: 'demo-pve-cluster-001',
          connectionName: 'Production Cluster',
        }
      }),
    }
  },
  get 'GET:/api/v1/tasks/running'() {
    const data = generateRunningPveTasks()
    return { data, count: data.length }
  },
  get 'GET:/api/v1/tasks/shared'() {
    return { data: generateSharedTasks() }
  },
  // --- VMware migration source ---
  // The demo advertises one ESXi source and migration is a flagship feature;
  // an empty source inventory left the migration wizard with nothing to pick.
  'GET:/api/v1/vmware/demo-esxi-001/status': {
    data: {
      status: 'online',
      host: 'https://10.10.10.60',
      version: 'VMware ESXi 8.0.3 build-24022510',
      licenseEdition: 'esxEnterprisePlus',
      licenseFull: 'VMware vSphere 8 Enterprise Plus',
      isVcenter: false,
      subType: 'esxi',
    },
  },
  'GET:/api/v1/vmware/demo-esxi-001/vms': {
    data: {
      connectionName: 'ESXi Datacenter',
      vms: [
        { vmid: 'vm-101', name: 'legacy-erp-01', status: 'running', cpu: 4, memory_size_MiB: 16384, power_state: 'poweredOn', guest_OS: 'windows2019srvNext_64Guest', committed: 187904819200, uncommitted: 32212254720, toolsStatus: 'toolsOk', toolsRunningStatus: 'guestToolsRunning', vcenterHost: 'esxi-01.demo.local', vcenterHostStatus: 'green', vcenterHostConnectionState: 'connected', vcenterHostPowerState: 'poweredOn' },
        { vmid: 'vm-102', name: 'legacy-fileserver', status: 'running', cpu: 2, memory_size_MiB: 8192, power_state: 'poweredOn', guest_OS: 'windows2016srv_64Guest', committed: 1099511627776, uncommitted: 0, toolsStatus: 'toolsOk', toolsRunningStatus: 'guestToolsRunning', vcenterHost: 'esxi-01.demo.local', vcenterHostStatus: 'green', vcenterHostConnectionState: 'connected', vcenterHostPowerState: 'poweredOn' },
        { vmid: 'vm-103', name: 'legacy-oracle-db', status: 'running', cpu: 8, memory_size_MiB: 65536, power_state: 'poweredOn', guest_OS: 'oracleLinux8_64Guest', committed: 2199023255552, uncommitted: 107374182400, toolsStatus: 'toolsOld', toolsRunningStatus: 'guestToolsRunning', vcenterHost: 'esxi-02.demo.local', vcenterHostStatus: 'green', vcenterHostConnectionState: 'connected', vcenterHostPowerState: 'poweredOn' },
        { vmid: 'vm-104', name: 'legacy-jenkins', status: 'stopped', cpu: 4, memory_size_MiB: 8192, power_state: 'poweredOff', guest_OS: 'ubuntu64Guest', committed: 214748364800, uncommitted: 0, toolsStatus: 'toolsNotInstalled', toolsRunningStatus: 'guestToolsNotRunning', vcenterHost: 'esxi-02.demo.local', vcenterHostStatus: 'green', vcenterHostConnectionState: 'connected', vcenterHostPowerState: 'poweredOn' },
        { vmid: 'vm-105', name: 'legacy-sharepoint', status: 'running', cpu: 6, memory_size_MiB: 32768, power_state: 'poweredOn', guest_OS: 'windows2019srvNext_64Guest', committed: 751619276800, uncommitted: 53687091200, toolsStatus: 'toolsOk', toolsRunningStatus: 'guestToolsRunning', vcenterHost: 'esxi-03.demo.local', vcenterHostStatus: 'yellow', vcenterHostConnectionState: 'connected', vcenterHostPowerState: 'poweredOn' },
        { vmid: 'vm-106', name: 'legacy-monitoring', status: 'suspended', cpu: 2, memory_size_MiB: 4096, power_state: 'suspended', guest_OS: 'centos8_64Guest', committed: 107374182400, uncommitted: 0, toolsStatus: 'toolsOk', toolsRunningStatus: 'guestToolsNotRunning', vcenterHost: 'esxi-03.demo.local', vcenterHostStatus: 'yellow', vcenterHostConnectionState: 'connected', vcenterHostPowerState: 'poweredOn' },
      ],
    },
  },

  // Explicit rather than left to the fallback: no announcement banner is the
  // correct answer here, and an explicit mock keeps it out of the "no mock"
  // warning that now guards the fallback.
  'GET:/api/v1/broadcasts/active': { data: [] },

  // --- Users: the seed list, with login dates re-stamped relative to now ---
  // The list itself lives in mock-data.json (8 users across the four demo
  // tenants). Only the timestamps are rebuilt here: a frozen `last_login_at`
  // ages into "121d ago" on the Users screen, which reads as an abandoned
  // instance. Everything else is passed straight through.
  get 'GET:/api/v1/users'() {
    const hoursAgo = [0.2, 3, 26, 51, 8, 74, 120, 190]
    const now = Date.now()
    const rows = ((MOCK_DATA['/api/v1/users'] as any)?.data || []) as any[]
    return {
      data: rows.map((u, i) => ({
        ...u,
        last_login_at: new Date(now - (hoursAgo[i % hoursAgo.length]) * 3600 * 1000).toISOString(),
        updated_at: new Date(now - (hoursAgo[i % hoursAgo.length]) * 3600 * 1000).toISOString(),
      })),
    }
  },

  // --- Dashboard shell: endpoints every page asks for ---
  // These fired on all 26 screens and every one of them landed on the
  // `{ data: [] }` fallback, which several of the consumers below cannot even
  // read (they expect a bare object or a bare array).

  // HA is an Enterprise add-on that this instance has simply not deployed:
  // an explicit idle config is the honest answer, and it is the shape
  // useHaConfig() types (a bare HaConfig, no { data } wrapper).
  'GET:/api/v1/ha/config': {
    enabled: false,
    vip: '',
    vipInterface: '',
    deploymentState: 'idle',
    deploymentStep: 0,
    deployedAt: null,
    nodes: [],
  },

  'GET:/api/v1/version/check': {
    currentVersion: DEMO_APP_VERSION,
    latestVersion: DEMO_APP_VERSION,
    updateAvailable: false,
    releaseUrl: null,
    releaseNotes: null,
    releaseDate: null,
    error: null,
  },

  get 'GET:/api/v1/orchestrator/health'() {
    return {
      status: 'ok',
      time: new Date().toISOString(),
      version: DEMO_APP_VERSION,
      components: {
        drs: { enabled: true, mode: 'manual', active_migrations: 0 },
        connections: {
          total: 2,
          connected: 2,
          details: [
            { id: 'demo-pve-cluster-001', name: 'Production Cluster', connected: true, last_seen: new Date().toISOString() },
            { id: 'demo-pve-dr-001', name: 'DR Cluster (GRA)', connected: true, last_seen: new Date().toISOString() },
          ],
        },
      },
    }
  },

  // No rolling update in flight. The route returns a bare array, so the
  // `{ data: [] }` fallback was the wrong TYPE, not just an empty answer.
  'GET:/api/v1/orchestrator/rolling-updates': [],

  get 'GET:/api/v1/changes/recent'() {
    return { data: generateChangeEntries().slice(0, 10) }
  },

  'GET:/api/v1/changes/settings': {
    data: { enabled: true, retention_days: 90, poll_interval_seconds: 60, track_vm_config: true, track_node_config: true, track_storage: true },
  },

  get 'GET:/api/v1/favorites'() {
    const now = Date.now()
    const rows: [string, string, number, string][] = [
      ['pve-node-01', 'qemu', 100, 'web-prod-01'],
      ['pve-node-02', 'qemu', 101, 'db-master'],
      ['pve-node-03', 'qemu', 104, 'web-prod-04'],
    ]
    return {
      data: rows.map(([node, vmType, vmid, vmName], i) => ({
        id: `demo-fav-00${i + 1}`,
        tenantId: 'default',
        userId: 'demo-user-001',
        vmKey: `demo-pve-cluster-001:${node}:${vmType}:${vmid}`,
        connectionId: 'demo-pve-cluster-001',
        node,
        vmType,
        vmid: String(vmid),
        vmName,
        createdAt: new Date(now - (i + 1) * 86400000).toISOString(),
      })),
    }
  },

  get 'GET:/api/v1/tags/entities'() {
    return {
      data: [
        // Semicolon-delimited strings, the PVE representation InventoryTree
        // splits on: an array lands as one comma-joined label.
        { entityType: 'cluster', id: 'demo-pve-cluster-001', name: 'Production Cluster', tags: 'site:rbx;tier:prod' },
        { entityType: 'cluster', id: 'demo-pve-dr-001', name: 'DR Cluster (GRA)', tags: 'site:gra;tier:dr' },
        { entityType: 'node', id: 'demo-pve-cluster-001:pve-node-01', connectionId: 'demo-pve-cluster-001', node: 'pve-node-01', tags: 'rack:a1;ssd' },
        { entityType: 'node', id: 'demo-pve-cluster-001:pve-node-02', connectionId: 'demo-pve-cluster-001', node: 'pve-node-02', tags: 'rack:a1;ssd' },
        { entityType: 'node', id: 'demo-pve-cluster-001:pve-node-11', connectionId: 'demo-pve-cluster-001', node: 'pve-node-11', tags: 'rack:b3;hdd' },
      ],
    }
  },

  get 'GET:/api/v1/orchestrator/alerts/active'() {
    return generateOrchestratorAlerts().filter(a => a.status === 'active')
  },

  // --- Cluster options and pools, both clusters ---
  'GET:/api/v1/connections/demo-pve-cluster-001/cluster/options': {
    data: {
      keyboard: 'fr',
      language: 'en',
      migration: { type: 'secure', network: '10.10.10.0/24' },
      'tag-style': { 'color-map': 'MASTER:4CAF50:FFFFFF;prod:1976D2:FFFFFF;dr:E65100:FFFFFF;ci:7B1FA2:FFFFFF', ordering: 'config', shape: 'circle' },
      'next-id': { lower: 100, upper: 9999 },
      console: 'xtermjs',
    },
  },
  'GET:/api/v1/connections/demo-pve-dr-001/cluster/options': {
    data: {
      keyboard: 'fr',
      language: 'en',
      migration: { type: 'secure', network: '10.20.10.0/24' },
      'next-id': { lower: 5000, upper: 9999 },
      console: 'xtermjs',
    },
  },
  'GET:/api/v1/connections/demo-pve-cluster-001/pools': {
    data: [
      { poolid: 'vdc-acme-acme-prod', comment: 'Acme Production' },
      { poolid: 'vdc-acme-acme-dr', comment: 'Acme Disaster Recovery' },
      { poolid: 'vdc-globex-globex-prod', comment: 'Globex Production' },
      { poolid: 'vdc-initech-initech-prod', comment: 'Initech Production' },
      { poolid: 'infra-shared', comment: 'Provider shared infrastructure' },
    ],
    restricted: false,
  },
  'GET:/api/v1/connections/demo-pve-dr-001/pools': {
    data: [
      { poolid: 'vdc-acme-acme-dr', comment: 'Acme Disaster Recovery' },
    ],
    restricted: false,
  },

  // --- Site Recovery: replication storage discovery ---
  // Shape of discoverReplicationStorages() in lib/proxmox/replicationDiscovery.
  // Empty engines made the page open on "No replication storage found" and hid
  // every tab behind that banner.
  'GET:/api/v1/connections/demo-pve-cluster-001/replication-storages': {
    engines: ['rbd', 'zfs'],
    rbd: [{ storage: 'CephStoragePool', pool: 'rbd-pool' }],
    zfs: [
      { storage: 'local-zfs', node: 'pve-node-01', pool: 'rpool/data', availBytes: 4_123_456_789_012, totalBytes: 10_995_116_277_760, availFormatted: '3.75 TB', active: true },
      { storage: 'local-zfs', node: 'pve-node-02', pool: 'rpool/data', availBytes: 3_871_234_567_890, totalBytes: 10_995_116_277_760, availFormatted: '3.52 TB', active: true },
      { storage: 'local-zfs', node: 'pve-node-03', pool: 'rpool/data', availBytes: 4_402_345_678_901, totalBytes: 10_995_116_277_760, availFormatted: '4.00 TB', active: true },
    ],
  },
  'GET:/api/v1/connections/demo-pve-dr-001/replication-storages': {
    engines: ['rbd', 'zfs'],
    rbd: [{ storage: 'CephStoragePool', pool: 'rbd-dr' }],
    zfs: [
      { storage: 'local-zfs', node: 'pve-dr-01', pool: 'rpool/data', availBytes: 2_198_765_432_109, totalBytes: 5_497_558_138_880, availFormatted: '2.00 TB', active: true },
      { storage: 'local-zfs', node: 'pve-dr-02', pool: 'rpool/data', availBytes: 1_987_654_321_098, totalBytes: 5_497_558_138_880, availFormatted: '1.81 TB', active: true },
    ],
  },

  // --- Profile: 2FA state and active sessions ---
  'GET:/api/v1/auth/2fa/status': {
    data: { enabled: false, enrolledAt: null, recoveryCodesRemaining: 0 },
  },
  get 'GET:/api/v1/auth/sessions'() {
    const now = Date.now()
    const min = 60 * 1000
    return {
      data: [
        {
          id: 'demo-session-001', current: true, browser: 'Chrome 131', os: 'Linux',
          userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36',
          ipAddress: '203.0.113.24',
          createdAt: new Date(now - 42 * min).toISOString(),
          lastSeenAt: new Date(now - min).toISOString(),
        },
        {
          id: 'demo-session-002', current: false, browser: 'Firefox 145', os: 'macOS',
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) Gecko/20100101 Firefox/145.0',
          ipAddress: '203.0.113.31',
          createdAt: new Date(now - 3 * 24 * 60 * min).toISOString(),
          lastSeenAt: new Date(now - 5 * 60 * min).toISOString(),
        },
      ],
    }
  },

  // --- DRS affinity rules (the orchestrator returns a bare array) ---
  'GET:/api/v1/orchestrator/drs/rules': [
    { id: 'demo-rule-001', name: 'Keep the web tier apart', type: 'anti-affinity', connection_id: 'demo-pve-cluster-001', enabled: true, required: true, vmids: [100, 270, 273], nodes: [], from_tag: false, from_pool: false },
    { id: 'demo-rule-002', name: 'Database pair on the same node', type: 'affinity', connection_id: 'demo-pve-cluster-001', enabled: true, required: false, vmids: [101, 272], nodes: [], from_tag: false, from_pool: false },
    { id: 'demo-rule-003', name: 'Licensed workloads on the SSD nodes', type: 'node-affinity', connection_id: 'demo-pve-cluster-001', enabled: true, required: true, vmids: [117, 118], nodes: ['pve-node-01', 'pve-node-02', 'pve-node-03'], from_tag: false, from_pool: false },
    { id: 'demo-rule-004', name: 'Tag: production spread', type: 'anti-affinity', connection_id: 'demo-pve-cluster-001', enabled: false, required: false, vmids: [], nodes: [], from_tag: true, from_pool: false },
  ],

  // --- Templates ---
  get 'GET:/api/v1/templates/catalog'() {
    return buildTemplateCatalog()
  },
  get 'GET:/api/v1/templates/blueprints'() {
    return { data: generateBlueprints() }
  },
  get 'GET:/api/v1/templates/deployments'() {
    return { data: generateDeployments() }
  },
  'GET:/api/v1/templates/custom-images': { data: [] },

  // --- Reports (raw arrays: see the note on generateReportHistory) ---
  'GET:/api/v1/orchestrator/reports/types': DEMO_REPORT_TYPES,
  'GET:/api/v1/orchestrator/reports/languages': [
    { code: 'en', name: 'English' },
    { code: 'fr', name: 'Français' },
  ],
  get 'GET:/api/v1/orchestrator/reports/schedules'() {
    return generateReportSchedules()
  },
  get 'GET:/api/v1/orchestrator/reports'() {
    const data = generateReportHistory()
    return { data, total: data.length }
  },

  get 'GET:/api/v1/orchestrator/jobs'() {
    const data = generateOrchestratorJobs()
    return { data, stats: summariseDemoJobs(data) }
  },

  // --- Changes (populated) ---
  get 'GET:/api/v1/changes'() {
    const entries = generateChangeEntries()
    return { data: entries, pagination: { total: entries.length, page: 1, limit: 50 } }
  },

  // --- Dashboard ---
  get 'GET:/api/v1/dashboard/metrics'() {
    // Derived, not hardcoded: these counters used to contradict the node list
    // as soon as the per-node load changed.
    const nodes = demoNodes('demo-pve-cluster-001')
    const avg = demoClusterAverages('demo-pve-cluster-001')
    const byCpu = [...nodes].sort((a, b) => (b.cpu || 0) - (a.cpu || 0)).slice(0, 5)
    const byRam = [...nodes]
      .sort((a, b) => ((b.mem || 0) / (b.maxmem || 1)) - ((a.mem || 0) / (a.maxmem || 1)))
      .slice(0, 5)
    const gib = 1024 ** 3
    return {
      data: {
        totalVMs: 171,
        runningVMs: 161,
        stoppedVMs: 10,
        totalNodes: 12,
        onlineNodes: 12,
        totalClusters: 1,
        totalCPUCores: 768,
        avgCPUUsage: avg.cpu,
        avgRAMUsage: avg.ram,
        healthScore: 94,
        totalStorageGB: 51200,
        usedStorageGB: 28160,
        storageUsagePercent: 55.0,
        totalMemoryGB: Math.round(avg.memTotalBytes / gib),
        usedMemoryGB: Math.round(avg.memUsedBytes / gib),
        uptimePercent: 99.97,
        vmsByStatus: { running: 161, stopped: 8, paused: 2 },
        topNodesByCPU: byCpu.map(n => ({ node: n.node, cpu: Math.round((n.cpu || 0) * 1000) / 10 })),
        topNodesByRAM: byRam.map(n => ({ node: n.node, ram: Math.round(((n.mem || 0) / (n.maxmem || 1)) * 1000) / 10 })),
      },
    }
  },

  get 'GET:/api/v1/dashboard'() {
    const resources = demoResources('demo-pve-cluster-001')
    const nodesData = demoNodes('demo-pve-cluster-001')
    const drResources = demoResources('demo-pve-dr-001')

    const vms = resources.filter((r: any) => r.type === 'qemu')
    const lxcs = resources.filter((r: any) => r.type === 'lxc')
    const runningVms = vms.filter((v: any) => v.status === 'running')
    const runningLxc = lxcs.filter((v: any) => v.status === 'running')

    // Top CPU consumers
    const topCpu = [...resources].filter((r: any) => r.status === 'running' && r.cpu > 0)
      .sort((a: any, b: any) => (b.cpu || 0) - (a.cpu || 0))
      .slice(0, 10)
      .map((v: any) => ({ name: v.name || `VM ${v.vmid}`, value: Math.round((v.cpu || 0) * 100 * 10) / 10 }))

    // Top RAM consumers
    const topRam = [...resources].filter((r: any) => r.status === 'running' && r.mem > 0)
      .sort((a: any, b: any) => (b.mem || 0) - (a.mem || 0))
      .slice(0, 10)
      .map((v: any) => ({ name: v.name || `VM ${v.vmid}`, value: Math.round(((v.mem || 0) / (v.maxmem || 1)) * 100 * 10) / 10 }))

    // Node list
    const nodesList = nodesData.map((n: any) => ({
      name: n.node,
      node: n.node,
      connId: 'demo-pve-cluster-001',
      connectionId: 'demo-pve-cluster-001',
      connection: 'Production Cluster',
      status: n.status || 'online',
      cpuPct: Math.round((n.cpu || 0) * 100 * 10) / 10,
      memPct: Math.round(((n.mem || 0) / (n.maxmem || 1)) * 100 * 10) / 10,
      uptime: 86400 * (7 + Math.floor(Math.random() * 30)),
      _cpuCores: n.maxcpu || 4,
      _storageUsed: 50 * 1073741824,
      _storageMax: 200 * 1073741824,
    }))

    // DR Cluster nodes (4 nodes)
    // The DR nodes used to be invented here with Math.random() and a
    // connection id that exists nowhere else. Read the real list instead, so
    // the dashboard, the inventory tree and the DRS panel agree.
    const drNodesData = demoNodes('demo-pve-dr-001')
    const drNodes = drNodesData.map((n: any) => ({
      name: n.node,
      node: n.node,
      connId: 'demo-pve-dr-001',
      connectionId: 'demo-pve-dr-001',
      connection: 'DR Cluster (GRA)',
      status: n.status || 'online',
      cpuPct: Math.round((n.cpu || 0) * 1000) / 10,
      memPct: Math.round(((n.mem || 0) / (n.maxmem || 1)) * 1000) / 10,
      uptime: n.uptime,
      _cpuCores: n.maxcpu || 32,
      _storageUsed: n.disk || 0,
      _storageMax: n.maxdisk || 0,
    }))

    nodesList.push(...drNodes)

    // Total provisioned vCPUs and memory
    const totalProvCpu = resources.reduce((s: number, r: any) => s + (r.maxcpu || 0), 0)
    const totalProvMem = resources.reduce((s: number, r: any) => s + (r.maxmem || 0), 0)
    const totalProvDisk = resources.reduce((s: number, r: any) => s + (r.maxdisk || 0), 0)
    const totalPhysCpu = nodesData.reduce((s: number, n: any) => s + (n.maxcpu || 0), 0)
    const totalPhysMem = nodesData.reduce((s: number, n: any) => s + (n.maxmem || 0), 0)
    const totalUsedMem = nodesData.reduce((s: number, n: any) => s + (n.mem || 0), 0)
    const avgCpu = nodesData.length > 0 ? nodesData.reduce((s: number, n: any) => s + (n.cpu || 0), 0) / nodesData.length * 100 : 0

    const formatBytes = (b: number) => {
      if (b >= 1099511627776) return `${(b / 1099511627776).toFixed(1)} TB`
      if (b >= 1073741824) return `${(b / 1073741824).toFixed(0)} GB`
      return `${(b / 1048576).toFixed(0)} MB`
    }

    // VM list
    const vmList = vms.map((v: any, idx: number) => {
      // Override some VMs to show varied states in heatmap
      let status = v.status
      let cpuOverride = v.cpu || 0
      let memOverride = v.mem || 0
      const maxmem = v.maxmem || 1

      if (idx === 5 || idx === 12) { status = 'paused'; cpuOverride = 0 }
      else if (idx === 8 || idx === 22) { status = 'stopped'; cpuOverride = 0; memOverride = 0 }
      else if (idx === 3) { cpuOverride = 0.92 } // CPU critical
      else if (idx === 7) { cpuOverride = 0.78 } // CPU high
      else if (idx === 15) { memOverride = maxmem * 0.95 } // RAM critical
      else if (idx === 19) { cpuOverride = 0.65; memOverride = maxmem * 0.88 } // both high
      else if (idx === 25) { cpuOverride = 0.85 } // CPU high
      else if (idx === 30) { memOverride = maxmem * 0.92 } // RAM critical

      return {
        vmid: v.vmid, name: v.name, node: v.node, type: 'qemu',
        status, template: v.template || false,
        connId: 'demo-pve-cluster-001',
        cpu: cpuOverride, cpuPct: Math.round(cpuOverride * 100 * 10) / 10,
        mem: memOverride, maxmem,
        ramPct: maxmem ? Math.round((memOverride / maxmem) * 100 * 10) / 10 : 0,
        connection: 'Production Cluster',
      }
    })

    const lxcList = lxcs.map((v: any) => ({
      vmid: v.vmid, name: v.name, node: v.node, type: 'lxc',
      status: v.status, template: v.template || false,
      connId: 'demo-pve-cluster-001',
      cpu: v.cpu || 0, cpuPct: Math.round((v.cpu || 0) * 100 * 10) / 10,
      mem: v.mem || 0, maxmem: v.maxmem || 0,
      ramPct: v.maxmem ? Math.round((v.mem / v.maxmem) * 100 * 10) / 10 : 0,
      connection: 'Production Cluster',
    }))

    return {
      data: {
        summary: {
          // Both PVE connections: the tree already counts 2 clusters and 16
          // nodes, a dashboard stuck on "1 / 12" contradicts it on the very
          // same screen.
          clusters: 2,
          nodes: nodesData.length + drNodesData.length,
          nodesOnline: nodesData.filter((n: any) => n.status === 'online').length
            + drNodesData.filter((n: any) => (n.status || 'online') === 'online').length,
          nodesOffline: 0,
          vmsRunning: runningVms.length,
          vmsTotal: vms.length + drResources.length,
          lxcRunning: runningLxc.length,
          lxcTotal: lxcs.length,
          cpuPct: Math.round(avgCpu * 10) / 10,
          ramPct: Math.round((totalUsedMem / totalPhysMem) * 100 * 10) / 10,
        },
        resources: {
          cpuPct: Math.round(avgCpu * 10) / 10,
          cpuCores: totalPhysCpu,
          provCpuPct: Math.round((totalProvCpu / totalPhysCpu) * 100 * 10) / 10,
          provCpu: totalProvCpu,
          ramPct: Math.round((totalUsedMem / totalPhysMem) * 100 * 10) / 10,
          memUsedFormatted: formatBytes(totalUsedMem),
          memMaxFormatted: formatBytes(totalPhysMem),
          provMemPct: Math.round((totalProvMem / totalPhysMem) * 100 * 10) / 10,
          provMemFormatted: formatBytes(totalProvMem),
          storagePct: 55,
          storageUsedFormatted: '27.5 TB',
          storageMaxFormatted: '50.0 TB',
          provStoragePct: Math.round((totalProvDisk / DEMO_CLUSTER_STORAGE_BYTES) * 100 * 10) / 10,
          provDiskFormatted: formatBytes(totalProvDisk),
        },
        topCpu,
        topRam,
        nodes: nodesList,
        guests: {
          vms: {
            running: runningVms.length,
            stopped: vms.length - runningVms.length,
            templates: vms.filter((v: any) => v.template).length,
          },
          lxc: {
            running: runningLxc.length,
            stopped: lxcs.length - runningLxc.length,
          },
        },
        clusters: [
          {
            id: 'demo-pve-cluster-001',
            name: 'Production Cluster',
            nodes: nodesData.length,
            onlineNodes: nodesData.filter((n: any) => n.status === 'online').length,
            isCluster: true,
            quorum: { quorate: true, votes: nodesData.length, expected_votes: nodesData.length },
            cephHealth: 'HEALTH_OK',
          },
          {
            id: 'demo-pve-cluster-002',
            name: 'DR Cluster (GRA)',
            nodes: 4,
            onlineNodes: 4,
            isCluster: true,
            quorum: { quorate: true, votes: 4, expected_votes: 4 },
            cephHealth: 'HEALTH_OK',
          },
        ],
        ceph: {
          available: true,
          health: 'HEALTH_OK',
          usedPct: 42,
          osdsUp: 36,
          osdsTotal: 36,
          pgsTotal: 256,
          readBps: 52428800,
          writeBps: 31457280,
        },
        cephClusters: [
          {
            connId: 'demo-pve-cluster-001',
            name: 'Production Cluster',
            health: 'HEALTH_OK',
            osdsTotal: 36, osdsUp: 36, osdsIn: 36,
            pgsTotal: 256,
            bytesTotal: 21474836480000, bytesUsed: 9019431321600,
            usedPct: 42,
            readBps: 52428800, writeBps: 31457280,
          },
          {
            connId: 'demo-pve-cluster-002',
            name: 'DR Cluster (GRA)',
            health: 'HEALTH_ERR',
            osdsTotal: 12, osdsUp: 10, osdsIn: 10,
            pgsTotal: 128,
            bytesTotal: 8589934592000, bytesUsed: 6442450944000,
            usedPct: 75,
            readBps: 10485760, writeBps: 5242880,
          },
        ],
        pbs: {
          servers: 2,
          usagePct: 40,
          totalUsedFormatted: '8.0 TB',
          totalSizeFormatted: '20.0 TB',
          backups24h: { total: 45, ok: 44, error: 1 },
          verify24h: { ok: 38 },
          serverDetails: [
            { name: 'PBS Master', datastores: 1, usagePct: 50 },
            { name: 'PBS Replica', datastores: 1, usagePct: 30 },
          ],
          recentErrors: [],
        },
        // Derived from the same list the Alerts screen shows, in the dashboard
        // shape (DashboardAlert in lib/alerts/dashboardAlertMerge). The two
        // hardcoded warnings that used to sit here contradicted the alert
        // screen's own count on the very same page load.
        alertsSummary: demoDashboardAlertsSummary(),
        alerts: demoDashboardAlerts(),
        vmList,
        lxcList,
      },
    }
  },

  'GET:/api/v1/dashboard/layout': { data: { id: 'demo-layout', name: 'Default', isActive: true, widgets: [
    { id: 'sec-1', type: 'section-header', x: 0, y: 0, w: 12, h: 1, settings: { title: 'General' } },
    { id: 'kpi-1', type: 'kpi-clusters', x: 0, y: 1, w: 1, h: 7 },
    { id: 'kpi-2', type: 'kpi-vms', x: 1, y: 4, w: 1, h: 4 },
    { id: 'kpi-3', type: 'kpi-lxc', x: 1, y: 1, w: 1, h: 3 },
    { id: 'kpi-4', type: 'kpi-alerts', x: 11, y: 1, w: 1, h: 7 },
    { id: 'clusters-g', type: 'clusters-gauges', x: 2, y: 1, w: 5, h: 7 },
    { id: 'resources-1', type: 'resources-gauges', x: 7, y: 1, w: 2, h: 7 },
    { id: 'drs-1', type: 'drs-status', x: 9, y: 1, w: 2, h: 7 },
    { id: 'sec-2', type: 'section-header', x: 0, y: 18, w: 12, h: 1, settings: { title: 'Cluster / Ceph' } },
    { id: 'ceph-1', type: 'ceph-status', x: 0, y: 8, w: 3, h: 10 },
    { id: 'infra-1', type: 'infra-global-chart', x: 3, y: 8, w: 6, h: 10 },
    { id: 'heatmap-1', type: 'vm-heatmap', x: 9, y: 8, w: 3, h: 10 },
  ] } },

  // --- Inventory (non-stream) ---
  get 'GET:/api/v1/inventory'() {
    const connections = (MOCK_DATA['/api/v1/connections'] as any)?.data || []
    const nodesData = demoNodes('demo-pve-cluster-001')
    const resources = demoResources('demo-pve-cluster-001')
    const pveConns = connections.filter((c: any) => c.type === 'pve')
    const pbsConns = connections.filter((c: any) => c.type === 'pbs')

    const clusters = pveConns.map((c: any) => ({
      id: c.id, name: c.name, type: 'pve', status: 'online',
      nodes: nodesData.map((n: any) => ({
        ...n,
        guests: resources.filter((r: any) => r.node === n.node),
      })),
    }))

    const pbs = pbsConns.map((c: any) => ({
      id: c.id, name: c.name, type: 'pbs', status: 'online',
    }))

    return { data: { clusters, pbs } }
  },

  // --- VMs list ---
  get 'GET:/api/v1/vms'() {
    const resources = demoResources('demo-pve-cluster-001')
    const vms = resources.map((r: any) => ({
      ...r,
      connId: 'demo-pve-cluster-001',
      connName: 'Production Cluster',
    }))
    return { data: { vms } }
  },

  // --- Storage overview ---
  // Flattens every PVE connection's demo storage into the real aggregated
  // contract ({ data: AggregatedStorage[], stats, connections }) so the
  // Storage Overview page (which reads a flat data array) works in demo mode
  // the same way it does against a live cluster (see #569).
  get 'GET:/api/v1/storage'() {
    const connections = (MOCK_DATA['/api/v1/connections'] as any)?.data || []
    const pveConns = connections.filter((c: any) => c.type === 'pve')

    const rawEntries: any[] = []

    for (const conn of pveConns) {
      const storages = (MOCK_DATA[`/api/v1/connections/${conn.id}/storage`] as any)?.data || []

      for (const s of storages) {
        const nodeList = Array.isArray(s.nodes) && s.nodes.length ? s.nodes : [s.node].filter(Boolean)

        for (const node of nodeList) {
          rawEntries.push(normalizeStorageEntry({ ...s, node, connId: conn.id, connName: conn.name }))
        }
      }
    }

    const data = aggregateStorage(rawEntries)
    const stats = {
      total: data.length,
      shared: data.filter(s => s.shared).length,
      local: data.filter(s => !s.shared).length,
      totalCapacity: data.reduce((a, s) => a + (s.total || 0), 0),
      usedCapacity: data.reduce((a, s) => a + (s.used || 0), 0),
    }

    return { data, stats, connections: pveConns.map((c: any) => ({ id: c.id, name: c.name })) }
  },

  // --- Resources overview ---
  get 'GET:/api/v1/resources/overview'() {
    const resources = demoResources('demo-pve-cluster-001')
    const storageData = (MOCK_DATA['/api/v1/connections/demo-pve-cluster-001/storage'] as any)?.data || []

    const topCpuVms = [...resources].sort((a: any, b: any) => (b.cpu || 0) - (a.cpu || 0)).slice(0, 5).map((v: any) => ({
      vmid: v.vmid, name: v.name, node: v.node, cpu: v.cpu, maxcpu: v.maxcpu || 4,
    }))
    const topRamVms = [...resources].sort((a: any, b: any) => (b.mem || 0) - (a.mem || 0)).slice(0, 5).map((v: any) => ({
      vmid: v.vmid, name: v.name, node: v.node, mem: v.mem, maxmem: v.maxmem,
    }))

    const seen = new Set<string>()
    const storagePools = storageData.filter((s: any) => {
      if (seen.has(s.storage)) return false
      seen.add(s.storage)
      return true
    })

    return {
      data: {
        kpis: {
          // Derived: a hardcoded 3.4% contradicted the very charts drawn
          // underneath it once the per-node load was spread out.
          cpu: { used: demoClusterAverages('demo-pve-cluster-001').cpu, allocated: 105.5, total: 100, trend: -0.2 },
          ram: { used: demoClusterAverages('demo-pve-cluster-001').ram, allocated: 78.5, total: 100, trend: 0.5 },
          storage: { used: 28160000000000, total: 51200000000000, trend: 1.2 },
          vms: { total: 171, running: 161, stopped: 10 },
          efficiency: 82,
        },
        trends: generateRrdData('day', undefined, 'capacity-trends').map(p => {
          const d = new Date(p.time * 1000)
          return {
            t: d.toISOString().slice(0, 10),
            cpu: Math.round(p.cpu * 1000) / 10,
            ram: Math.round((p.memused / p.memtotal) * 1000) / 10,
            storage: 55 + Math.round(Math.random() * 30) / 10,
          }
        }),
        topCpuVms,
        topRamVms,
        storagePools,
        overprovisioning: {
          cpu: {
            allocated: 684,
            used: 26,
            physical: 768,
            ratio: 0.89,
            efficiency: 3.8,
          },
          ram: {
            allocated: 2560,
            used: 2049,
            physical: 3072,
            ratio: 0.83,
            efficiency: 79.6,
          },
          perNode: [
            { name: 'pve-node-01', cpuRatio: 0.92, ramRatio: 0.85, cpuAllocated: 59, cpuPhysical: 64, ramAllocated: 218, ramPhysical: 256 },
            { name: 'pve-node-02', cpuRatio: 0.88, ramRatio: 0.91, cpuAllocated: 56, cpuPhysical: 64, ramAllocated: 233, ramPhysical: 256 },
            { name: 'pve-node-03', cpuRatio: 0.95, ramRatio: 0.78, cpuAllocated: 61, cpuPhysical: 64, ramAllocated: 200, ramPhysical: 256 },
            { name: 'pve-node-04', cpuRatio: 0.84, ramRatio: 0.82, cpuAllocated: 54, cpuPhysical: 64, ramAllocated: 210, ramPhysical: 256 },
            { name: 'pve-node-05', cpuRatio: 0.91, ramRatio: 0.87, cpuAllocated: 58, cpuPhysical: 64, ramAllocated: 223, ramPhysical: 256 },
            { name: 'pve-node-06', cpuRatio: 0.86, ramRatio: 0.80, cpuAllocated: 55, cpuPhysical: 64, ramAllocated: 205, ramPhysical: 256 },
          ],
          topOverprovisioned: [
            { vmid: '112', name: 'ci-runner', node: 'pve-node-03', cpuAllocated: 8, cpuUsedPct: 5.2, ramAllocatedGB: 16, ramUsedPct: 12.1, recommendedCpu: 2, recommendedRamGB: 4, potentialSavings: { cpu: 6, ramGB: 12 } },
            { vmid: '118', name: 'dev-staging', node: 'pve-node-05', cpuAllocated: 4, cpuUsedPct: 3.8, ramAllocatedGB: 8, ramUsedPct: 15.4, recommendedCpu: 1, recommendedRamGB: 2, potentialSavings: { cpu: 3, ramGB: 6 } },
            { vmid: '125', name: 'test-env-02', node: 'pve-node-01', cpuAllocated: 4, cpuUsedPct: 8.1, ramAllocatedGB: 8, ramUsedPct: 22.3, recommendedCpu: 2, recommendedRamGB: 4, potentialSavings: { cpu: 2, ramGB: 4 } },
          ],
        },
        healthScoreHistory: generateHealthHistory(),
        connections: [{ id: 'demo-pve-cluster-001', name: 'Production Cluster' }],
      },
    }
  },

  // --- PBS Status ---
  'GET:/api/v1/pbs/demo-pbs-001/status': {
    data: { totalSize: 10995116277760, usedSize: 5497558138880, usagePercent: 50, uptime: 864000, version: '3.2-1' },
  },
  'GET:/api/v1/pbs/demo-pbs-002/status': {
    data: { totalSize: 10995116277760, usedSize: 3298534883328, usagePercent: 30, uptime: 432000, version: '3.2-1' },
  },

  // --- PBS Datastores ---
  'GET:/api/v1/pbs/demo-pbs-001/datastores': {
    data: [{
      name: 'backup-main', path: '/mnt/datastore/backup-main', comment: 'Main backup store',
      total: 10995116277760, used: 5497558138880, available: 5497558138880, usagePercent: 50,
      backupCount: 342, vmCount: 45, ctCount: 0, hostCount: 3,
    }],
  },
  'GET:/api/v1/pbs/demo-pbs-002/datastores': {
    data: [{
      name: 'backup-replica', path: '/mnt/datastore/backup-replica', comment: 'Replica store',
      total: 10995116277760, used: 3298534883328, available: 7696581394432, usagePercent: 30,
      backupCount: 285, vmCount: 40, ctCount: 0, hostCount: 3,
    }],
  },

  // --- PBS Backups ---
  get 'GET:/api/v1/pbs/demo-pbs-001/backups'() {
    const backups = generateBackupEntries(20, 'pbs1', 'backup-main')
    const verifiedCount = backups.filter((b: any) => b.verified).length
    return {
      data: {
        backups,
        stats: { total: 342, vmCount: 300, ctCount: 42, hostCount: 0, totalSize: 1099511627776, totalSizeFormatted: '1.00 TB', verifiedCount, protectedCount: 1 },
        pagination: { page: 1, pageSize: 50, totalPages: 7, totalItems: 342, hasNext: true, hasPrev: false },
        warnings: [],
      },
    }
  },
  get 'GET:/api/v1/pbs/demo-pbs-002/backups'() {
    const backups = generateBackupEntries(15, 'pbs2', 'backup-replica')
    const verifiedCount = backups.filter((b: any) => b.verified).length
    return {
      data: {
        backups,
        stats: { total: 285, vmCount: 250, ctCount: 35, hostCount: 0, totalSize: 879609302221, totalSizeFormatted: '819.20 GB', verifiedCount, protectedCount: 1 },
        pagination: { page: 1, pageSize: 50, totalPages: 6, totalItems: 285, hasNext: true, hasPrev: false },
        warnings: [],
      },
    }
  },

  // --- PBS Jobs ---
  'GET:/api/v1/pbs/demo-pbs-001/jobs': {
    data: { jobs: [], datastores: ['backup-main'], stats: { total: 2, running: 0, scheduled: 2 } },
  },
  'GET:/api/v1/pbs/demo-pbs-002/jobs': {
    data: { jobs: [], datastores: ['backup-replica'], stats: { total: 1, running: 0, scheduled: 1 } },
  },

  // --- Backup Jobs per connection ---
  get 'GET:/api/v1/connections/demo-pve-cluster-001/backup-jobs'() {
    const now = Math.floor(Date.now() / 1000)
    const dayInSec = 86400
    const nextRun2am = now - (now % dayInSec) + dayInSec + 7200
    const lastRun2am = nextRun2am - dayInSec
    const dayOfWeek = new Date().getDay()
    const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek
    const nextSunday3am = now - (now % dayInSec) + daysUntilSunday * dayInSec + 10800
    const lastSunday3am = nextSunday3am - 7 * dayInSec
    return {
      data: {
        jobs: [
          {
            id: 'backup-daily-001', type: 'vzdump', enabled: true, schedule: '0 2 * * *',
            mode: 'snapshot', compress: 'zstd', storage: 'PBS_MASTER_RBX', mailnotification: 'always',
            vmid: 'all', node: null, comment: 'Daily backup - all VMs',
            next_run: nextRun2am, last_run: lastRun2am, last_status: 'ok',
          },
          {
            id: 'backup-weekly-001', type: 'vzdump', enabled: true, schedule: '0 3 * * 0',
            mode: 'snapshot', compress: 'zstd', storage: 'PBS_MASTER_RBX',
            vmid: '100,101,102,104', node: null, comment: 'Weekly backup - critical VMs',
            next_run: nextSunday3am, last_run: lastSunday3am, last_status: 'ok',
          },
        ],
        allBackupStorages: ['PBS_MASTER_RBX', 'local'],
        nodes: ['pve-node-01','pve-node-02','pve-node-03','pve-node-04','pve-node-05','pve-node-06','pve-node-07','pve-node-08','pve-node-09','pve-node-10','pve-node-11','pve-node-12'],
      },
    }
  },

  // --- Orchestrator / Task Center ---
  // --- DRS ---
  // Note: DRS API routes return data directly (no { data: ... } wrapper)
  get 'GET:/api/v1/orchestrator/drs/status'() {
    return {
      enabled: true, mode: 'manual',
      recommendations: 5,
      active_migrations: 0,
      pending_count: 5,
      approved_count: 0,
      clusters: {
        'demo-pve-cluster-001': {
          score: 92, status: 'balanced',
          lastEvaluation: new Date(Date.now() - 300000).toISOString(),
          recommendations: 5,
        },
      },
    }
  },
  get 'GET:/api/v1/orchestrator/drs/recommendations'() {
    const now = Date.now()
    const nodes = ['pve-node-01','pve-node-02','pve-node-03','pve-node-04','pve-node-05','pve-node-06','pve-node-07','pve-node-08','pve-node-09','pve-node-10','pve-node-11','pve-node-12']
    const vmNames = ['web-prod-01','db-master','api-gateway','redis-cache','monitoring','mail-server','ci-runner','vault-prod','elastic-node-01','proxy-lb']
    const reasons = [
      'Memory imbalance: pve-node-02 at 82.3% vs pve-node-08 at 45.1%',
      'CPU imbalance: pve-node-03 at 8.2% vs pve-node-10 at 1.1%',
      'Memory pressure on pve-node-09 (78.1%) — moving VM to pve-node-04 (52.3%)',
      'Homogenization: spreading VMs more evenly across nodes',
      'Storage I/O contention on pve-node-07 — relocate to pve-node-11',
    ]
    return Array.from({ length: 5 }, (_, i) => {
      const src = nodes[i * 2 % nodes.length]
      const tgt = nodes[(i * 2 + 5) % nodes.length]
      return {
        id: `rec-${String(i + 1).padStart(3, '0')}`,
        connection_id: 'demo-pve-cluster-001',
        vmid: 100 + i * 3,
        vm_name: vmNames[i],
        guest_type: 'qemu',
        source_node: src,
        target_node: tgt,
        reason: reasons[i],
        priority: ['medium','high','medium','low','high'][i],
        score: [78, 85, 72, 65, 81][i],
        created_at: new Date(now - (i + 1) * 600000).toISOString(),
        status: 'pending',
        confirmation_count: 3,
        last_seen_at: new Date(now - i * 60000).toISOString(),
        maintenance_evacuation: false,
      }
    })
  },
  get 'GET:/api/v1/orchestrator/drs/migrations'() {
    const now = Date.now()
    return [
      {
        id: 'mig-001',
        recommendation_id: 'rec-prev-001',
        connection_id: 'demo-pve-cluster-001',
        vmid: 115,
        vm_name: 'web-prod-02',
        guest_type: 'qemu',
        source_node: 'pve-node-06',
        target_node: 'pve-node-01',
        task_id: 'UPID:pve-node-01:000ABCDE:12345678:67890ABC:qmigrate:115:root@pam:',
        started_at: new Date(now - 3600000).toISOString(),
        completed_at: new Date(now - 3300000).toISOString(),
        status: 'completed',
      },
      {
        id: 'mig-002',
        recommendation_id: 'rec-prev-002',
        connection_id: 'demo-pve-cluster-001',
        vmid: 128,
        vm_name: 'db-replica-01',
        guest_type: 'qemu',
        source_node: 'pve-node-09',
        target_node: 'pve-node-04',
        task_id: 'UPID:pve-node-04:000ABCDF:12345679:67890ABD:qmigrate:128:root@pam:',
        started_at: new Date(now - 7200000).toISOString(),
        completed_at: new Date(now - 6900000).toISOString(),
        status: 'completed',
      },
    ]
  },
  'GET:/api/v1/orchestrator/drs/settings': {
    enabled: true,
    mode: 'manual',
    balancing_method: 'memory',
    balancing_mode: 'used',
    balance_types: ['vm', 'ct'],
    maintenance_nodes: [],
    excluded_clusters: [],
    excluded_nodes: {},
    cluster_modes: { 'demo-pve-cluster-001': 'manual' },
    cpu_high_threshold: 80,
    cpu_low_threshold: 20,
    memory_high_threshold: 85,
    memory_low_threshold: 25,
    storage_high_threshold: 90,
    imbalance_threshold: 5,
    homogenization_enabled: true,
    max_load_spread: 10,
    cpu_weight: 1.0,
    memory_weight: 1.0,
    storage_weight: 0.5,
    max_concurrent_migrations: 2,
    max_concurrent_migrations_per_cluster: 0,
    max_target_inflow_per_cycle: 0,
    migration_cooldown: '5m',
    balance_larger_first: false,
    prevent_overprovisioning: true,
    enable_affinity_rules: true,
    enforce_affinity: false,
    rebalance_schedule: 'interval',
    rebalance_interval: '15m',
    rebalance_time: '10:00',
  },
  get 'GET:/api/v1/orchestrator/metrics'() {
    // Reads the same node figures as the inventory: a DRS panel that
    // contradicts the cluster it is balancing is worse than an empty one.
    const build = (connId: string, connName: string, pveVersion: number) => {
      const nodes = demoNodes(connId)
      const resources = demoResources(connId)
      const avg = demoClusterAverages(connId)
      const perNode = nodes.map(n => {
        const guests = resources.filter(g => g.node === n.node)
        return {
          node: n.node,
          status: n.status || 'online',
          cpu_usage: Math.round((n.cpu || 0) * 1000) / 10,
          memory_usage: Math.round(((n.mem || 0) / (n.maxmem || 1)) * 1000) / 10,
          vm_count: guests.length,
          ct_count: 0,
          running_vms: guests.filter(g => g.status === 'running').length,
          in_maintenance: false,
        }
      })
      // Imbalance as the standard deviation of per-node CPU, the usual DRS
      // measure: max-minus-min overstates it on a fleet with one idle spare.
      const cpus = perNode.map(n => n.cpu_usage)
      const mean = cpus.length > 0 ? cpus.reduce((a, b) => a + b, 0) / cpus.length : 0
      const spread = cpus.length > 0
        ? Math.sqrt(cpus.reduce((acc, c) => acc + (c - mean) ** 2, 0) / cpus.length)
        : 0
      return {
        connection_id: connId,
        connection_name: connName,
        collected_at: new Date().toISOString(),
        nodes: perNode,
        summary: {
          total_nodes: perNode.length,
          online_nodes: perNode.filter(n => n.status === 'online').length,
          total_vms: resources.filter(g => g.vmid).length,
          running_vms: resources.filter(g => g.vmid && g.status === 'running').length,
          avg_cpu_usage: avg.cpu,
          avg_memory_usage: avg.ram,
          imbalance: Math.round(spread * 10) / 10,
        },
        pve_version: pveVersion,
      }
    }
    return {
      'demo-pve-cluster-001': build('demo-pve-cluster-001', 'Production Cluster', 8),
      'demo-pve-dr-001': build('demo-pve-dr-001', 'DR Cluster (GRA)', 8),
    }
  },

  // --- Replication / Site Recovery ---
  // Note: these API routes return data directly (no { data: ... } wrapper)
  get 'GET:/api/v1/orchestrator/replication/status'() {
    const now = Date.now()
    return {
      // SiteCard (DashboardTab.tsx) reads cluster_id / role / node_count /
      // vm_count. The former id / type / nodes / vms keys left both cards
      // labelled "DR" with an empty "nodes · VMs" line.
      sites: [
        {
          cluster_id: 'demo-pve-cluster-001',
          name: 'Production Cluster (RBX)',
          role: 'primary',
          status: 'online',
          node_count: 12,
          vm_count: 171,
        },
        {
          cluster_id: 'demo-pve-dr-001',
          name: 'DR Cluster (GRA)',
          role: 'dr',
          status: 'online',
          node_count: 4,
          vm_count: 24,
        },
      ],
      connectivity: 'connected',
      latency_ms: 8.4,
      kpis: {
        protected_vms: 24,
        unprotected_vms: 147,
        avg_rpo_seconds: 900,
        last_sync: new Date(now - 420000).toISOString(),
        replicated_bytes: 536870912000,
        error_count: 0,
        total_jobs: 3,
        rpo_compliance: 96,
        concurrent_jobs: 1,
        max_concurrent_jobs: 4,
      },
      recent_activity: [
        { type: 'sync_completed', job_id: 'repl-001', message: 'Sync completed for job "Critical VMs"', timestamp: new Date(now - 420000).toISOString() },
        { type: 'sync_completed', job_id: 'repl-002', message: 'Sync completed for job "Database Servers"', timestamp: new Date(now - 900000).toISOString() },
        { type: 'sync_started', job_id: 'repl-003', message: 'Sync started for job "Web Frontends"', timestamp: new Date(now - 1200000).toISOString() },
        { type: 'sync_completed', job_id: 'repl-003', message: 'Sync completed for job "Web Frontends"', timestamp: new Date(now - 1080000).toISOString() },
        { type: 'rpo_met', job_id: 'repl-001', message: 'RPO target met for all jobs', timestamp: new Date(now - 1800000).toISOString() },
      ],
      job_summary: {
        synced: 3,
        syncing: 0,
        pending: 0,
        error: 0,
        paused: 0,
      },
    }
  },
  get 'GET:/api/v1/orchestrator/replication/jobs'() {
    const now = Date.now()
    return [
      {
        id: 'repl-001',
        vm_ids: [100, 101, 102, 104],
        vm_names: ['web-prod-01', 'db-master', 'api-gateway', 'redis-cache'],
        tags: [],
        source_cluster: 'demo-pve-cluster-001',
        target_cluster: 'demo-pve-dr-001',
        target_pool: 'rbd-dr',
        vmid_prefix: 9000,
        status: 'synced',
        schedule: '*/15 * * * *',
        rpo_target: 900,
        last_sync: new Date(now - 420000).toISOString(),
        next_sync: new Date(now + 480000).toISOString(),
        throughput_bps: 125829120,
        rate_limit_mbps: 500,
        network_mapping: { 'vmbr0': 'vmbr0', 'vmbr1': 'vmbr1' },
        progress_percent: 100,
        created_at: new Date(now - 30 * 86400000).toISOString(),
        updated_at: new Date(now - 420000).toISOString(),
      },
      {
        id: 'repl-002',
        vm_ids: [103, 110, 111],
        vm_names: ['db-replica-01', 'postgres-main', 'mysql-analytics'],
        tags: [],
        source_cluster: 'demo-pve-cluster-001',
        target_cluster: 'demo-pve-dr-001',
        target_pool: 'rbd-dr',
        vmid_prefix: 9000,
        status: 'synced',
        schedule: '*/15 * * * *',
        rpo_target: 900,
        last_sync: new Date(now - 900000).toISOString(),
        next_sync: new Date(now + 300000).toISOString(),
        throughput_bps: 83886080,
        rate_limit_mbps: 500,
        network_mapping: { 'vmbr0': 'vmbr0' },
        progress_percent: 100,
        created_at: new Date(now - 25 * 86400000).toISOString(),
        updated_at: new Date(now - 900000).toISOString(),
      },
      {
        id: 'repl-003',
        vm_ids: [105, 106, 107, 108, 109, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122, 123],
        vm_names: ['monitoring', 'mail-server', 'dns-primary', 'ldap-auth', 'ci-runner', 'vault-prod', 'elastic-node-01', 'proxy-lb', 'web-prod-02', 'web-prod-03', 'grafana', 'dev-staging', 'test-env-01', 'test-env-02', 'jenkins', 'sonarqube', 'nexus'],
        tags: [],
        source_cluster: 'demo-pve-cluster-001',
        target_cluster: 'demo-pve-dr-001',
        target_pool: 'rbd-dr',
        vmid_prefix: 9000,
        status: 'synced',
        schedule: '0 */2 * * *',
        rpo_target: 7200,
        last_sync: new Date(now - 1080000).toISOString(),
        next_sync: new Date(now + 5400000).toISOString(),
        throughput_bps: 209715200,
        rate_limit_mbps: 500,
        network_mapping: { 'vmbr0': 'vmbr0', 'vmbr1': 'vmbr1' },
        progress_percent: 100,
        created_at: new Date(now - 20 * 86400000).toISOString(),
        updated_at: new Date(now - 1080000).toISOString(),
      },
    ]
  },
  'GET:/api/v1/orchestrator/replication/plans': [
    {
      id: 'plan-001',
      name: 'Critical Infrastructure DR',
      description: 'Failover plan for critical production VMs (web, db, api, cache)',
      status: 'ready',
      source_cluster: 'demo-pve-cluster-001',
      target_cluster: 'demo-pve-dr-001',
      vms: [
        { vm_id: 100, vm_name: 'web-prod-01', replication_job_id: 'repl-001', tier: 1, boot_order: 1 },
        { vm_id: 101, vm_name: 'db-master', replication_job_id: 'repl-001', tier: 1, boot_order: 2 },
        { vm_id: 102, vm_name: 'api-gateway', replication_job_id: 'repl-001', tier: 1, boot_order: 3 },
        { vm_id: 104, vm_name: 'redis-cache', replication_job_id: 'repl-001', tier: 2, boot_order: 4 },
      ],
      last_test: new Date(Date.now() - 7 * 86400000).toISOString(),
      last_failover: null,
      created_at: new Date(Date.now() - 28 * 86400000).toISOString(),
      updated_at: new Date(Date.now() - 7 * 86400000).toISOString(),
    },
  ],

  // --- DR Cluster ---
  'GET:/api/v1/connections/demo-pve-dr-001/nodes': {
    data: [
      { node: 'pve-dr-01', status: 'online', cpu: 0.02, maxcpu: 32, mem: 34359738368, maxmem: 68719476736, disk: 5368709120, maxdisk: 20939620352, uptime: 864000 },
      { node: 'pve-dr-02', status: 'online', cpu: 0.03, maxcpu: 32, mem: 30064771072, maxmem: 68719476736, disk: 4294967296, maxdisk: 20939620352, uptime: 864000 },
      { node: 'pve-dr-03', status: 'online', cpu: 0.01, maxcpu: 32, mem: 27917287424, maxmem: 68719476736, disk: 3221225472, maxdisk: 20939620352, uptime: 864000 },
      { node: 'pve-dr-04', status: 'online', cpu: 0.02, maxcpu: 32, mem: 25769803776, maxmem: 68719476736, disk: 4294967296, maxdisk: 20939620352, uptime: 864000 },
    ],
  },
  get 'GET:/api/v1/connections/demo-pve-dr-001/resources'() {
    return { data: generateDrResources() }
  },
  'GET:/api/v1/connections/demo-pve-dr-001/ceph/status': {
    data: { health: { status: 'HEALTH_OK' }, osdmap: { num_osds: 12, num_up_osds: 12, num_in_osds: 12 } },
  },
  'GET:/api/v1/connections/demo-pve-dr-001/ceph': { data: DEMO_CEPH_DR },
  'GET:/api/v1/connections/demo-pve-cluster-001/ceph-vms': {
    data: Array.from({ length: 24 }, (_, i) => ({ vmid: 100 + i, cephDiskGb: 50 + Math.floor(Math.random() * 200) })),
  },
  'GET:/api/v1/connections/demo-pve-cluster-001/ceph': { data: DEMO_CEPH_PROD },
  'GET:/api/v1/connections/demo-pve-cluster-001/ceph/flags': { data: { flags: [] } },
  'GET:/api/v1/connections/demo-pve-dr-001/ceph/flags': { data: { flags: ['noout', 'norebalance'] } },
  'GET:/api/v1/connections/demo-pve-dr-001/ceph-vms': { data: [] },
  'GET:/api/v1/connections/demo-pve-dr-001/ha': {
    data: { groups: [], resources: [], rules: [], majorVersion: 8 },
  },

  // --- Firewall ---
  'GET:/api/v1/firewall/cluster/demo-pve-cluster-001': {
    enable: 1,
    policy_in: 'DROP',
    policy_out: 'ACCEPT',
    connectionId: 'demo-pve-cluster-001',
    connectionName: 'Production Cluster',
  },
  'GET:/api/v1/firewall/groups/demo-pve-cluster-001': [
    { group: 'web-servers' },
    { group: 'db-servers' },
    { group: 'monitoring' },
    { group: 'management' },
    { group: 'dmz' },
  ],

  // --- HA ---
  'GET:/api/v1/connections/demo-pve-cluster-001/ha': {
    data: { groups: [], resources: [], rules: [], majorVersion: 8 },
  },

  // --- VMs networks (POST) ---
  'POST:/api/v1/vms/networks': {
    data: {
      'vmbr0': { name: 'vmbr0', type: 'bridge', vms: 171, nodes: ['pve-node-01', 'pve-node-02', 'pve-node-03', 'pve-node-04', 'pve-node-05', 'pve-node-06'] },
      'vmbr1': { name: 'vmbr1', type: 'bridge', vms: 45, nodes: ['pve-node-01', 'pve-node-02', 'pve-node-03'] },
    },
  },
}

// ---------------------------------------------------------------------------
// URL matching helpers
// ---------------------------------------------------------------------------

/** Strip query string from a URL path */
function stripQuery(urlPath: string): string {
  const idx = urlPath.indexOf('?')
  return idx === -1 ? urlPath : urlPath.substring(0, idx)
}

/** Replace any connection ID segment with the demo connection ID */
const CONNECTION_ID_RE = /\/connections\/([^/]+)/
function normaliseConnectionId(urlPath: string): string {
  return urlPath.replace(CONNECTION_ID_RE, `/connections/${DEMO_CONNECTION_ID}`)
}

/** Known demo PBS IDs */
const DEMO_PBS_IDS = ['demo-pbs-001', 'demo-pbs-002']

/** Replace any PBS ID segment with the first matching demo PBS ID */
const PBS_ID_RE = /\/pbs\/([^/]+)/
function normalisePbsId(urlPath: string): string {
  const match = urlPath.match(PBS_ID_RE)
  if (!match) return urlPath
  const requestedId = decodeURIComponent(match[1])
  // If the ID is already a known demo PBS ID, keep it
  if (DEMO_PBS_IDS.includes(requestedId)) return urlPath
  // Otherwise, map to the first demo PBS ID
  return urlPath.replace(PBS_ID_RE, `/pbs/${DEMO_PBS_IDS[0]}`)
}

/** Replace any node name segment with the first demo node name */
const NODE_NAME_RE = /\/nodes\/([^/]+)/
function normaliseNodeName(urlPath: string): string {
  return urlPath.replace(NODE_NAME_RE, `/nodes/${DEMO_NODE_NAME}`)
}

// ---------------------------------------------------------------------------
// Lookup logic
// ---------------------------------------------------------------------------

/**
 * Try to find a mock response for the given method + path combination.
 *
 * Matching strategy (in order):
 *  1. Method-specific exact match in EXTRA_MOCKS  (e.g. "GET:/api/v1/auth/session")
 *  2. Exact path match in MOCK_DATA               (GET only, since JSON has no method prefix)
 *  3. Replace connection ID → retry 1 & 2
 *  4. Replace node name → retry 1 & 2
 *  5. Prefix match for /monitoring/* wildcard
 *  6. Fallback: unmatched GET → { data: [] }
 *  7. Otherwise null
 */
const DEMO_FALLBACK_WARN_LIMIT = 500
const warnedFallbackPaths = new Set<string>()

function lookupMock(method: string, urlPath: string): any | Response | null {
  const cleanPath = stripQuery(urlPath)
  const methodKey = `${method}:${cleanPath}`

  // --- 1. Exact match (method-prefixed) in EXTRA_MOCKS ---
  if (EXTRA_MOCKS[methodKey] !== undefined) return EXTRA_MOCKS[methodKey]

  // --- 2. Exact match in MOCK_DATA (GET only — JSON keys have no method prefix) ---
  if (method === 'GET' && MOCK_DATA[cleanPath] !== undefined) return MOCK_DATA[cleanPath]

  // --- 3. Normalise connection ID and retry ---
  const withDemoConn = normaliseConnectionId(cleanPath)
  if (withDemoConn !== cleanPath) {
    const connMethodKey = `${method}:${withDemoConn}`
    if (EXTRA_MOCKS[connMethodKey] !== undefined) return EXTRA_MOCKS[connMethodKey]
    if (method === 'GET' && MOCK_DATA[withDemoConn] !== undefined) return MOCK_DATA[withDemoConn]
  }

  // --- 4. Normalise node name and retry ---
  const withDemoNode = normaliseNodeName(withDemoConn)
  if (withDemoNode !== withDemoConn) {
    const nodeMethodKey = `${method}:${withDemoNode}`
    if (EXTRA_MOCKS[nodeMethodKey] !== undefined) return EXTRA_MOCKS[nodeMethodKey]
    if (method === 'GET' && MOCK_DATA[withDemoNode] !== undefined) return MOCK_DATA[withDemoNode]
  }

  // --- 4b. Normalise PBS ID and retry ---
  if (cleanPath.includes('/pbs/')) {
    const withDemoPbs = normalisePbsId(cleanPath)
    if (withDemoPbs !== cleanPath) {
      const pbsMethodKey = `${method}:${withDemoPbs}`
      if (EXTRA_MOCKS[pbsMethodKey] !== undefined) return EXTRA_MOCKS[pbsMethodKey]
      if (method === 'GET' && MOCK_DATA[withDemoPbs] !== undefined) return MOCK_DATA[withDemoPbs]
    }
  }

  // --- Demo lockout for v1.4 flagship MSP mutations ---
  if (method !== 'GET') {
    const lockedPrefixes = [
      '/api/v1/admin/vdcs',
      '/api/v1/admin/datacenters',
      '/api/v1/admin/pbs-connections',
      '/api/v1/admin/green-assignments',
      '/api/v1/admin/connections',
      '/api/v1/vdcs',
      '/api/v1/users',
      '/api/v1/rbac/assignments',
    ]
    if (lockedPrefixes.some(p => cleanPath === p || cleanPath.startsWith(p + '/'))) {
      return demoLocked()
    }
  }

  // --- 5. Wildcard: /api/v1/monitoring/* ---
  if (method === 'GET' && cleanPath.startsWith('/api/v1/monitoring')) {
    return { data: {} }
  }

  // --- 6. Safe fallback for any unmatched GET ---
  //
  // Nothing ever breaks here, which is exactly the problem: an uncovered
  // endpoint renders as a silently empty screen. Name it in the container log
  // (once per path, so a polled endpoint does not flood it) so the next gap is
  // found in the logs rather than by a visitor.
  if (method === 'GET' && cleanPath.startsWith('/api/v1/')) {
    // Bounded: demo mode bypasses authentication, so any caller can invent
    // paths, and an unbounded Set of them is a slow heap leak.
    if (!warnedFallbackPaths.has(cleanPath)) {
      if (warnedFallbackPaths.size >= DEMO_FALLBACK_WARN_LIMIT) warnedFallbackPaths.clear()
      warnedFallbackPaths.add(cleanPath)
      console.warn(`[demo] no mock for GET ${cleanPath}, falling back to { data: [] }`)
    }
    return { data: [] }
  }

  return null
}

// ---------------------------------------------------------------------------
// SSE stream builder for /api/v1/inventory/stream
// ---------------------------------------------------------------------------

function buildInventorySSE(): Response {
  const connections = (MOCK_DATA['/api/v1/connections'] as any)?.data || []
  const pveConns = connections.filter((c: any) => c.type === 'pve')
  const pbsConns = connections.filter((c: any) => c.type === 'pbs')
  const extConns = connections.filter((c: any) => c.type === 'vmware' || c.type === 'xcpng')

  // Per-connection lookup: the DR resources are behind an EXTRA_MOCKS getter,
  // so a bare MOCK_DATA read would miss them.
  const dataFor = (path: string): any[] => {
    const extra = (EXTRA_MOCKS as any)[`GET:${path}`]
    if (extra !== undefined) return extra?.data || []
    return (MOCK_DATA[path] as any)?.data || []
  }

  // Both PVE connections are emitted. Sending only the production cluster left
  // the inventory tree announcing "12 PVE" under a single cluster, and the DR
  // site invisible everywhere the tree is the entry point.
  const buildClusterEvent = (conn: any) => {
    const nodesData = dataFor(`/api/v1/connections/${conn.id}/nodes`)
    const resources = dataFor(`/api/v1/connections/${conn.id}/resources`)
    const cephStatus = ((EXTRA_MOCKS as any)[`GET:/api/v1/connections/${conn.id}/ceph`]?.data)
      || ((MOCK_DATA[`/api/v1/connections/${conn.id}/ceph/status`] as any)?.data)

    const nodesWithGuests = nodesData.map((n: any) => {
      const nodeGuests = resources.filter((r: any) => r.node === n.node)
      return {
        node: n.node,
        status: n.status || 'online',
        cpu: n.cpu,
        mem: n.mem,
        maxmem: n.maxmem,
        disk: n.disk,
        maxdisk: n.maxdisk,
        uptime: n.uptime,
        maxcpu: n.maxcpu,
        ip: n.ip,
        hastate: n.hastate || 'online',
        guests: nodeGuests.map((g: any) => ({
          vmid: g.vmid,
          name: g.name,
          type: g.type || 'qemu',
          status: g.status,
          node: g.node,
          cpu: g.cpu,
          mem: g.mem,
          maxmem: g.maxmem,
          disk: g.disk,
          maxdisk: g.maxdisk,
          uptime: g.uptime,
          tags: Array.isArray(g.tags) ? g.tags.join(';') : (g.tags || ''),
          template: g.template,
          pool: g.pool,
        })),
      }
    })

    return {
      id: conn.id,
      name: conn.name,
      type: 'pve',
      isCluster: true,
      status: 'online',
      cephHealth: cephStatus?.health?.status,
      latitude: conn.latitude || null,
      longitude: conn.longitude || null,
      locationLabel: conn.locationLabel || null,
      sshEnabled: conn.sshEnabled || false,
      nodes: nodesWithGuests,
    }
  }

  const buildStorageEvent = (conn: any) => {
    const nodesData = dataFor(`/api/v1/connections/${conn.id}/nodes`)
    const storageData = dataFor(`/api/v1/connections/${conn.id}/storage`)
    const mapStorage = (st: any) => ({
      storage: st.storage,
      node: st.node,
      type: st.type,
      shared: st.shared ? 1 : 0,
      content: st.content,
      used: st.used || 0,
      total: st.maxdisk || st.total || 0,
      usedPct: st.maxdisk ? Math.round((st.used / st.maxdisk) * 100) : 0,
      status: st.status || 'available',
      enabled: st.enabled !== false,
    })
    const sharedStorages = storageData.filter((st: any, idx: number, arr: any[]) =>
      st.shared && arr.findIndex((x: any) => x.storage === st.storage) === idx
    )
    return {
      connId: conn.id,
      connName: conn.name,
      isCluster: true,
      nodes: nodesData.map((n: any) => ({
        node: n.node,
        status: n.status || 'online',
        storages: storageData.filter((st: any) => st.node === n.node).map(mapStorage),
      })),
      sharedStorages: sharedStorages.map((st: any) => ({ ...mapStorage(st), shared: 1 })),
    }
  }

  // Build PBS mock data
  const pbsEvents = pbsConns.map((pbs: any) => ({
    id: pbs.id,
    name: pbs.name,
    type: 'pbs',
    status: 'online',
    version: '3.2-1',
    uptime: 864000,
    datastores: [
      {
        name: 'backup-main',
        total: 10995116277760,
        used: 5497558138880,
        available: 5497558138880,
        usagePercent: 50,
        backupCount: 342,
        vmCount: 45,
        ctCount: 12,
        hostCount: 3,
      },
    ],
    stats: {
      totalSize: 10995116277760,
      totalUsed: 5497558138880,
      datastoreCount: 1,
      backupCount: 342,
    },
  }))

  // Build external hypervisors
  const externalEvent = extConns.map((ext: any) => ({
    id: ext.id,
    name: ext.name,
    type: ext.type,
    status: 'online',
    baseUrl: ext.baseUrl,
  }))

  // Build SSE body
  const events: string[] = []
  const sse = (event: string, data: any) =>
    events.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)

  sse('init', {
    totalPve: pveConns.length,
    totalPbs: pbsConns.length,
    totalExt: extConns.length,
  })

  for (const conn of pveConns) {
    sse('cluster', buildClusterEvent(conn))
  }

  for (const pbs of pbsEvents) {
    sse('pbs', pbs)
  }

  if (externalEvent.length > 0) {
    sse('external', externalEvent)
  }

  for (const conn of pveConns) {
    sse('storage', buildStorageEvent(conn))
  }

  sse('done', { stats: { clusters: pveConns.length, pbs: pbsConns.length, external: extConns.length } })

  const body = events.join('')

  return new Response(body, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'x-demo-mode': 'true',
    },
  })
}

// ---------------------------------------------------------------------------
// SSE stream for /api/v1/inventory/events
//
// InventoryTree opens a PERSISTENT EventSource on this path
// (InventoryTree.tsx). Without a handler it fell through to the JSON fallback,
// and the browser aborted the connection with "response has a MIME type
// (application/json) that is not text/event-stream" — the inventory gauges then
// never moved. This pushes the same delta events the real poller emits, nudging
// a rotating set of guests, then closes after DEMO_SSE_LIFETIME_MS so a demo
// container never accumulates streams; EventSource reconnects on its own.
// ---------------------------------------------------------------------------

const DEMO_SSE_LIFETIME_MS = 120_000
const DEMO_SSE_TICK_MS = 4_000

function buildInventoryEventsSSE(): Response {
  const resources = demoResources('demo-pve-cluster-001')
  const running = resources.filter(r => r.status === 'running' && r.vmid)
  const nodes = demoNodes('demo-pve-cluster-001')

  const encoder = new TextEncoder()
  let tick = 0

  let timer: ReturnType<typeof setInterval> | null = null
  let closed = false

  const stream = new ReadableStream({
    start(controller) {
      // The viewer closing the tab cancels the stream while the interval is
      // still armed; enqueueing on a closed controller throws ERR_INVALID_STATE
      // and takes the dev server down with an uncaught exception.
      const stop = () => {
        closed = true
        if (timer) { clearInterval(timer); timer = null }
        try { controller.close() } catch { /* already closed */ }
      }
      const send = (event: string, data: any) => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        } catch {
          stop()
        }
      }

      send('heartbeat', {})

      timer = setInterval(() => {
        tick += 1

        // Three guests per tick, rotating through the running set.
        for (let k = 0; k < 3 && running.length > 0; k++) {
          const g = running[(tick * 3 + k) % running.length]
          const drift = 1 + Math.sin((tick + k) / 3) * 0.18
          send('vm:update', {
            connId: 'demo-pve-cluster-001',
            vmid: g.vmid,
            node: g.node,
            type: g.type || 'qemu',
            status: g.status,
            name: g.name,
            cpu: Math.max(0, Math.min(1, (g.cpu || 0.02) * drift)),
            mem: Math.min(g.maxmem || Infinity, Math.round((g.mem || 0) * drift)),
            maxmem: g.maxmem,
            disk: g.disk,
            maxdisk: g.maxdisk,
          })
        }

        // One node per tick, so the node gauges move too.
        if (nodes.length > 0) {
          const n = nodes[tick % nodes.length]
          const drift = 1 + Math.cos(tick / 4) * 0.12
          send('node:update', {
            connId: 'demo-pve-cluster-001',
            node: n.node,
            status: n.status || 'online',
            cpu: Math.max(0, Math.min(1, (n.cpu || 0.03) * drift)),
            mem: Math.min(n.maxmem || Infinity, Math.round((n.mem || 0) * drift)),
            maxmem: n.maxmem,
          })
        }

        if (tick % 5 === 0) send('heartbeat', {})

        if (tick * DEMO_SSE_TICK_MS >= DEMO_SSE_LIFETIME_MS) stop()
      }, DEMO_SSE_TICK_MS)
    },
    cancel() {
      closed = true
      if (timer) { clearInterval(timer); timer = null }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'x-demo-mode': 'true',
    },
  })
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Intercept an incoming request and return a mock NextResponse if demo mode
 * is active. Returns `null` if demo mode is off or if the request is not an
 * API route.
 *
 * Designed to be called from Next.js middleware:
 *
 * ```ts
 * const demo = demoResponse(req)
 * if (demo) return demo
 * ```
 */
export function demoResponse(req: Request): NextResponse | Response | Promise<NextResponse | Response> | null {
  // 1. Check demo mode
  if (process.env.DEMO_MODE !== 'true') return null

  // 2. Extract URL path
  let pathname: string
  try {
    pathname = new URL(req.url).pathname
  } catch {
    return null
  }

  // Only intercept /api/v1/* routes
  if (!pathname.startsWith('/api/v1/')) return null

  const method = req.method?.toUpperCase() || 'GET'

  const demoHeaders = { 'x-demo-mode': 'true' }
  const urlObj = new URL(req.url)
  const cleanPath = stripQuery(pathname)

  // ── Demo tenant switching ────────────────────────────────────────────
  // The demo user logs in as a provider admin on the 'default' tenant. The
  // mock-data ships vDCs for four fictitious customer tenants (Acme,
  // Globex, Initech and one Acme-DR). To let visitors browse them through
  // /my-vdc without running a real session backend, we keep the active
  // tenant in a client-side cookie that the demo handlers below read.
  const DEMO_TENANT_COOKIE = 'demo-tenant'
  const DEMO_TENANTS = [
    { id: 'default',             slug: 'default',  name: 'ProxCenter Demo MSP',  description: 'Provider workspace, manages every tenant.' },
    { id: 'demo-tenant-acme',    slug: 'acme',     name: 'Acme Corporation',     description: 'Customer with prod + DR vDCs.' },
    { id: 'demo-tenant-globex',  slug: 'globex',   name: 'Globex SAS',           description: 'Customer with a single production vDC.' },
    { id: 'demo-tenant-initech', slug: 'initech',  name: 'Initech',              description: 'Customer with a single production vDC.' },
  ]
  const parseCookies = (raw: string | null): Record<string, string> => {
    const out: Record<string, string> = {}
    if (!raw) return out
    for (const part of raw.split(';')) {
      const eq = part.indexOf('=')
      if (eq < 0) continue
      out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
    }
    return out
  }
  const currentDemoTenantId = (() => {
    const c = parseCookies(req.headers.get('cookie'))
    const v = c[DEMO_TENANT_COOKIE]
    return DEMO_TENANTS.some(t => t.id === v) ? v : 'default'
  })()

  // 3. For any mutating request (POST/PUT/PATCH/DELETE), return a generic
  //    "action disabled" response — UNLESS we have a specific mock for it
  //    (e.g. POST /api/v1/auth/callback/credentials)
  if (method !== 'GET') {
    // --- POST: tenant switching is a navigation, not a destructive
    //     mutation; we allow it and persist the choice in a client cookie.
    //     The handler is async because we need to await req.json() to read
    //     the target tenant id; Next.js route handlers happily await a
    //     Promise<Response> returned from `return demoResponse(req)`. ---
    if (method === 'POST' && cleanPath === '/api/v1/auth/switch-tenant') {
      return (async () => {
        let target = 'default'
        try {
          const body = await req.json()
          if (typeof body?.tenantId === 'string' && body.tenantId) target = body.tenantId
        } catch {
          // No body / not JSON: fall back to default
        }
        const valid = DEMO_TENANTS.some(t => t.id === target) ? target : 'default'
        const res = NextResponse.json({ data: { ok: true, tenantId: valid } }, { headers: demoHeaders })
        // 30 days, scoped to the demo origin. SameSite=Lax keeps the
        // cookie present across the full-page reload that switchTenant()
        // triggers immediately after the fetch resolves.
        res.cookies.set(DEMO_TENANT_COOKIE, valid, { path: '/', sameSite: 'lax', maxAge: 60 * 60 * 24 * 30 })
        return res
      })()
    }
    // --- POST: batched RRD ---
    // The root inventory view (PROXMOX VE selected) asks for every node's
    // history in one POST. Without a handler it fell into the generic
    // "action disabled" answer for mutations, the series came back empty and
    // the whole Performance block was hidden, with no error to show for it.
    const rrdBatchMatch = cleanPath.match(/^\/api\/v1\/connections\/([^/]+)\/rrd\/batch$/)
    if (method === 'POST' && rrdBatchMatch) {
      const batchConnId = rrdBatchMatch[1]
      return (async () => {
        let paths: string[] = []
        let timeframe = 'hour'
        try {
          const body = await req.json()
          if (Array.isArray(body?.paths)) paths = body.paths.filter((x: unknown) => typeof x === 'string')
          if (typeof body?.timeframe === 'string') timeframe = body.timeframe
        } catch {
          // No body: answer with an empty map rather than a 500.
        }
        const dataMap: Record<string, any[]> = {}
        for (const path of paths) {
          dataMap[path] = generateRrdForPath(batchConnId, path, timeframe)
        }
        return NextResponse.json({ data: dataMap }, { headers: demoHeaders })
      })()
    }

    // --- POST: node/guest trends ---
    if (method === 'POST' && cleanPath.match(/\/api\/v1\/connections\/[^/]+\/(nodes|guests)\/trends/)) {
      // Widget expects { data: { "node:<name>": [{ ts, t, cpu, ram }, ...] } }.
      //
      // The day/night cycle used to be a pure function of the wall clock, so
      // all twelve nodes fell off a cliff at 19:00 and climbed back at 09:00
      // on exactly the same minute: twelve copies of one curve, stacked. Each
      // node now carries its own office-hour offset, its own depth (a database
      // never idles, a CI fleet nearly stops) and its own bursts.
      const trendConnId = cleanPath.match(/\/api\/v1\/connections\/([^/]+)\//)?.[1] || DEMO_CONNECTION_ID
      const nodesData = demoNodes(trendConnId)
      const result: Record<string, any[]> = {}
      const now = Math.floor(Date.now() / 1000)
      const points = 70
      const interval = 1200

      for (const node of nodesData) {
        const load = demoNodeLoad(node.node)
        const rnd = demoRandom(`trend:${trendConnId}:${node.node}`)
        const phase = rnd() * Math.PI * 2
        const freq = 5 + rnd() * 9
        const nodeCpu = (node.cpu || load.cpu / 100) * 100
        const nodeRam = ((node.mem || 0) / (node.maxmem || 1)) * 100
        const bursts = Array.from({ length: load.burstiness > 0.5 ? 2 : 1 }, () => ({
          at: rnd(), width: 0.03 + rnd() * 0.08, height: load.burstiness * (0.6 + rnd()),
        }))

        result[`node:${node.node}`] = Array.from({ length: points }, (_, i) => {
          const time = now - (points - 1 - i) * interval
          const d = new Date(time * 1000)
          const hour = ((d.getHours() + load.diurnalOffset) + 24) % 24
          // Smooth office-hour curve rather than a step, and only
          // `diurnalDepth` of the load follows it.
          const dayShape = 0.5 - 0.5 * Math.cos(((hour - 3 + 24) % 24) / 24 * Math.PI * 2)
          const diurnal = 1 - load.diurnalDepth + load.diurnalDepth * dayShape * 1.4

          const t2 = i / points
          const wave = Math.sin(t2 * Math.PI * freq + phase) * 0.16
          const jitter = (demoRandom(`${node.node}:${time}`)() - 0.5) * 0.08
          const burst = bursts.reduce((acc, b) => {
            const dd = (t2 - b.at) / b.width
            return acc + b.height * Math.exp(-dd * dd)
          }, 0)

          const factor = Math.max(0.05, diurnal * (1 + wave + jitter) + burst * 0.5)
          const cpuVal = Math.max(0.3, Math.min(98, nodeCpu * factor))
          // Memory barely follows the day: pages are not handed back at 19:00.
          const ramVal = Math.max(5, Math.min(98, nodeRam * (1 + (factor - 1) * 0.12 + jitter * 0.5)))

          return {
            ts: time,
            t: `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
            cpu: Math.round(cpuVal * 10) / 10,
            ram: Math.round(ramVal * 10) / 10,
          }
        })
      }

      return NextResponse.json({ data: result }, { headers: demoHeaders })
    }

    const specificMock = lookupMock(method, pathname)
    if (specificMock instanceof Response) return specificMock
    if (specificMock !== null) {
      return NextResponse.json(specificMock, { headers: demoHeaders })
    }

    return NextResponse.json(
      { success: true, demo: true, message: 'Action disabled in demo mode' },
      { headers: demoHeaders }
    )
  }

  // 4. SSE stream for inventory
  if (cleanPath === '/api/v1/inventory/stream') {
    return buildInventorySSE()
  }

  if (cleanPath === '/api/v1/inventory/events') {
    return buildInventoryEventsSSE()
  }

  // --- sFlow mock data ---
  if (cleanPath === '/api/v1/orchestrator/sflow') {
    const endpoint = urlObj.searchParams.get('endpoint') || 'status'
    const now = Math.floor(Date.now() / 1000)
    const demoNodes = ['pve-node-01', 'pve-node-02', 'pve-node-03']
    const demoIPs = ['10.10.10.1', '10.10.10.2', '10.10.10.3', '10.10.10.10', '10.10.10.20', '10.10.10.30', '192.168.1.100', '192.168.1.200']

    if (endpoint === 'status') {
      return NextResponse.json({
        enabled: true, listen_address: '0.0.0.0:6343',
        agents: demoNodes.map((node, i) => ({
          agent_ip: `10.10.10.${i + 1}`, node, last_seen: new Date().toISOString(),
          flow_rate: 50 + Math.random() * 200, sample_count: 10000 + Math.floor(Math.random() * 50000), active: true,
        })),
        total_flows: 150000, flow_rate: 180 + Math.random() * 100, active_vms: 12, uptime_seconds: 345600,
      }, { headers: demoHeaders })
    }

    if (endpoint === 'top-talkers') {
      const vms = [
        { vmid: 100, vm_name: 'web-prod-01', node: 'pve-node-01' },
        { vmid: 101, vm_name: 'api-gateway', node: 'pve-node-01' },
        { vmid: 200, vm_name: 'db-primary', node: 'pve-node-02' },
        { vmid: 201, vm_name: 'db-replica', node: 'pve-node-02' },
        { vmid: 300, vm_name: 'monitoring', node: 'pve-node-03' },
        { vmid: 301, vm_name: 'backup-srv', node: 'pve-node-03' },
        { vmid: 102, vm_name: 'web-prod-02', node: 'pve-node-01' },
        { vmid: 302, vm_name: 'ci-runner', node: 'pve-node-03' },
      ]
      return NextResponse.json(vms.map(vm => ({
        ...vm, bytes_in: Math.floor(Math.random() * 5e9 + 1e8), bytes_out: Math.floor(Math.random() * 1e9 + 1e7), packets: Math.floor(Math.random() * 1e6),
      })), { headers: demoHeaders })
    }

    if (endpoint === 'top-ports') {
      const portList = [
        { port: 443, protocol: 'TCP', service: 'HTTPS' },
        { port: 80, protocol: 'TCP', service: 'HTTP' },
        { port: 22, protocol: 'TCP', service: 'SSH' },
        { port: 5432, protocol: 'TCP', service: 'PostgreSQL' },
        { port: 8006, protocol: 'TCP', service: 'PVE API' },
        { port: 53, protocol: 'UDP', service: 'DNS' },
        { port: 3306, protocol: 'TCP', service: 'MySQL' },
        { port: 9090, protocol: 'TCP', service: 'Prometheus' },
      ]
      const total = portList.length
      return NextResponse.json(portList.map((p, i) => {
        const bytes = Math.floor((total - i) * 1e9 * Math.random() + 5e7)
        return { ...p, bytes, packets: Math.floor(bytes / 1000), percent: (total - i) * 10 + Math.random() * 5 }
      }), { headers: demoHeaders })
    }

    if (endpoint === 'ip-pairs') {
      // Deterministic pairs with one dominant flow (web-prod-01 → db-primary via PostgreSQL)
      const pairs = [
        // Dominant flow: web server hammering database
        { src_ip: '10.10.10.10', dst_ip: '10.10.10.20', bytes: 18_500_000_000, packets: 12_000_000, protocol: 'TCP', dst_port: 5432 },
        { src_ip: '10.10.10.10', dst_ip: '10.10.10.30', bytes: 8_200_000_000, packets: 5_500_000, protocol: 'TCP', dst_port: 443 },
        { src_ip: '10.10.10.10', dst_ip: '192.168.1.100', bytes: 4_100_000_000, packets: 2_800_000, protocol: 'TCP', dst_port: 443 },
        // Secondary flows
        { src_ip: '10.10.10.20', dst_ip: '10.10.10.30', bytes: 2_500_000_000, packets: 1_600_000, protocol: 'TCP', dst_port: 443 },
        { src_ip: '10.10.10.3', dst_ip: '10.10.10.10', bytes: 1_800_000_000, packets: 1_200_000, protocol: 'TCP', dst_port: 8006 },
        { src_ip: '192.168.1.100', dst_ip: '10.10.10.10', bytes: 1_500_000_000, packets: 980_000, protocol: 'TCP', dst_port: 80 },
        { src_ip: '10.10.10.2', dst_ip: '10.10.10.20', bytes: 1_200_000_000, packets: 750_000, protocol: 'TCP', dst_port: 5432 },
        { src_ip: '10.10.10.30', dst_ip: '10.10.10.1', bytes: 950_000_000, packets: 620_000, protocol: 'TCP', dst_port: 22 },
        { src_ip: '192.168.1.200', dst_ip: '10.10.10.10', bytes: 800_000_000, packets: 520_000, protocol: 'TCP', dst_port: 443 },
        { src_ip: '10.10.10.1', dst_ip: '10.10.10.2', bytes: 650_000_000, packets: 430_000, protocol: 'UDP', dst_port: 53 },
        { src_ip: '10.10.10.10', dst_ip: '10.10.10.1', bytes: 500_000_000, packets: 320_000, protocol: 'TCP', dst_port: 9090 },
        { src_ip: '10.10.10.3', dst_ip: '10.10.10.20', bytes: 380_000_000, packets: 250_000, protocol: 'TCP', dst_port: 3306 },
        { src_ip: '10.10.10.2', dst_ip: '10.10.10.3', bytes: 280_000_000, packets: 180_000, protocol: 'TCP', dst_port: 22 },
        { src_ip: '192.168.1.100', dst_ip: '10.10.10.30', bytes: 220_000_000, packets: 140_000, protocol: 'TCP', dst_port: 443 },
        { src_ip: '10.10.10.20', dst_ip: '10.10.10.1', bytes: 180_000_000, packets: 115_000, protocol: 'UDP', dst_port: 53 },
      ]
      return NextResponse.json(pairs, { headers: demoHeaders })
    }

    if (endpoint === 'timeseries/vm') {
      const points = Array.from({ length: 60 }, (_, i) => ({
        time: now - (59 - i) * 60, bytes_in: Math.floor(Math.random() * 5e7 + 1e6), bytes_out: Math.floor(Math.random() * 1e7 + 5e5), packets: Math.floor(Math.random() * 50000),
      }))
      return NextResponse.json(points, { headers: demoHeaders })
    }

    if (endpoint === 'timeseries/all-vms') {
      return NextResponse.json([
        { vmid: 100, vm_name: 'web-prod-01', points: Array.from({ length: 60 }, (_, i) => ({ time: now - (59 - i) * 60, bytes_in: Math.floor(Math.random() * 3e7), bytes_out: Math.floor(Math.random() * 5e6) })) },
        { vmid: 200, vm_name: 'db-primary', points: Array.from({ length: 60 }, (_, i) => ({ time: now - (59 - i) * 60, bytes_in: Math.floor(Math.random() * 8e7), bytes_out: Math.floor(Math.random() * 2e7) })) },
      ], { headers: demoHeaders })
    }

    if (endpoint === 'timeseries/ip') {
      const points = Array.from({ length: 60 }, (_, i) => ({
        time: now - (59 - i) * 60, bytes_in: Math.floor(Math.random() * 2e7 + 5e5),
      }))
      return NextResponse.json(points, { headers: demoHeaders })
    }

    if (endpoint === 'agents') {
      return NextResponse.json(demoNodes.map((node, i) => ({
        agent_ip: `10.10.10.${i + 1}`, node, last_seen: new Date().toISOString(),
        flow_rate: 50 + Math.random() * 200, sample_count: 10000 + Math.floor(Math.random() * 50000), active: true,
      })), { headers: demoHeaders })
    }

    // Default: empty array
    return NextResponse.json([], { headers: demoHeaders })
  }

  // sFlow agents (SSH-based)
  if (cleanPath === '/api/v1/orchestrator/sflow/agents') {
    return NextResponse.json({
      data: [
        { node: 'pve-node-01', ip: '10.10.10.1', connectionId: 'demo-pve-cluster-001', connectionName: 'PVE-CLUSTER-DEMO', online: true, hasOvs: true, ovsVersion: '3.1.0', sflowConfigured: true, sflowTarget: '10.10.10.254:6343', sflowSampling: 512, bridges: ['vmbr0'] },
        { node: 'pve-node-02', ip: '10.10.10.2', connectionId: 'demo-pve-cluster-001', connectionName: 'PVE-CLUSTER-DEMO', online: true, hasOvs: true, ovsVersion: '3.1.0', sflowConfigured: true, sflowTarget: '10.10.10.254:6343', sflowSampling: 512, bridges: ['vmbr0'] },
        { node: 'pve-node-03', ip: '10.10.10.3', connectionId: 'demo-pve-cluster-001', connectionName: 'PVE-CLUSTER-DEMO', online: true, hasOvs: true, ovsVersion: '3.1.0', sflowConfigured: true, sflowTarget: '10.10.10.254:6343', sflowSampling: 512, bridges: ['vmbr0'] },
      ],
    }, { headers: demoHeaders })
  }

  // --- Dashboard layout list ---
  if (cleanPath === '/api/v1/dashboard/layout' && urlObj.searchParams.get('list') === 'true') {
    return NextResponse.json({ data: [
      { id: 'demo-layout', name: 'Default', isActive: true, updatedAt: new Date().toISOString() },
    ] }, { headers: demoHeaders })
  }

  // --- Tenant list + current tenant for the demo switcher ---
  // The provider admin demo user lands on 'default' (no vDC, see /home).
  // The switcher exposes the four mock customer tenants so visitors can
  // hop into /my-vdc and explore the cockpit. currentTenantId is read
  // from the `demo-tenant` cookie that POST /auth/switch-tenant sets.
  if (cleanPath === '/api/v1/auth/me/tenants') {
    return NextResponse.json({
      data: DEMO_TENANTS,
      currentTenantId: currentDemoTenantId,
    }, { headers: demoHeaders })
  }

  // --- User-scoped vDC list, filtered by the active demo tenant ---
  // On 'default' the provider admin has no personal vDC (return empty so
  // /home doesn't redirect to /my-vdc). When the visitor switches to a
  // customer tenant, return that tenant's vDCs from the mock dataset.
  if (cleanPath === '/api/v1/vdcs') {
    if (currentDemoTenantId === 'default') {
      return NextResponse.json({ data: [] }, { headers: demoHeaders })
    }
    const allVdcs = ((MOCK_DATA['/api/v1/vdcs'] as any)?.data || []) as any[]
    const scoped = allVdcs.filter(v => v.tenantId === currentDemoTenantId)
    return NextResponse.json({ data: scoped }, { headers: demoHeaders })
  }

  // --- PBS backups/trends ---
  if (cleanPath.match(/\/api\/v1\/pbs\/[^/]+\/backups\/trends/)) {
    const days = Number(urlObj.searchParams.get('days') || 30)
    const now = new Date()
    const data = Array.from({ length: days }, (_, i) => {
      const date = new Date(now.getTime() - (days - 1 - i) * 86400000)
      const isWeekend = date.getDay() === 0 || date.getDay() === 6
      const baseCount = isWeekend ? 2 + Math.floor(Math.random() * 3) : 8 + Math.floor(Math.random() * 6)
      const errors = Math.random() < 0.08 ? 1 : 0
      return {
        date: date.toISOString().split('T')[0],
        count: baseCount,
        ok: baseCount - errors,
        error: errors,
        verified: Math.random() < 0.7 ? baseCount - errors : 0,
      }
    })

    return NextResponse.json({ data }, { headers: demoHeaders })
  }

  // --- Dynamic per-VM Green Score endpoint ---
  if (cleanPath.match(/\/api\/v1\/connections\/[^/]+\/guests\/[^/]+\/[^/]+\/[^/]+\/green$/)) {
    const nowSec = Math.floor(Date.now() / 1000)
    return NextResponse.json({
      hasEnoughData: true,
      windowDays: 30,
      samples: {
        count: 720,
        fromTs: nowSec - 30 * 86400,
        toTs: nowSec,
        avgCpuPct: 7.2,
        avgMemPct: 42.0,
        runningRatio: 0.95,
      },
      metrics: {
        power: { current: 28, max: 65, monthly: 20, yearly: 245 },
        co2: { hourly: 0.001, daily: 0.03, monthly: 0.9, yearly: 12, factor: 0.052, equivalentKmCar: 47, equivalentTrees: 0.5 },
        cost: { hourly: 0.005, daily: 0.13, monthly: 4, yearly: 48, pricePerKwh: 0.18, currency: 'EUR' },
        efficiency: { pue: 1.4, vmPerKw: 32, score: 72 },
      },
      insight: {
        kind: 'idle_cpu',
        severity: 'warning',
        titleKey: 'green.insights.idleCpu.title',
        suggestionKey: 'green.insights.idleCpu.suggestion',
        placeholders: { cpu: 7, suggestedVcpus: 2 },
      },
    }, { headers: demoHeaders })
  }

  // --- Guest detail panel: live status, console preview, disk latency ---
  const guestStatusMatch = cleanPath.match(/^\/api\/v1\/connections\/([^/]+)\/guests\/(qemu|lxc)\/([^/]+)\/(\d+)\/status$/)
  if (guestStatusMatch) {
    const [, gConn, , , gVmid] = guestStatusMatch
    const g = demoResources(gConn).find(x => Number(x.vmid) === Number(gVmid))
    return NextResponse.json({
      data: {
        status: g?.status || 'stopped',
        name: g?.name,
        uptime: g?.uptime || 0,
        cpu: g?.cpu || 0,
        mem: g?.mem || 0,
        maxmem: g?.maxmem || 0,
        disk: g?.disk || 0,
        maxdisk: g?.maxdisk || 0,
      },
      movedTo: null,
    }, { headers: demoHeaders })
  }

  // A console frame needs a live guest and an SSH hop to the node; the route
  // itself answers `{ data: null, reason }` when it cannot grab one, so the
  // panel already knows how to render the absence.
  if (cleanPath.match(/^\/api\/v1\/connections\/[^/]+\/guests\/(qemu|lxc)\/[^/]+\/\d+\/screenshot$/)) {
    return NextResponse.json({ data: null, reason: 'ssh_failed' }, { headers: demoHeaders })
  }

  const diskLatencyMatch = cleanPath.match(/^\/api\/v1\/orchestrator\/metrics\/([^/]+)\/vms\/(\d+)\/disk-latency$/)
  if (diskLatencyMatch) {
    const [, dlConn, dlVmid] = diskLatencyMatch
    const step = Number(urlObj.searchParams.get('step') || 60)
    const now = Math.floor(Date.now() / 1000)
    const disks = ['scsi0', 'scsi1']
    const points = disks.flatMap(disk => {
      const series = generateRrdData('hour', undefined, `latency:${dlConn}:${dlVmid}:${disk}`)
      return series.map(pt => {
        const base = disk === 'scsi0' ? 1.4 : 3.2
        const latency = Math.round(base * (0.4 + pt.iowait * 22) * 100) / 100
        return {
          time: pt.time,
          disk,
          storage: 'CephStoragePool',
          latency_ms: latency,
          max_ms: Math.round(latency * 2.6 * 100) / 100,
          read_ops: Math.round(pt.diskread / 4096),
          write_ops: Math.round(pt.diskwrite / 4096),
        }
      })
    }).sort((a, b) => a.time - b.time)
    return NextResponse.json({
      from: new Date((now - 3600) * 1000).toISOString(),
      to: new Date(now * 1000).toISOString(),
      step,
      points,
    }, { headers: demoHeaders })
  }

  // --- Detail endpoints for the records the collections now advertise ---
  // Each of these is reachable by clicking a row the demo just seeded, and
  // lookupMock cannot serve them: it strips the query string and knows nothing
  // of the id in the path.
  const deploymentDetail = cleanPath.match(/^\/api\/v1\/templates\/deployments\/([^/]+)$/)
  if (deploymentDetail) {
    const found = generateDeployments().find(d => d.id === deploymentDetail[1])
    if (found) return NextResponse.json({ data: found }, { headers: demoHeaders })
  }

  if (cleanPath === '/api/v1/templates/deployments' && urlObj.searchParams.get('activeOnly') === 'true') {
    const active = new Set(['pending', 'downloading', 'creating', 'configuring', 'starting'])
    return NextResponse.json(
      { data: generateDeployments().filter(d => active.has(d.status)) },
      { headers: demoHeaders },
    )
  }

  const sharedTaskDetail = cleanPath.match(/^\/api\/v1\/tasks\/shared\/([^/]+)$/)
  if (sharedTaskDetail) {
    const found = generateSharedTasks().find(t => t.id === sharedTaskDetail[1])
    if (found) return NextResponse.json({ data: { ...found, logs: [] } }, { headers: demoHeaders })
  }

  const reportDownload = cleanPath.match(/^\/api\/v1\/orchestrator\/reports\/([^/]+)\/download$/)
  if (reportDownload) {
    const report = generateReportHistory().find(r => r.id === reportDownload[1])
    if (report && report.status === 'completed') {
      // ?format=csv is the data export (#906); anything else is the PDF.
      const wantCsv = (urlObj.searchParams.get('format') || 'pdf').toLowerCase() === 'csv'
      if (wantCsv && !report.csv_size) {
        return NextResponse.json({ error: 'This report has no CSV export' }, { status: 404, headers: demoHeaders })
      }
      return new NextResponse(wantCsv ? buildDemoReportCsv(report) : buildDemoReportPdf(report.name), {
        headers: {
          'Content-Type': wantCsv ? 'text/csv; charset=utf-8' : 'application/pdf',
          'Content-Disposition': `attachment; filename="${report.id}.${wantCsv ? 'csv' : 'pdf'}"`,
          'x-demo-mode': 'true',
        },
      })
    }
  }

  const reportDetail = cleanPath.match(/^\/api\/v1\/orchestrator\/reports\/([^/]+)$/)
  if (reportDetail) {
    const found = generateReportHistory().find(r => r.id === reportDetail[1])
    if (found) return NextResponse.json({ data: found }, { headers: demoHeaders })
  }

  // --- Single connection detail, served from the connection list ---
  const connDetailMatch = cleanPath.match(/^\/api\/v1\/connections\/([^/]+)$/)
  if (connDetailMatch) {
    const all = ((MOCK_DATA['/api/v1/connections'] as any)?.data || []) as any[]
    const found = all.find(c => c.id === connDetailMatch[1])
    if (found) return NextResponse.json({ data: found }, { headers: demoHeaders })
  }

  // --- Guest configs and per-guest firewall (query-string sensitive) ---
  const guestConfigMatch = cleanPath.match(/^\/api\/v1\/connections\/[^/]+\/guests\/(qemu|lxc)\/([^/]+)\/(\d+)\/config$/)
  if (guestConfigMatch) {
    const [, gType, gNode, gVmid] = guestConfigMatch
    return NextResponse.json(
      { data: buildDemoGuestConfig(Number(gVmid), gNode, gType), movedTo: null },
      { headers: demoHeaders },
    )
  }

  const vmFwMatch = cleanPath.match(/^\/api\/v1\/firewall\/vms\/[^/]+\/[^/]+\/(qemu|lxc)\/(\d+)$/)
  if (vmFwMatch) {
    const vmid = Number(vmFwMatch[2])
    const wantRules = urlObj.searchParams.get('type') === 'rules'
    return NextResponse.json(
      wantRules ? buildDemoVmFirewallRules(vmid) : buildDemoVmFirewallOptions(vmid),
      { headers: demoHeaders },
    )
  }

  const clusterFwMatch = cleanPath.match(/^\/api\/v1\/firewall\/cluster\/([^/]+)$/)
  if (clusterFwMatch) {
    if (urlObj.searchParams.get('type') === 'rules') {
      return NextResponse.json(DEMO_CLUSTER_FW_RULES, { headers: demoHeaders })
    }
    return NextResponse.json({
      enable: 1,
      policy_in: 'DROP',
      policy_out: 'ACCEPT',
      log_ratelimit: 'enable=1,rate=1/second,burst=5',
      ebtables: 1,
      connectionId: clusterFwMatch[1],
      connectionName: clusterFwMatch[1] === 'demo-pve-dr-001' ? 'DR Cluster (GRA)' : 'Production Cluster',
    }, { headers: demoHeaders })
  }

  if (cleanPath.match(/^\/api\/v1\/firewall\/aliases\/[^/]+$/)) {
    return NextResponse.json(DEMO_FW_ALIASES, { headers: demoHeaders })
  }
  if (cleanPath.match(/^\/api\/v1\/firewall\/ipsets\/[^/]+$/)) {
    return NextResponse.json(DEMO_FW_IPSETS, { headers: demoHeaders })
  }
  if (cleanPath.match(/^\/api\/v1\/firewall\/groups\/[^/]+$/)) {
    return NextResponse.json(
      [{ group: 'web-servers' }, { group: 'db-servers' }, { group: 'monitoring' }, { group: 'management' }, { group: 'dmz' }],
      { headers: demoHeaders },
    )
  }
  const nodeFwMatch = cleanPath.match(/^\/api\/v1\/firewall\/nodes\/[^/]+\/[^/]+$/)
  if (nodeFwMatch) {
    if (urlObj.searchParams.get('type') === 'rules') {
      return NextResponse.json([
        { pos: 0, type: 'in', action: 'ACCEPT', proto: 'tcp', dport: '22', source: '+management', enable: 1, comment: 'SSH from the management IP set' },
      ], { headers: demoHeaders })
    }
    return NextResponse.json({ enable: 1, log_level_in: 'info', log_level_out: 'nolog', nf_conntrack_max: 262144, nosmurfs: 1, tcpflags: 1 }, { headers: demoHeaders })
  }

  // --- Dynamic RRD endpoints ---
  if (cleanPath.match(/\/api\/v1\/connections\/[^/]+\/rrd/) || cleanPath.match(/\/api\/v1\/connections\/[^/]+\/ceph\/rrd/)) {
    const timeframe = urlObj.searchParams.get('timeframe') || 'hour'
    if (cleanPath.includes('/ceph/rrd')) {
      // The Ceph screen reads `rrd`, `current`, `pools`, `osds` and `latency`
      // (the shape of src/app/api/v1/connections/[id]/ceph/rrd/route.ts). The
      // iops_read/bandwidth_* series this used to return matched nothing, so
      // both node charts sat on "No RRD data available".
      const isDr = cleanPath.includes('demo-pve-dr-001')
      return NextResponse.json(
        buildCephRrd(isDr ? DEMO_CEPH_DR : DEMO_CEPH_PROD, isDr ? 'pve-dr-01' : 'pve-node-01', timeframe),
        { headers: demoHeaders },
      )
    }
    const rrdConnId = cleanPath.match(/\/api\/v1\/connections\/([^/]+)\//)?.[1] || DEMO_CONNECTION_ID
    const rrdPath = urlObj.searchParams.get('path') || '/'
    return NextResponse.json({ data: generateRrdForPath(rrdConnId, rrdPath, timeframe) }, { headers: demoHeaders })
  }

  // --- Connection filtering by type ---
  if (cleanPath === '/api/v1/connections') {
    const typeFilter = urlObj.searchParams.get('type')
    const allConns = (MOCK_DATA['/api/v1/connections'] as any)?.data || []
    if (typeFilter) {
      return NextResponse.json({ data: allConns.filter((c: any) => c.type === typeFilter) }, { headers: demoHeaders })
    }
  }

  // 5. GET request — look up mock data
  const data = lookupMock(method, pathname)

  if (data instanceof Response) return data
  if (data !== null) {
    return NextResponse.json(data, { headers: demoHeaders })
  }

  // Should not reach here (lookupMock returns { data: [] } for unmatched GETs)
  // but just in case:
  return NextResponse.json({ data: [] }, { headers: demoHeaders })
}
