/**
 * GPU demo (#672): the GPU page, the GPU tab of a node or a cluster, the
 * capacity widget, and the GPU section of a vDC, on the production cluster.
 *
 * Nothing here is written in the shape a screen reads: the PCI lists, mappings
 * and VM configs below are what PVE would answer, the readings what the
 * orchestrator would store, and the responses are built by the same functions
 * as the real routes (collectNodeDevices, resolveAllocations, buildGpuReport,
 * visibleLatest, visibleSeries, poolGpus, buildMyGpuView, buildMyGpuHours).
 * A shape change in the product reaches the demo without a second copy.
 *
 * The story it tells:
 *  - pve-node-11, AI inference: two L40S passed through whole, one serving
 *    litellm-01, the other kept by a VM stopped for 12 days (reserved idle);
 *  - pve-node-12, data platform: an A100 80GB passed through to airflow-01 by
 *    its PCI address, saturated and short of memory, and a free L4;
 *  - pve-node-03, VDI and Acme: an A40 shared out as vGPUs (SR-IOV) between two
 *    provider VMs and the Acme Production vDC, which holds a contingent of
 *    2 x A40-12Q and 1 x A40-8Q;
 *  - every node, and the DR cluster, has its BMC console (ASPEED).
 */

import type { ConnectionGpuSnapshot } from '@/lib/gpu/collect'
import { workloads } from '@/lib/gpu/fleet'
import { collectNodeDevices, parsePciMappings, resolveAllocations, type GuestForAllocation, type PvePciEntry } from '@/lib/gpu/inventory'
import { visibleLatest, visibleSeries } from '@/lib/gpu/metrics'
import {
  GPU_RANGES,
  isGpuRange,
  type GpuMetricsSettings,
  type OrchestratorGpu,
  type OrchestratorProbe,
  type OrchestratorSeriesPoint,
  type OrchestratorSnapshot,
  type OrchestratorVgpu,
  type OrchestratorVgpuType,
  type VisibleVgpuType,
} from '@/lib/gpu/metricsShared'
import { buildGpuReport, type GpuReport } from '@/lib/gpu/report'
import { buildMyGpuHours, type HoursRow } from '@/lib/gpu/vdcHours'
import { entryUsage, poolGpus, quotaCapacity, quotaOffers, unresolvedVgpuModelsOf, type VdcGpuEntry } from '@/lib/gpu/vdcQuota'
import { buildMyGpuView } from '@/lib/gpu/vdcView'

import type { DemoMockMap } from './index'

const PROD = 'demo-pve-cluster-001'
const PROD_NAME = 'Production Cluster'
const DR = 'demo-pve-dr-001'
const DR_NAME = 'DR Cluster (GRA)'
const PROD_NODES = Array.from({ length: 12 }, (_, i) => `pve-node-${String(i + 1).padStart(2, '0')}`)
const DR_NODES = ['pve-dr-01', 'pve-dr-02', 'pve-dr-03', 'pve-dr-04']

const ACME_VDC = 'demo-vdc-acme-prod'
const ACME_POOL = 'vdc-acme-acme-prod'
const VDC_IDS = ['demo-vdc-acme-prod', 'demo-vdc-acme-dr', 'demo-vdc-globex-prod', 'demo-vdc-initech-prod']

const NVIDIA = '0x10de'
const A40 = { device: '0x2235', name: 'GA102GL [A40]', fbMiB: 46068 }
const L40S = { device: '0x26b9', name: 'AD102GL [L40S]', fbMiB: 46068 }
const A100 = { device: '0x20b5', name: 'GA100 [A100 PCIe 80GB]', fbMiB: 81920 }
const L4 = { device: '0x27b8', name: 'AD104GL [L4]', fbMiB: 23034 }

// ---- PVE side: PCI lists, mappings, VM configs ------------------------------

const bmc = (iommugroup: number): PvePciEntry => ({
  id: '0000:02:00.0', class: '0x030000', vendor: '0x1a03', device: '0x2000',
  vendor_name: 'ASPEED Technology, Inc.', device_name: 'ASPEED Graphics Family', iommugroup,
})

const card = (id: string, model: { device: string; name: string }, iommugroup: number, extra: Partial<PvePciEntry> = {}): PvePciEntry => ({
  id, class: '0x030200', vendor: NVIDIA, device: model.device, vendor_name: 'NVIDIA Corporation', device_name: model.name, iommugroup, ...extra,
})

// The A40 in SR-IOV mode: 32 virtual functions after its physical function.
const A40_VFS = Array.from({ length: 32 }, (_, i) => {
  const n = i + 4
  return `0000:3b:${String(Math.floor(n / 8)).padStart(2, '0')}.${n % 8}`
})

const PCI: Record<string, PvePciEntry[]> = {
  'pve-node-03': [
    card('0000:3b:00.0', A40, 44, { virtfns: Object.fromEntries(A40_VFS.map((v, i) => [`virtfn${i}`, v])) }),
    ...A40_VFS.map((id, i) => card(id, A40, 120 + i, { mdev: 1, physfn: '0000:3b:00.0', subsystem_vendor: NVIDIA, subsystem_device: '0x145a' })),
  ],
  'pve-node-11': [card('0000:41:00.0', L40S, 52), card('0000:c1:00.0', L40S, 96)],
  'pve-node-12': [card('0000:17:00.0', A100, 30), card('0000:ca:00.0', L4, 101)],
}

/** The PCI resource mappings of the production cluster, as PVE lists them. */
export const DEMO_GPU_PCI_MAPPINGS = [
  {
    id: 'a40-vgpu',
    description: 'NVIDIA A40, vGPU (SR-IOV) for VDI and tenants',
    mdev: 1,
    map: A40_VFS.map((p, i) => `node=pve-node-03,path=${p},id=10de:2235,subsystem-id=10de:145a,iommugroup=${120 + i}`),
    checks: [],
  },
  { id: 'l40s-ai-01', description: 'NVIDIA L40S, LLM inference', mdev: 0, map: ['node=pve-node-11,path=0000:41:00,id=10de:26b9,iommugroup=52'], checks: [] },
  { id: 'l40s-ai-02', description: 'NVIDIA L40S, LLM inference', mdev: 0, map: ['node=pve-node-11,path=0000:c1:00,id=10de:26b9,iommugroup=96'], checks: [] },
  { id: 'l4-inference', description: 'NVIDIA L4, spare inference card', mdev: 0, map: ['node=pve-node-12,path=0000:ca:00,id=10de:27b8,iommugroup=101'], checks: [] },
]

/** A40 profile catalog: name, mdev type, frame buffer (MiB). */
const A40_PROFILES: Array<[string, number, number, string]> = [
  ['A40-1B', 555, 1024, 'NVS'], ['A40-2B', 556, 2048, 'NVS'],
  ['A40-1Q', 557, 1024, 'Quadro'], ['A40-2Q', 558, 2048, 'Quadro'], ['A40-4Q', 560, 4096, 'Quadro'],
  ['A40-8Q', 562, 8192, 'Quadro'], ['A40-12Q', 563, 12288, 'Quadro'], ['A40-16Q', 564, 16384, 'Quadro'],
  ['A40-24Q', 565, 24576, 'Quadro'], ['A40-48Q', 566, 49152, 'Quadro'],
  ['A40-4C', 567, 4096, 'Compute'], ['A40-8C', 569, 8192, 'Compute'], ['A40-12C', 570, 12288, 'Compute'],
  ['A40-24C', 572, 24576, 'Compute'], ['A40-48C', 573, 49152, 'Compute'],
  ['A40-4A', 574, 4096, 'NVIDIA RTX Virtual Applications'],
]
const mdevOf = (profile: string) => `nvidia-${A40_PROFILES.find(p => p[0] === profile)![1]}`

type DemoGpuGuest = {
  vmid: number
  name: string
  node: string
  status: 'running' | 'stopped'
  pool: string | null
  hostpci0?: string
  /** Seconds since start, running VMs only. */
  uptime?: number
}

/** The VMs of the story; the Acme ones are added to the cluster resources too. */
export const DEMO_GPU_GUESTS: DemoGpuGuest[] = [
  { vmid: 251, name: 'litellm-01', node: 'pve-node-11', status: 'running', pool: null, hostpci0: 'mapping=l40s-ai-01,pcie=1', uptime: 19 * 86400 + 4 * 3600 },
  { vmid: 219, name: 'app-staging-decom-01', node: 'pve-node-11', status: 'stopped', pool: null, hostpci0: 'mapping=l40s-ai-02,pcie=1' },
  { vmid: 248, name: 'airflow-01', node: 'pve-node-12', status: 'running', pool: null, hostpci0: '0000:17:00,pcie=1', uptime: 41 * 86400 },
  { vmid: 200, name: 'win-rds-03', node: 'pve-node-03', status: 'running', pool: 'BACKUP', hostpci0: `mapping=a40-vgpu,mdev=${mdevOf('A40-8Q')},pcie=1`, uptime: 8 * 86400 },
  { vmid: 249, name: 'power-bi-01', node: 'pve-node-03', status: 'running', pool: null, hostpci0: `mapping=a40-vgpu,mdev=${mdevOf('A40-4Q')},pcie=1`, uptime: 8 * 86400 },
  { vmid: 1101, name: 'acme-ml-01', node: 'pve-node-03', status: 'running', pool: ACME_POOL, hostpci0: `mapping=a40-vgpu,mdev=${mdevOf('A40-12Q')},pcie=1`, uptime: 3 * 86400 + 7200 },
  { vmid: 1102, name: 'acme-cad-01', node: 'pve-node-03', status: 'stopped', pool: ACME_POOL, hostpci0: `mapping=a40-vgpu,mdev=${mdevOf('A40-8Q')},pcie=1` },
  { vmid: 1103, name: 'acme-web-01', node: 'pve-node-03', status: 'running', pool: ACME_POOL, uptime: 21 * 86400 },
]

/** SMBIOS UUID of a demo VM, the scheme of buildDemoGuestConfig: how a vGPU host names it. */
const uuidOf = (vmid: number) => `00000000-0000-4000-9000-${String(vmid).padStart(12, '0')}`

/** The GPU lines a demo guest config carries (VM hardware tab), or null. */
export function demoGpuGuestConfig(vmid: number): Record<string, string> | null {
  const g = DEMO_GPU_GUESTS.find(x => x.vmid === vmid)
  if (!g) return null
  return { ...(g.hostpci0 ? { hostpci0: g.hostpci0 } : {}), smbios1: `uuid=${uuidOf(g.vmid)}` }
}

/** The Acme VMs as /cluster/resources rows, appended to the production inventory. */
export function demoGpuExtraResources(): any[] {
  return DEMO_GPU_GUESTS.filter(g => g.pool === ACME_POOL).map(g => ({
    id: `qemu/${g.vmid}`, type: 'qemu', vmid: g.vmid, name: g.name, node: g.node, status: g.status, pool: g.pool,
    tags: ['acme', 'tenant'], template: false, maxcpu: 8, cpu: g.status === 'running' ? 0.21 : 0, maxmem: 32 * 1024 ** 3,
    mem: g.status === 'running' ? 19 * 1024 ** 3 : 0, maxdisk: 200 * 1024 ** 3, disk: 0, uptime: g.uptime ?? 0,
  }))
}

// ---- inventory ---------------------------------------------------------------

function snapshots(): ConnectionGpuSnapshot[] {
  const generatedAt = new Date().toISOString()
  const mappings = parsePciMappings(DEMO_GPU_PCI_MAPPINGS)
  const prodDevices = PROD_NODES.flatMap((node, i) => collectNodeDevices(PROD, node, [bmc(18 + i), ...(PCI[node] ?? [])], mappings))
  const guests: GuestForAllocation[] = DEMO_GPU_GUESTS.map(g => ({
    vmid: String(g.vmid), node: g.node, name: g.name, status: g.status, template: false, pool: g.pool,
    tags: [], uptime: g.uptime ?? null, config: demoGpuGuestConfig(g.vmid),
  }))
  const base = { mappingsError: null, guestsError: null, error: null, generatedAt }
  return [
    {
      ...base, connId: PROD, connectionName: PROD_NAME,
      nodes: PROD_NODES.map(node => ({ node, online: true, error: null })),
      devices: prodDevices,
      allocations: resolveAllocations(PROD, prodDevices, mappings, guests),
      configReads: guests.length,
    },
    {
      ...base, connId: DR, connectionName: DR_NAME,
      nodes: DR_NODES.map(node => ({ node, online: true, error: null })),
      devices: DR_NODES.flatMap((node, i) => collectNodeDevices(DR, node, [bmc(18 + i)], [])),
      allocations: [],
      configReads: 0,
    },
  ]
}

/** The provider's GPU report, narrowed as /api/v1/gpu?connId=&node= narrows it. */
export function demoGpuReport(connId: string | null = null, node: string | null = null): GpuReport {
  const snaps = snapshots().filter(s => !connId || s.connId === connId)
  return buildGpuReport(snaps, { tenantPools: null, visibleNodes: null, visibleVms: null, node })
}

// ---- readings ----------------------------------------------------------------

const SETTINGS: GpuMetricsSettings = {
  enabled: true,
  interval_seconds: 60,
  retention_days: 30,
  guest_vms: [251, 248, 200, 1101].map(vmid => ({ connection_id: PROD, vmid })),
  host_nodes: ['pve-node-03', 'pve-node-12'].map(node => ({ connection_id: PROD, node })),
  thresholds: { util_pct: 90, memory_pct: 90, temp_c: 85 },
  alerts: true,
  idle_days: 7,
}

type Profile = {
  target: string
  source: 'guest' | 'host'
  node: string
  vmid?: number
  name: string
  busId: string
  memTotal: number
  powerLimit: number
  /** Load around which the reading moves, its swing and its daily shape. */
  util: number
  swing: number
  shape: 'office' | 'night' | 'steady' | 'idle'
  /** Memory in use as a share of the total, at load 0 and at load 100. */
  memLow: number
  memHigh: number
  idleTemp: number
  idlePower: number
  powerSlowAbove?: number
}

const PROFILES: Profile[] = [
  { target: 'vm:251:GPU-1f0b7e52-l40s', source: 'guest', node: 'pve-node-11', vmid: 251, name: 'NVIDIA L40S', busId: '0000:01:00', memTotal: L40S.fbMiB, powerLimit: 350, util: 58, swing: 22, shape: 'office', memLow: 0.62, memHigh: 0.74, idleTemp: 38, idlePower: 36 },
  { target: 'vm:248:GPU-8c21d9aa-a100', source: 'guest', node: 'pve-node-12', vmid: 248, name: 'NVIDIA A100 80GB PCIe', busId: '0000:01:00', memTotal: A100.fbMiB, powerLimit: 300, util: 82, swing: 16, shape: 'night', memLow: 0.71, memHigh: 0.95, idleTemp: 41, idlePower: 52, powerSlowAbove: 92 },
  { target: 'node:pve-node-03:0000:3b:00', source: 'host', node: 'pve-node-03', name: 'NVIDIA A40', busId: '0000:3b:00', memTotal: A40.fbMiB, powerLimit: 300, util: 34, swing: 26, shape: 'office', memLow: 0.2, memHigh: 0.42, idleTemp: 33, idlePower: 31 },
  { target: 'node:pve-node-12:0000:ca:00', source: 'host', node: 'pve-node-12', name: 'NVIDIA L4', busId: '0000:ca:00', memTotal: L4.fbMiB, powerLimit: 72, util: 0, swing: 0, shape: 'idle', memLow: 0.001, memHigh: 0.001, idleTemp: 31, idlePower: 16 },
  // Guest readings of two vGPU slices: their history in the vGPU detail.
  { target: 'vm:200:GPU-3d5e1a90-vgpu', source: 'guest', node: 'pve-node-03', vmid: 200, name: 'NVIDIA A40-8Q', busId: '0000:01:00', memTotal: 8192, powerLimit: 0, util: 24, swing: 20, shape: 'office', memLow: 0.28, memHigh: 0.55, idleTemp: 0, idlePower: 0 },
  { target: 'vm:1101:GPU-7a90c4d2-vgpu', source: 'guest', node: 'pve-node-03', vmid: 1101, name: 'NVIDIA A40-12Q', busId: '0000:01:00', memTotal: 12288, powerLimit: 0, util: 61, swing: 24, shape: 'steady', memLow: 0.6, memHigh: 0.9, idleTemp: 0, idlePower: 0 },
]

/** Deterministic noise in [-1, 1] for a target at a time: the graph scrolls, it is not redrawn. */
function noise(seed: string, t: number): number {
  let h = 2166136261
  const s = `${seed}|${Math.floor(t)}`
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) / 0xffffffff) * 2 - 1
}

/** The reading of a profile at a time (seconds), from its shape over the day. */
function sample(p: Profile, t: number) {
  const hour = (t / 3600 + 1) % 24
  const office = Math.max(0, Math.sin(((hour - 7) / 12) * Math.PI))
  const night = hour < 6 || hour >= 22 ? 1 : 0.55
  const day = p.shape === 'office' ? office * 1.3 - 0.4 : p.shape === 'night' ? night - 0.5 : 0
  const slow = noise(`${p.target}/slow`, t / 1800) * 0.5
  const util = p.shape === 'idle' ? 0 : Math.max(0, Math.min(100, p.util + p.swing * (day + slow) + 6 * noise(p.target, t / 60)))
  const memUsed = Math.round(p.memTotal * (p.memLow + (p.memHigh - p.memLow) * (util / 100)))
  const temp = p.idleTemp ? Math.round(p.idleTemp + util * 0.42 + 2 * noise(`${p.target}/temp`, t / 300)) : 0
  const power = p.powerLimit ? Math.round(Math.min(p.powerLimit, p.idlePower + (p.powerLimit - p.idlePower) * (util / 100) * 0.95)) : 0
  return { util: Math.round(util), memUsed, temp, power, powerSlow: p.powerSlowAbove !== undefined && util >= p.powerSlowAbove }
}

/** Running vGPUs, as the A40 host driver reports them. */
function vgpus(at: string, t: number): OrchestratorVgpu[] {
  const slices: Array<[number, string, number]> = [[200, 'A40-8Q', 24], [249, 'A40-4Q', 9], [1101, 'A40-12Q', 61]]
  return slices.map(([vmid, profile, util]) => {
    const g = DEMO_GPU_GUESTS.find(x => x.vmid === vmid)!
    const [, typeId, fb] = A40_PROFILES.find(p => p[0] === profile)!
    const u = Math.max(0, Math.round(util + 8 * noise(`vgpu/${vmid}`, t / 60)))
    return {
      connection_id: PROD, node: 'pve-node-03', bus_id: '0000:3b:00', id: `0000${vmid}`, vm_uuid: uuidOf(vmid).toUpperCase(),
      vm_name: g.name, type_id: typeId, type_name: profile, fb_total: fb, fb_used: Math.round(fb * (0.35 + u / 200)),
      util: u, mem_util: Math.round(u * 0.6), licensed: true, license: 'Licensed (Expiry: 2027-3-31 23:59:59 GMT)',
      guest_driver: '553.24', at,
    }
  })
}

function orchestratorSnapshot(now = Date.now()): OrchestratorSnapshot {
  const t = Math.floor(now / 1000 / 60) * 60
  const at = new Date(t * 1000).toISOString()
  const running = vgpus(at, t)
  const gpus: OrchestratorGpu[] = PROFILES.map(p => {
    const s = sample(p, t)
    // The host of a vGPU card reports the frame buffer its vGPUs use (collector).
    const memUsed = p.target.startsWith('node:pve-node-03') ? running.reduce((n, v) => n + v.fb_used, 0) : s.memUsed
    return {
      connection_id: PROD, target: p.target, source: p.source, node: p.node, ...(p.vmid ? { vmid: p.vmid } : {}),
      index: 0, uuid: p.target.split(':').at(-1) ?? '', name: p.name, bus_id: p.busId, at, util: s.util,
      mem_util: Math.round(s.util * 0.55), mem_used: memUsed, mem_total: p.memTotal, temp: s.temp, power: s.power,
      power_limit: p.powerLimit, thermal_slow: false, power_slow: s.powerSlow,
    }
  })
  const probes: OrchestratorProbe[] = [
    ...SETTINGS.guest_vms.map(g => ({ connection_id: PROD, kind: 'guest' as const, vmid: g.vmid, node: DEMO_GPU_GUESTS.find(x => x.vmid === g.vmid)?.node, status: 'ok', at, gpus: 1 })),
    ...SETTINGS.host_nodes.map(n => ({ connection_id: PROD, kind: 'host' as const, node: n.node, status: 'ok', at, gpus: 1 })),
  ]
  const vgpuTypes: OrchestratorVgpuType[] = A40_PROFILES.map(([name, typeId, fb, cls]) => ({
    connection_id: PROD, node: 'pve-node-03', bus_id: '0000:3b:00', type_id: typeId, name, class: cls,
    fb_memory: fb, max_instances: Math.min(32, Math.floor(49152 / fb)),
  }))
  return { at, gpus, probes, vgpus: running, vgpu_types: vgpuTypes }
}

function latest() {
  const snap = orchestratorSnapshot()
  return {
    ...visibleLatest(demoGpuReport(), snap),
    enabled: SETTINGS.enabled,
    intervalSeconds: SETTINGS.interval_seconds,
    thresholds: SETTINGS.thresholds,
    configured: true,
  }
}

function series(range: string) {
  const r = isGpuRange(range) ? range : '24h'
  const { seconds, step } = GPU_RANGES[r]
  const to = Math.ceil(Date.now() / 1000 / step) * step
  const from = to - seconds
  const points: OrchestratorSeriesPoint[] = []
  for (const p of PROFILES) {
    for (let t = from; t < to; t += step) {
      const s = sample(p, t)
      const peak = sample(p, t + step / 3)
      points.push({
        connection_id: PROD, target: p.target, time: t, util: s.util, util_max: Math.max(s.util, peak.util),
        mem_util: Math.round(s.util * 0.55), mem_used: s.memUsed, mem_used_max: Math.max(s.memUsed, peak.memUsed),
        mem_total: p.memTotal, temp_max: Math.max(s.temp, peak.temp), power: s.power, power_max: Math.max(s.power, peak.power),
        power_limit: p.powerLimit, thermal_slow: 0, power_slow: s.powerSlow ? 1 : 0,
      })
    }
  }
  const report = demoGpuReport()
  return { range: r, stepSeconds: step, from, to, series: visibleSeries(report, points, orchestratorSnapshot().gpus) }
}

function settings() {
  const report = demoGpuReport()
  const guests = workloads(report)
    .filter(w => !w.template)
    .map(w => ({
      connectionId: w.connId, connectionName: w.connectionName, node: w.node, vmid: Number(w.vmid), vmName: w.vmName,
      vmStatus: w.vmStatus, gpus: w.gpus.map(g => g.deviceName || g.vendorName || '?'),
    }))
  const nodes = [...new Map(report.devices.filter(d => d.kind === 'gpu').map(d => [`${d.connId}|${d.node}`, { connectionId: d.connId, connectionName: d.connectionName, node: d.node }])).values()]
  return { settings: SETTINGS, candidates: { guests, nodes } }
}

// ---- actions (read side) -----------------------------------------------------

function catalog(): VisibleVgpuType[] {
  return latest().vgpuTypes
}

/** Profiles still startable on the A40, as PVE's mdev list reports them. */
function profiles(deviceKey: string) {
  const report = demoGpuReport()
  const device = report.devices.find(d => d.key === deviceKey && d.kind === 'gpu')
  if (!device) return new Response(JSON.stringify({ error: 'device_not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })
  if (device.vgpu?.mode !== 'sriov') return new Response(JSON.stringify({ error: 'not_vgpu_capable' }), { status: 409, headers: { 'content-type': 'application/json' } })
  const usedMiB = DEMO_GPU_GUESTS.filter(g => g.hostpci0?.includes('mdev=')).reduce((n, g) => {
    const id = Number(/mdev=nvidia-(\d+)/.exec(g.hostpci0 ?? '')?.[1])
    return n + (A40_PROFILES.find(p => p[1] === id)?.[2] ?? 0)
  }, 0)
  const freeMiB = 49152 - usedMiB
  return {
    data: A40_PROFILES.map(([name, typeId, fb]) => ({ type: `nvidia-${typeId}`, name, available: Math.max(0, Math.floor(freeMiB / fb)) })),
  }
}

/** The VMs of the card's node, stopped first, as the attach dialog lists them. */
function candidates(deviceKey: string) {
  const m = /^([^:]+):([A-Za-z0-9.-]{1,63}):/.exec(deviceKey)
  if (!m) return new Response(JSON.stringify({ error: 'invalid_device' }), { status: 400, headers: { 'content-type': 'application/json' } })
  const [, connId, node] = m
  const vms = DEMO_GPU_GUESTS.filter(g => g.node === node).map(g => ({ connId, node, vmid: String(g.vmid), name: g.name, status: g.status, pool: g.pool }))
  vms.sort((a, b) => Number(a.status !== 'stopped') - Number(b.status !== 'stopped') || a.name.localeCompare(b.name))
  return { data: vms }
}

// ---- vDC ---------------------------------------------------------------------

/** The Acme Production contingent, named after what the quota editor offers. */
function vdcEntries(vdcId: string): VdcGpuEntry[] {
  if (vdcId !== ACME_VDC) return []
  const offers = quotaOffers(demoGpuReport(), catalog(), PROD)
  const line = (id: string, profileName: string, count: number): VdcGpuEntry => {
    const offer = offers.find(o => o.kind === 'vgpu' && o.profileName === profileName)
    return { id, kind: 'vgpu', modelKey: `${NVIDIA}:${A40.device}`, modelName: offer?.modelName ?? 'NVIDIA A40', profileName, count }
  }
  return [line('demo-gpuq-acme-12q', 'A40-12Q', 2), line('demo-gpuq-acme-8q', 'A40-8Q', 1)]
}

function vdcContext(vdcId: string) {
  const report = demoGpuReport(PROD)
  const cat = catalog()
  const entries = vdcEntries(vdcId)
  const gpus = poolGpus(report, ACME_POOL, cat)
  return {
    conn: null,
    snapshot: snapshots()[0],
    report,
    catalog: cat,
    latest: visibleLatest(report, orchestratorSnapshot()),
    entries,
    gpus,
    usage: entryUsage(entries, gpus),
    unresolvedVgpuModels: unresolvedVgpuModelsOf(gpus),
  }
}

const notFound = () => new Response(JSON.stringify({ error: 'not_found' }), { status: 404, headers: { 'content-type': 'application/json' } })

function vdcQuota(vdcId: string) {
  const ctx = vdcContext(vdcId)
  return {
    data: {
      entries: ctx.entries.map(e => {
        const held = ctx.usage.get(e.id) ?? 0
        return { ...e, held, overCommitted: held > e.count }
      }),
      offers: quotaOffers(ctx.report, ctx.catalog, PROD),
      capacity: quotaCapacity(ctx.report, ctx.catalog, PROD),
      readable: true,
    },
  }
}

/** GPU hours of the Acme VMs over a month, hour by hour as the sampler stores them, up to now. */
function vdcHours(month: string) {
  const m = /^(\d{4})-(\d{2})$/.exec(month)
  if (!m) return new Response(JSON.stringify({ error: 'invalid_body' }), { status: 400, headers: { 'content-type': 'application/json' } })
  const start = Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)
  const end = Math.min(Date.UTC(Number(m[1]), Number(m[2]), 1), Date.now())
  const rows: HoursRow[] = []
  const deviceKey = `${PROD}:pve-node-03:0000:3b:00`
  const stoppedSince = Date.now() - 5 * 86400_000
  for (let day = start; day < end; day += 86400_000) {
    const hours = Math.min(24, (end - day) / 3600_000)
    const weekday = new Date(day).getUTCDay() % 6 !== 0
    rows.push({ vmid: 1101, vmName: 'acme-ml-01', deviceKey, modelName: 'NVIDIA A40', mdev: mdevOf('A40-12Q'), runningSeconds: Math.round(hours * 3600), reservedSeconds: Math.round(hours * 3600) })
    rows.push({
      vmid: 1102, vmName: 'acme-cad-01', deviceKey, modelName: 'NVIDIA A40', mdev: mdevOf('A40-8Q'),
      runningSeconds: weekday && day < stoppedSince ? Math.round(Math.min(hours, 9) * 3600) : 0,
      reservedSeconds: Math.round(hours * 3600),
    })
  }
  return { data: buildMyGpuHours(month, rows, catalog()) }
}

function vdcCandidates() {
  return { data: DEMO_GPU_GUESTS.filter(g => g.pool === ACME_POOL).map(g => ({ vmid: String(g.vmid), name: g.name, status: g.status })) }
}

// ---- registry ------------------------------------------------------------------

export const GPU_MOCKS: DemoMockMap = {
  get 'GET:/api/v1/gpu/metrics/latest'() {
    return { data: latest() }
  },
  get 'GET:/api/v1/gpu/metrics/settings'() {
    return { data: settings() }
  },
}

export function resolveGpuMock(method: string, cleanPath: string, url: URL): any | null {
  if (method !== 'GET') return null
  const q = url.searchParams
  if (cleanPath === '/api/v1/gpu') return { data: demoGpuReport(q.get('connId'), q.get('node')) }
  if (cleanPath === '/api/v1/gpu/metrics/series') return { data: series(q.get('range') ?? '24h') }
  if (cleanPath === '/api/v1/gpu/actions/profiles') return profiles(q.get('deviceKey') ?? '')
  if (cleanPath === '/api/v1/gpu/actions/candidates') return candidates(q.get('deviceKey') ?? '')

  const vdc = /^\/api\/v1\/vdcs\/([^/]+)\/gpu(?:\/(quota|candidates|hours))?$/.exec(cleanPath)
  if (!vdc || !VDC_IDS.includes(vdc[1])) return null
  const [, vdcId, sub] = vdc
  if (sub === 'quota') return vdcQuota(vdcId)
  // A vDC without a contingent has no GPU section: the tenant routes answer 404.
  if (vdcEntries(vdcId).length === 0) return notFound()
  if (sub === 'candidates') return vdcCandidates()
  if (sub === 'hours') return vdcHours(q.get('month') ?? new Date().toISOString().slice(0, 7))
  return { data: buildMyGpuView(vdcContext(vdcId), null) }
}
