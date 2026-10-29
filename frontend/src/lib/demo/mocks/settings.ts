/**
 * Demo mocks for the settings and security screens (/settings, /security),
 * and for the vDC detail endpoints read by /my-vdc. See ./index.ts for the contract.
 */

import { ALL_SCOPE_IDS } from '@/lib/api-tokens/scopes'
import { assessFramework } from '@/lib/compliance/frameworkAssessment'
import { FRAMEWORKS, getCrosswalk } from '@/lib/compliance/frameworks'
import type { HardeningCheck } from '@/lib/compliance/hardening'
import { DEFAULT_TLS_SETTINGS } from '@/lib/tls/schema'
import { aggregateUsage, USAGE_BUCKETS, type UsageBucket, type UsageSampleRow } from '@/lib/vdc/usageHistory/aggregate'

import MOCK_DATA from '../mock-data.json'

import type { DemoMockMap, DemoMockResolver } from './index'

const MD = MOCK_DATA as Record<string, any>
const DAY = 86400000
const PROD = 'demo-pve-cluster-001'
const DR = 'demo-pve-dr-001'

const isoDaysAgo = (days: number, hourUtc = 9): string => {
  const today = Date.now() - (Date.now() % DAY)

  return new Date(today - days * DAY + hourUtc * 3600000).toISOString()
}

// ---------------------------------------------------------------------------
// Demo universe
// ---------------------------------------------------------------------------

const PROD_NODES: Array<{ node: string; status: string; ip: string; cpu: number; maxcpu: number; mem: number; maxmem: number }> =
  ((MD[`/api/v1/connections/${PROD}/nodes`]?.data ?? []) as any[])
    .map(n => ({ node: n.node, status: n.status, ip: n.ip, cpu: n.cpu, maxcpu: n.maxcpu, mem: n.mem, maxmem: n.maxmem }))
    .sort((a, b) => a.node.localeCompare(b.node))

const DR_NODES = [1, 2, 3, 4].map(i => ({
  node: `pve-dr-0${i}`, status: 'online', ip: `10.20.20.${i}`, cpu: 0.02, maxcpu: 32, mem: 28 * 2 ** 30, maxmem: 64 * 2 ** 30,
}))

const nodesOf = (connId: string) => (connId === DR ? DR_NODES : connId === PROD ? PROD_NODES : null)

const VDC_IDS = ['demo-vdc-acme-prod', 'demo-vdc-acme-dr', 'demo-vdc-globex-prod', 'demo-vdc-initech-prod']
const vdcOf = (id: string): any | null => MD[`/api/v1/admin/vdcs/${id}`]?.data ?? null
const VDCS = VDC_IDS.map(vdcOf).filter(Boolean)
const vnetsOf = (vdcId: string): any[] => MD[`/api/v1/vdcs/${vdcId}/vnets`]?.data ?? []

// Guests placed in each vDC pool: a stable slice of the prod cluster guests.
const PROD_GUESTS: any[] = ((MD[`/api/v1/connections/${PROD}/resources`]?.data ?? []) as any[])
  .filter(r => r.type === 'qemu' && !r.template)
  .sort((a, b) => a.vmid - b.vmid)
const vdcGuests = (vdcId: string): any[] => {
  const idx = VDC_IDS.indexOf(vdcId)

  return idx < 0 ? [] : PROD_GUESTS.filter((_, i) => i % 9 === idx).slice(0, 6)
}

// ---------------------------------------------------------------------------
// Connections (vDC cluster picker, PBS picker, green tree)
// ---------------------------------------------------------------------------

const ADMIN_CONNECTIONS = [
  { id: PROD, tenantId: 'default', name: 'Production Cluster', type: 'pve', baseUrl: 'https://10.10.10.1:8006', hasCeph: true, sshEnabled: true, fingerprint: null, createdAt: '2026-03-03T12:07:47.325Z', inProviderPool: true },
  { id: DR, tenantId: 'default', name: 'DR Cluster (GRA)', type: 'pve', baseUrl: 'https://10.20.20.1:8006', hasCeph: true, sshEnabled: false, fingerprint: null, createdAt: '2026-02-15T10:00:00.000Z', inProviderPool: true },
  { id: 'demo-pbs-paris-001', tenantId: 'default', name: 'Paris North 1 PBS', type: 'pbs', baseUrl: 'https://10.10.10.70:8007', hasCeph: false, sshEnabled: false, fingerprint: '4E:1A:9C:22:D0:7B:63:AF:18:5E:C4:90:3B:77:E2:0D:A6:51:F8:2C:94:3E:B7:61:0A:D5:7C:E9:48:12:6F:B3', createdAt: '2026-01-10T09:00:00.000Z', inProviderPool: true },
  { id: 'demo-pbs-frankfurt-001', tenantId: 'default', name: 'Frankfurt East 1 PBS', type: 'pbs', baseUrl: 'https://10.30.30.60:8007', hasCeph: false, sshEnabled: false, fingerprint: '7B:03:E5:9A:41:C8:2F:66:D1:0E:B4:57:9C:23:F0:8A:65:1D:C7:3B:E2:94:58:AF:06:7E:D3:21:4C:B9:80:1F', createdAt: '2026-01-12T09:00:00.000Z', inProviderPool: true },
  { id: 'demo-pbs-001', tenantId: 'default', name: 'PBS Master', type: 'pbs', baseUrl: 'https://10.10.10.50:8007', hasCeph: false, sshEnabled: false, fingerprint: '60:00:60:00:60:00:60:00:60:00:60:00:60:00:60:00:60:00:60:00:60:00:60:00:60:00:60:00:60:00:60:00', createdAt: '2026-02-23T08:53:24.099Z', inProviderPool: false },
  { id: 'demo-pbs-002', tenantId: 'default', name: 'PBS Replica', type: 'pbs', baseUrl: 'https://10.10.10.51:8007', hasCeph: false, sshEnabled: false, fingerprint: null, createdAt: '2026-02-23T08:53:41.732Z', inProviderPool: false },
  { id: 'demo-esxi-001', tenantId: 'default', name: 'ESXi Datacenter', type: 'vmware', baseUrl: 'https://10.10.10.60', hasCeph: false, sshEnabled: false, fingerprint: null, createdAt: '2026-03-07T18:06:36.529Z', inProviderPool: false },
]

const TIB = 2 ** 40

// Shape of GET /admin/connections/[id]/available-resources, read by VdcTab and StoragePoliciesSection.
function availableResources(connId: string) {
  const nodes = nodesOf(connId)

  if (!nodes) return null
  const isDr = connId === DR

  return {
    data: {
      nodes: nodes.map(n => ({ name: n.node, status: n.status, cpu: n.cpu, maxcpu: n.maxcpu, mem: n.mem, maxmem: n.maxmem })),
      storages: [
        { id: 'ceph-block', type: 'rbd', content: 'images,rootdir', shared: true, nodes: null, disk: Math.round((isDr ? 9.4 : 21.7) * TIB), maxdisk: (isDr ? 24 : 36) * TIB },
        { id: 'ceph-fast', type: 'rbd', content: 'images', shared: true, nodes: null, disk: Math.round((isDr ? 1.1 : 4.2) * TIB), maxdisk: (isDr ? 4 : 8) * TIB },
        { id: 'nfs-archive', type: 'nfs', content: 'images,iso,backup', shared: true, nodes: null, disk: Math.round(12.6 * TIB), maxdisk: 40 * TIB },
      ],
      pools: isDr ? ['BACKUP', 'replicas'] : ['BACKUP', ...VDCS.map(v => v.pvePoolName)],
    },
  }
}

// Shape of GET /admin/connections/[id]/green-config, read by DatacenterAssignmentTree.
function greenConfig(connId: string) {
  const nodes = nodesOf(connId)

  if (!nodes) return null
  const updatedAt = '2026-06-12T10:30:00.000Z'
  // Matches /admin/datacenters/*/assignments: Paris owns the prod cluster, Frankfurt pins two of its nodes.
  const pinned: Record<string, string> = connId === PROD ? { 'pve-node-04': 'demo-dc-frankfurt', 'pve-node-05': 'demo-dc-frankfurt' } : {}

  return {
    data: {
      cluster: connId === PROD
        ? { connectionId: connId, datacenterId: 'demo-dc-paris', tdpPerCoreW: 9.5, wattsPerGbRam: 0.375, overheadPerNodeW: 60, updatedAt }
        : null,
      nodes: nodes.map(n => ({
        connectionId: connId,
        nodeName: n.node,
        datacenterId: pinned[n.node] ?? null,
        tdpPerCoreW: null,
        wattsPerGbRam: null,
        overheadPerNodeW: null,
        updatedAt: pinned[n.node] ? updatedAt : '',
        status: n.status,
      })),
    },
  }
}

// Shape of GET /admin/connections/[id]/node-addresses ({ nodes, devices }), read by VdcTab.
function nodeAddresses(connId: string) {
  const nodes = nodesOf(connId)

  if (!nodes) return null
  const subnet = connId === DR ? '10.20' : '10.10'

  return {
    data: {
      nodes: nodes.map((n, i) => ({
        name: n.node,
        online: n.status === 'online',
        clusterIp: n.ip,
        addresses: [n.ip, `${subnet}.40.${i + 1}`, `${subnet}.50.${i + 1}`],
        ifaces: [
          { iface: 'bond0', type: 'bond', mtu: 9000, cidr: null },
          { iface: 'eno1', type: 'eth', mtu: 1500, cidr: null },
          { iface: 'vmbr0', type: 'bridge', mtu: 1500, cidr: `${n.ip}/24` },
          { iface: 'vmbr1', type: 'bridge', mtu: 9000, cidr: `${subnet}.40.${i + 1}/24` },
          { iface: 'vmbr1.50', type: 'vlan', mtu: 9000, cidr: `${subnet}.50.${i + 1}/24` },
        ],
      })),
      devices: ['bond0', 'eno1', 'vmbr0', 'vmbr1', 'vmbr1.50'],
    },
  }
}

// Shape of GET /admin/connections/[id]/provider-bridges (flat array), read by VdcTab.
function providerBridges(connId: string, url: URL) {
  const nodes = nodesOf(connId)

  if (!nodes) return null
  const names = nodes.map(n => n.node)

  if (url.searchParams.get('scope') === 'vlan-pool') {
    return {
      data: [
        { iface: 'vmbr0', nodes: names, type: 'bridge', active: 1, comments: 'Management and public uplink', vlanAware: true },
        { iface: 'vmbr1', nodes: names, type: 'bridge', active: 1, comments: 'Tenant trunk', vlanAware: true },
      ],
    }
  }

  return {
    data: [
      { iface: 'vmbr0', nodes: names, type: 'bridge', active: 1, comments: 'Management and public uplink' },
      { iface: 'vmbr1', nodes: names, type: 'bridge', active: 1, comments: 'Tenant trunk' },
      { iface: 'vmbr2', nodes: names, type: 'bridge', active: 1, comments: 'Backup network' },
      { iface: 'transit', type: 'sdn-vnet', zone: 'provider', tag: 4001, alias: 'Internet transit' },
      { iface: 'mgmtsvc', type: 'sdn-vnet', zone: 'provider', tag: 4002, alias: 'Managed services' },
    ],
  }
}

const STORAGE_POLICIES: Record<string, any[]> = {
  [PROD]: [
    { id: 'demo-sp-gold', connectionId: PROD, name: 'Gold', description: 'Latency-sensitive databases', storageId: 'ceph-fast', iopsRd: 20000, iopsWr: 10000, mbpsRd: 800, mbpsWr: 400, vdcCount: 2, createdAt: '2026-02-01T09:00:00.000Z', updatedAt: '2026-07-14T16:20:00.000Z' },
    { id: 'demo-sp-silver', connectionId: PROD, name: 'Silver', description: 'General purpose workloads', storageId: 'ceph-block', iopsRd: 5000, iopsWr: 2500, mbpsRd: 300, mbpsWr: 150, vdcCount: 4, createdAt: '2026-02-01T09:00:00.000Z', updatedAt: '2026-05-03T11:00:00.000Z' },
    { id: 'demo-sp-bronze', connectionId: PROD, name: 'Bronze', description: 'Archive and cold data', storageId: 'nfs-archive', iopsRd: 800, iopsWr: 400, mbpsRd: 100, mbpsWr: 50, vdcCount: 1, createdAt: '2026-03-12T09:00:00.000Z', updatedAt: '2026-03-12T09:00:00.000Z' },
  ],
  [DR]: [
    { id: 'demo-sp-dr-standard', connectionId: DR, name: 'DR Standard', description: 'Replica disks', storageId: 'ceph-block', iopsRd: 3000, iopsWr: 1500, mbpsRd: 200, mbpsWr: 100, vdcCount: 1, createdAt: '2026-02-20T09:00:00.000Z', updatedAt: '2026-02-20T09:00:00.000Z' },
  ],
}

// Shape of GET .../storage-policies/[policyId]/disks ({ vms }), read by StoragePoliciesSection.
function policyDisks(connId: string, policyId: string) {
  const policy = (STORAGE_POLICIES[connId] ?? []).find(p => p.id === policyId)

  if (!policy) return null
  const guests = connId === PROD ? PROD_GUESTS.filter((_, i) => i % 11 === policy.name.length % 11).slice(0, 5) : []

  return {
    data: {
      vms: guests.map((g, i) => {
        const drift = i === 3
        const cap = (v: number | null) => (drift && v != null ? Math.round(v / 2) : v)

        return {
          vmid: g.vmid,
          name: g.name,
          node: g.node,
          vmstatus: g.status,
          disks: [
            { key: 'scsi0', iopsRd: policy.iopsRd, iopsWr: policy.iopsWr, mbpsRd: policy.mbpsRd, mbpsWr: policy.mbpsWr, inSync: true },
            ...(i % 2 === 0 ? [{ key: 'scsi1', iopsRd: cap(policy.iopsRd), iopsWr: cap(policy.iopsWr), mbpsRd: policy.mbpsRd, mbpsWr: policy.mbpsWr, inSync: !drift }] : []),
          ],
        }
      }),
    },
  }
}

// ---------------------------------------------------------------------------
// vDC admin sub-resources
// ---------------------------------------------------------------------------

// Shape of GET /admin/vdcs/[id]/zone (ZoneStatus), read by VdcTab.
function vdcZone(vdc: any) {
  const peers = PROD_NODES.filter(n => vdc.nodes.includes(n.node)).map(n => n.ip)

  return {
    data: {
      zoneName: vdc.sdnZoneName,
      desired: { peers, mtu: 1450 },
      live: { type: 'vxlan', peers, mtu: 1450, state: 'available', pending: null },
      inSync: true,
    },
  }
}

// Shape of GET /admin/vdcs/[id]/transport/provision ({ nodes }), read by VdcTab.
function vdcTransport(vdc: any) {
  return {
    data: {
      nodes: (vdc.nodes as string[]).map((node, i) => ({
        node,
        iface: 'vmbr1.50',
        state: 'provisioned',
        wanted: `10.10.50.${i + 1}/24`,
        found: `10.10.50.${i + 1}/24`,
      })),
    },
  }
}

// ---------------------------------------------------------------------------
// vDC usage history (admin and tenant) and /my-vdc cards
// ---------------------------------------------------------------------------

const HISTORY_SETTINGS = { enabled: true, intervalMinutes: 15, retentionDays: 400 }
const SAMPLE_MS = HISTORY_SETTINGS.intervalMinutes * 60000

// A vDC removed in August: its samples stay until the retention purges them.
const DELETED_VDC = {
  vdcId: 'demo-vdc-globex-staging', vdcName: 'Globex Staging', tenantId: 'demo-tenant-globex', tenantName: 'Globex SAS',
  connectionId: PROD, firstSampledAt: '2026-03-20T00:00:00.000Z', lastSampledAt: '2026-08-28T16:45:00.000Z',
  usage: { usedVcpus: 12, usedRamMb: 49152, usedStorageMb: 614400, usedVms: 6, usedSnapshots: 14, usedBackups: 42 },
}
const DELETED_SAMPLES = Math.round((Date.parse(DELETED_VDC.lastSampledAt) - Date.parse(DELETED_VDC.firstSampledAt)) / SAMPLE_MS) + 1

const BUCKET_STEP_MS: Record<string, number> = { sample: SAMPLE_MS, hour: 3600000, day: 6 * 3600000, month: DAY }

function usageSamples(usage: any, storages: string[], from: number, to: number, step: number, seed: number): UsageSampleRow[] {
  const rows: UsageSampleRow[] = []
  const now = Date.now()

  for (let t = Math.ceil(from / step) * step; t < to && t <= now; t += step) {
    const daysAgo = (now - t) / DAY
    // Slow growth toward today, a diurnal swing and a small per-vDC wobble.
    const growth = Math.max(0.55, 1 - daysAgo / 900)
    const diurnal = 1 + 0.06 * Math.sin(((t / 3600000 + seed) / 24) * 2 * Math.PI)
    const f = growth * diurnal
    const storageMb = Math.round(usage.usedStorageMb * growth)
    const primary = storages.find(s => !s.startsWith('pbs:')) ?? 'ceph-block'

    rows.push({
      sampledAt: new Date(t),
      usedVcpus: Math.round(usage.usedVcpus * f),
      usedRamMb: Math.round(usage.usedRamMb * f),
      usedStorageMb: storageMb,
      usedVms: Math.round(usage.usedVms * growth),
      usedSnapshots: Math.round(usage.usedSnapshots * f),
      usedBackups: Math.round(usage.usedBackups * growth),
      usedStorageByStorage: { [primary]: storageMb },
    })
  }

  return rows
}

// Shape of usageHistoryResponse() ({ data: UsageHistoryPayload }), read by VdcUsageHistoryChart.
function usageHistory(vdcId: string, url: URL) {
  const vdc = vdcOf(vdcId)
  const deleted = !vdc && vdcId === DELETED_VDC.vdcId

  if (!vdc && !deleted) return null
  if (url.searchParams.get('format') === 'csv') return null
  const end = Date.parse(url.searchParams.get('to') ?? '') || Date.now()
  const start = Date.parse(url.searchParams.get('from') ?? '') || end - DAY
  const rawBucket = url.searchParams.get('bucket')
  const span = end - start
  const bucket = (rawBucket && (USAGE_BUCKETS as readonly string[]).includes(rawBucket)
    ? rawBucket
    : span <= 2 * DAY ? 'sample' : span <= 14 * DAY ? 'hour' : span <= 92 * DAY ? 'day' : 'month') as UsageBucket
  const seed = VDC_IDS.indexOf(vdcId) * 5
  const lastSampledAt = deleted ? DELETED_VDC.lastSampledAt : new Date(Date.now() - (Date.now() % SAMPLE_MS)).toISOString()
  const cappedEnd = deleted ? Math.min(end, Date.parse(DELETED_VDC.lastSampledAt) + 1) : end
  const cappedStart = deleted ? Math.max(start, Date.parse(DELETED_VDC.firstSampledAt)) : start
  const rows = usageSamples(deleted ? DELETED_VDC.usage : vdc.usage, deleted ? ['ceph-block'] : vdc.storages, cappedStart, cappedEnd, BUCKET_STEP_MS[bucket], seed)

  return {
    data: {
      vdcId,
      vdcName: deleted ? DELETED_VDC.vdcName : vdc.name,
      from: new Date(start).toISOString(),
      to: new Date(end).toISOString(),
      bucket,
      deleted,
      ...HISTORY_SETTINGS,
      lastSampledAt,
      periods: aggregateUsage(rows, bucket),
    },
  }
}

// Shape of GET /vdcs/[id]/green (tenant view, no cost), read by MyGreenCard.
function vdcGreen(vdc: any) {
  const pue = 1.4
  const co2Factor = vdc.nodes.some((n: string) => n === 'pve-node-04' || n === 'pve-node-05') ? 0.338 : 0.052
  const vcpus = vdc.usage.usedVcpus
  const ramGb = vdc.usage.usedRamMb / 1024
  const watts = Math.round((vcpus * 10 * 0.35 + ramGb * 0.375) * pue)
  const maxWatts = Math.round((vcpus * 10 + ramGb * 0.375) * pue)
  const yearlyKwh = Math.round((watts * 8760) / 1000)
  const yearlyCo2 = Math.round(yearlyKwh * co2Factor)
  const running = Math.max(1, vdc.usage.usedVms - 3)

  return {
    data: {
      power: { current: watts, max: maxWatts, monthly: Math.round(yearlyKwh / 12), yearly: yearlyKwh },
      co2: {
        hourly: Math.round(((watts / 1000) * co2Factor) * 1000) / 1000,
        daily: Math.round(((watts * 24) / 1000) * co2Factor * 100) / 100,
        monthly: Math.round((yearlyCo2 / 12) * 10) / 10,
        yearly: yearlyCo2,
        factor: co2Factor,
        equivalentKmCar: Math.round(yearlyCo2 / 0.193),
        equivalentTrees: Math.round(yearlyCo2 / 25),
      },
      efficiency: { pue, vmPerKw: Math.round((running / Math.max(watts / 1000, 0.1)) * 10) / 10, score: co2Factor < 0.1 ? 84 : 66 },
    },
    configured: true,
    vmCount: vdc.usage.usedVms,
    runningVmCount: running,
  }
}

const findVnet = (vdcId: string, name: string) => vnetsOf(vdcId).find(v => v.displayName === name || v.pveName === name) ?? null

const ipParts = (cidr: string) => {
  const [net, prefix] = cidr.split('/')

  return { base: net.split('.').slice(0, 3).join('.'), prefix: Number(prefix) }
}

const demoMac = (seed: number) =>
  `BC:24:11:${[seed >> 16, seed >> 8, seed].map(b => (b & 0xff).toString(16).toUpperCase().padStart(2, '0')).join(':')}`

// Shape of GET /vdcs/[id]/vnets/[name]/ipam, read by TenantVnetDetailPanel.
function vnetIpam(vdc: any, vnet: any) {
  const { base } = ipParts(vnet.subnet.cidr)
  const guests = vdcGuests(vdc.id)
  const used = Math.min(vnet.ipamUsage?.used ?? guests.length, 24)
  const tag = Number(vnet.tag) || 1

  return {
    data: {
      connectionId: vdc.connectionId,
      subnetId: vnet.subnet.id,
      cidr: vnet.subnet.cidr,
      gateway: vnet.subnet.gateway,
      usable: vnet.ipamUsage?.usable ?? 253,
      used,
      allocations: Array.from({ length: used }, (_, i) => {
        const g = guests[i % Math.max(guests.length, 1)]
        const vmid = g ? g.vmid : null

        return {
          id: `demo-ipam-${vnet.id}-${i + 1}`,
          ip: `${base}.${i + 10}`,
          mac: demoMac(tag * 256 + i),
          vmid: i < guests.length ? vmid : null,
          hostname: i < guests.length ? g.name : `reserved-${i + 1}`,
          createdAt: isoDaysAgo(120 - i * 3),
          vm: i < guests.length && g ? { name: g.name, node: g.node, status: g.status, type: 'qemu' } : null,
        }
      }),
    },
  }
}

// Shape of GET /vdcs/[id]/vnets/[name]/ipam/next-free, read by DeployWizard.
function vnetNextFree(vnet: any) {
  const { base, prefix } = ipParts(vnet.subnet.cidr)
  const used = Math.min(vnet.ipamUsage?.used ?? 0, 24)

  return {
    data: {
      ip: `${base}.${used + 10}`,
      cidr: vnet.subnet.cidr,
      prefix,
      gateway: vnet.subnet.gateway,
      dnsServers: vnet.subnet.dnsServers ?? [],
      suggestedMac: demoMac((Number(vnet.tag) || 1) * 256 + 200),
    },
  }
}

// ---------------------------------------------------------------------------
// Security: sessions, audit retention, compliance
// ---------------------------------------------------------------------------

const SESSION_ROWS: Array<[string, string, string, string, string, string, number, number]> = [
  // userId, email, tenant, ip, browser, os, created hours ago, last seen minutes ago
  ['demo-user-001', 'admin@demo.proxcenter.io', 'ProxCenter Demo MSP', '203.0.113.24', 'Chrome', 'macOS', 3, 0],
  ['demo-user-002', 'alice@demo.proxcenter.io', 'ProxCenter Demo MSP', '198.51.100.14', 'Firefox', 'Linux', 6, 4],
  ['demo-user-001', 'admin@demo.proxcenter.io', 'ProxCenter Demo MSP', '203.0.113.88', 'Safari', 'iOS', 27, 95],
  ['demo-user-003', 'bob@acme.example', 'Acme Corporation', '192.0.2.41', 'Edge', 'Windows', 2, 11],
  ['demo-user-005', 'dave@globex.example', 'Globex SAS', '192.0.2.130', 'Chrome', 'Windows', 9, 37],
  ['demo-user-007', 'frank@initech.example', 'Initech', '198.51.100.201', 'Firefox', 'Windows', 30, 210],
]

// Ids, names, categories, severities and statuses of the demo hardening report
// (GET /compliance/hardening/<id>), so the framework view agrees with it.
const HARDENING: Array<[string, string, string, string, string, string?]> = [
  ['cluster_fw_enabled', 'Cluster firewall enabled', 'cluster', 'high', 'pass'],
  ['cluster_policy_in', 'Inbound policy = DROP', 'cluster', 'high', 'pass'],
  ['cluster_policy_out', 'Outbound policy = DROP', 'cluster', 'medium', 'fail', 'Datacenter outbound policy is ACCEPT on both clusters'],
  ['pve_version', 'PVE version up to date', 'cluster', 'medium', 'pass'],
  ['backup_schedule', 'Backup jobs configured', 'cluster', 'high', 'pass'],
  ['ha_enabled', 'High availability configured', 'cluster', 'medium', 'warning', '11 of 24 protected guests are in the HA manager'],
  ['storage_replication', 'Storage replication configured', 'cluster', 'medium', 'pass'],
  ['pool_isolation', 'Resource pool isolation', 'cluster', 'medium', 'pass'],
  ['node_subscriptions', 'Valid subscriptions', 'node', 'medium', 'fail', '2 of 12 nodes have no active subscription'],
  ['apt_repo_consistency', 'APT repository consistency', 'node', 'low', 'pass'],
  ['tls_certificates', 'Valid TLS certificates', 'node', 'high', 'warning', '3 nodes still serve the self-signed PVE certificate'],
  ['node_firewalls', 'Node firewalls enabled', 'node', 'medium', 'pass'],
  ['node_firewall_logging', 'Firewall logging enabled', 'node', 'low', 'pass'],
  ['root_tfa', 'TFA for root@pam', 'access', 'critical', 'fail', 'root@pam has no TOTP factor enrolled'],
  ['admins_tfa', 'TFA for admin users', 'access', 'high', 'pass'],
  ['no_default_tokens', 'No default API tokens', 'access', 'medium', 'pass'],
  ['least_privilege_users', 'Least privilege access', 'access', 'medium', 'pass'],
  ['vm_firewalls', 'Firewall on all VMs', 'vm', 'high', 'pass'],
  ['vm_security_groups', 'VMs have security groups', 'vm', 'medium', 'pass'],
  ['vm_vlan_isolation', 'VMs use VLAN isolation', 'vm', 'high', 'pass'],
  ['vm_guest_agent', 'QEMU guest agent enabled', 'vm', 'low', 'warning', 'QEMU guest agent missing on 22 guests'],
  ['vm_secure_boot', 'UEFI boot enabled', 'vm', 'medium', 'fail', '38 guests still boot in SeaBIOS without secure boot'],
  ['vm_no_usb_passthrough', 'No USB/PCI passthrough', 'vm', 'high', 'pass'],
  ['vm_cpu_isolation', 'CPU type isolation', 'vm', 'medium', 'pass'],
  ['vm_ip_filter', 'VM IP filter enabled', 'vm', 'high', 'pass'],
  ['os_kernel_modules', 'Dangerous kernel modules disabled', 'os', 'medium', 'pass'],
  ['os_coredumps_disabled', 'Core dumps disabled', 'os', 'medium', 'pass'],
  ['os_mount_options', 'Secure mount options on /dev/shm, /tmp', 'os', 'medium', 'pass'],
  ['os_auto_updates', 'Automatic security updates', 'os', 'medium', 'fail', 'unattended-upgrades is not installed on 4 nodes'],
  ['os_cpu_microcode', 'CPU microcode installed', 'os', 'low', 'pass'],
  ['os_disk_encryption', 'Disk encryption (LUKS/ZFS)', 'os', 'low', 'warning', 'LUKS on the data pool, OS disks left in the clear'],
  ['os_sysctl_hardening', 'Kernel security parameters', 'os', 'medium', 'pass'],
  ['access_pam_faillock', 'Account lockout (PAM faillock)', 'os', 'medium', 'pass'],
  ['access_password_aging', 'Password aging policy', 'os', 'medium', 'pass'],
  ['access_pw_quality', 'Password quality enforcement', 'os', 'medium', 'pass'],
  ['access_shell_timeout', 'Shell idle timeout (TMOUT)', 'os', 'low', 'warning', 'TMOUT set on 9 of 12 nodes'],
  ['access_login_banner', 'Login warning banner', 'os', 'low', 'pass'],
  ['ssh_strong_ciphers', 'SSH strong ciphers only', 'ssh', 'high', 'pass'],
  ['ssh_strong_kex', 'SSH strong key exchange', 'ssh', 'high', 'pass'],
  ['ssh_strong_macs', 'SSH strong MACs', 'ssh', 'medium', 'pass'],
  ['ssh_root_login', 'SSH root login restricted', 'ssh', 'high', 'pass'],
  ['ssh_max_auth_tries', 'SSH MaxAuthTries <= 4', 'ssh', 'medium', 'fail', 'MaxAuthTries is 6 on every node, recommended 4'],
  ['ssh_empty_passwords', 'SSH empty passwords disabled', 'ssh', 'critical', 'pass'],
  ['ssh_idle_timeout', 'SSH idle timeout configured', 'ssh', 'medium', 'pass'],
  ['ssh_file_perms', 'SSH file permissions', 'ssh', 'high', 'pass'],
  ['net_ip_forward', 'IP forwarding disabled', 'network', 'medium', 'pass'],
  ['net_icmp_redirects', 'ICMP redirects disabled', 'network', 'medium', 'pass'],
  ['net_source_routing', 'Source routing disabled', 'network', 'medium', 'pass'],
  ['net_syn_cookies', 'TCP SYN cookies enabled', 'network', 'medium', 'pass'],
  ['net_rp_filter', 'Reverse path filtering enabled', 'network', 'medium', 'pass'],
  ['svc_unnecessary_disabled', 'Unnecessary services disabled', 'services', 'low', 'pass'],
  ['svc_apparmor', 'AppArmor enabled', 'services', 'medium', 'pass'],
  ['svc_auditd', 'Audit daemon installed and running', 'services', 'medium', 'warning', 'auditd installed everywhere, stopped on pve-node-11'],
  ['svc_ntp_sync', 'NTP time synchronization', 'services', 'medium', 'pass'],
  ['svc_fail2ban', 'Fail2Ban installed and running', 'services', 'medium', 'fail', 'Fail2Ban is not installed on any node'],
  ['fs_permissions', 'Critical file permissions', 'filesystem', 'high', 'pass'],
  ['fs_suid_audit', 'SUID/SGID files audit', 'filesystem', 'medium', 'warning', '2 unexpected SUID binaries under /usr/local/bin'],
  ['fs_world_writable', 'No world-writable files', 'filesystem', 'medium', 'pass'],
  ['fs_integrity', 'File integrity monitoring', 'filesystem', 'medium', 'fail', 'No AIDE or Tripwire database found'],
  ['log_journald_persistent', 'Journald persistent storage', 'logging', 'medium', 'pass'],
  ['log_syslog_forwarding', 'Syslog remote forwarding', 'logging', 'medium', 'fail', 'No remote syslog target configured'],
  ['log_file_permissions', 'Log file permissions', 'logging', 'low', 'pass'],
]

const CLUSTER_CATEGORIES = new Set(['cluster', 'access', 'vm'])

const hardeningChecks = (connId: string) =>
  HARDENING.map(([id, name, category, severity, status, details], i) => {
    // The DR cluster is a notch behind production, as in the hardening report.
    const degraded = connId === DR && i % 6 === 5

    return {
      id, name, category, severity,
      status: degraded ? 'fail' : status,
      details: degraded ? 'Not applied on the DR cluster' : details ?? 'Compliant on every node checked',
    }
  }) as HardeningCheck[]

// Shape of GET /compliance/frameworks ({ data: assessments, nodes }), read by useFrameworkAssessments.
function frameworkAssessments(connId: string) {
  const nodes = nodesOf(connId)

  if (!nodes) return null
  const checks = hardeningChecks(connId)
  const nodeChecks = checks.filter(c => !CLUSTER_CATEGORIES.has(c.category))

  return {
    data: FRAMEWORKS.map(def => assessFramework(checks, def, getCrosswalk(def.id))),
    nodes: nodes.map((n, ni) => ({
      node: n.node,
      checks: nodeChecks.map((c, ci) => ({
        id: c.id, name: c.name, category: c.category, severity: c.severity,
        status: c.status === 'pass' || (ni + ci) % 3 === 0 ? c.status : 'pass',
        details: c.status === 'pass' || (ni + ci) % 3 === 0 ? c.details : 'Compliant',
      })),
    })),
  }
}

// GET /compliance/profiles/[id] for the profile of the list mock: snake_case, integer booleans.
const COMPLIANCE_PROFILE = {
  id: 'prof-001',
  name: 'CIS Proxmox Benchmark',
  description: 'CIS compliance profile',
  framework_id: 'cis-controls-v8-1',
  is_active: 1,
  connection_id: null,
  created_by: 'demo-user-001',
  created_at: '2026-02-10T10:00:00.000Z',
  updated_at: '2026-03-10T14:30:00.000Z',
  checks: HARDENING.slice(0, 25).map(([id, , category, severity], i) => ({
    id: `prof-001-chk-${i + 1}`,
    profile_id: 'prof-001',
    check_id: id,
    enabled: 1,
    weight: severity === 'critical' ? 2 : severity === 'high' ? 1.5 : 1,
    control_ref: `CIS ${Math.floor(i / 5) + 1}.${(i % 5) + 1}`,
    category,
  })),
}

// ---------------------------------------------------------------------------
// Tenant networks (stretched VNIs, #901)
// ---------------------------------------------------------------------------

const vdcMember = (vdcId: string, pveName: string) => {
  const v = vdcOf(vdcId)

  return { vdcId, vdcName: v.name, connectionId: v.connectionId, connectionName: 'Production Cluster', pveName, zoneName: v.sdnZoneName }
}

const TENANT_NETWORKS = [
  {
    id: 'demo-tnet-acme-backbone', tenantId: 'demo-tenant-acme', tenantName: 'Acme Corporation', name: 'Acme backbone',
    description: 'Layer 2 domain shared by the Acme production and DR sites', pveName: 'tn1a2b3c', vni: 20100, mtu: 1450,
    subnet: { id: 'demo-tnet-acme-backbone-subnet', cidr: '10.200.0.0/22', gateway: '10.200.0.1', dnsServers: ['10.200.0.10', '1.1.1.1'], ipamEnabled: true },
    members: [vdcMember('demo-vdc-acme-prod', 'tn1a2b3c')],
    createdBy: 'demo-user-001', createdAt: '2026-05-04T09:30:00.000Z', updatedAt: '2026-08-21T14:02:00.000Z',
  },
  {
    id: 'demo-tnet-globex-services', tenantId: 'demo-tenant-globex', tenantName: 'Globex SAS', name: 'Shared services',
    description: 'Directory, DNS and monitoring reachable from every Globex vDC', pveName: 'tn4d5e6f', vni: 20200, mtu: null,
    subnet: { id: 'demo-tnet-globex-services-subnet', cidr: '10.210.8.0/24', gateway: '10.210.8.1', dnsServers: ['10.210.8.53'], ipamEnabled: true },
    members: [vdcMember('demo-vdc-globex-prod', 'tn4d5e6f')],
    createdBy: 'demo-user-002', createdAt: '2026-06-18T13:00:00.000Z', updatedAt: '2026-06-18T13:00:00.000Z',
  },
  {
    id: 'demo-tnet-initech-lab', tenantId: 'demo-tenant-initech', tenantName: 'Initech', name: 'Lab interconnect',
    description: 'Reserved for the upcoming Initech lab vDC', pveName: 'tn7a8b9c', vni: 20300, mtu: 1400,
    subnet: null,
    members: [],
    createdBy: 'demo-user-002', createdAt: '2026-09-02T08:15:00.000Z', updatedAt: '2026-09-02T08:15:00.000Z',
  },
]

// ---------------------------------------------------------------------------
// Users, tenants, assignments, API tokens
// ---------------------------------------------------------------------------

const USERS: any[] = MD['/api/v1/users']?.data ?? []
const ASSIGNMENTS: any[] = MD['/api/v1/rbac/assignments']?.data ?? []

// Same rows as GET /tenants (EXTRA_MOCKS), for the detail route.
const TENANTS = [
  { id: 'default', slug: 'default', name: 'ProxCenter Demo MSP', description: 'Provider workspace, manages every tenant.', enabled: true, settings: null, operatingModel: 'msp', vmidRangeStart: null, vmidRangeEnd: null, createdBy: null, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'demo-tenant-acme', slug: 'acme', name: 'Acme Corporation', description: 'Customer with prod + DR vDCs.', enabled: true, settings: null, operatingModel: 'iaas', vmidRangeStart: 1000, vmidRangeEnd: 1999, createdBy: 'demo-user-001', createdAt: '2026-02-03T09:12:00.000Z', updatedAt: '2026-08-21T14:02:00.000Z' },
  { id: 'demo-tenant-globex', slug: 'globex', name: 'Globex SAS', description: 'Customer with a single production vDC.', enabled: true, settings: null, operatingModel: 'iaas', vmidRangeStart: 2000, vmidRangeEnd: 2999, createdBy: 'demo-user-001', createdAt: '2026-03-17T10:40:00.000Z', updatedAt: '2026-08-19T11:25:00.000Z' },
  { id: 'demo-tenant-initech', slug: 'initech', name: 'Initech', description: 'Customer with a single production vDC.', enabled: true, settings: null, operatingModel: 'iaas', vmidRangeStart: 3000, vmidRangeEnd: 3999, createdBy: 'demo-user-001', createdAt: '2026-04-02T15:05:00.000Z', updatedAt: '2026-09-01T08:47:00.000Z' },
]

// Shape of getTenantUsers(), read by TenantsTab and the VdcTab users column.
function tenantUsers(tenantId: string) {
  return USERS.filter(u => (u.tenants ?? []).some((t: any) => t.id === tenantId)).map(u => {
    const roles = ASSIGNMENTS
      .filter(a => a.user.id === u.id && (a.scope_target ?? 'default') === tenantId)
      .map(a => ({ id: a.role.id, name: a.role.name, is_system: !!a.role.is_system }))

    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      enabled: u.enabled,
      is_default: !!u.tenants.find((t: any) => t.id === tenantId)?.isDefault,
      is_super_admin: !!u.is_super_admin,
      rbac_roles: roles,
      joined_at: u.created_at,
    }
  })
}

const assignmentDetail = (a: any) => {
  const tenantId = a.scope_target ?? 'default'

  return {
    id: a.id,
    user_id: a.user.id,
    role_id: a.role.id,
    scope_type: a.scope_type,
    scope_target: a.scope_target,
    tenant_id: tenantId,
    granted_by: a.granted_by_email === 'admin@demo.proxcenter.io' ? 'demo-user-001' : null,
    granted_at: a.granted_at,
    expires_at: a.expires_at,
    user_email: a.user.email,
    user_name: a.user.name,
    role_name: a.role.name,
    role_color: a.role.color,
    granted_by_email: a.granted_by_email,
  }
}

const userDetail = (u: any) => ({
  id: u.id, email: u.email, name: u.name, role: u.role, auth_provider: u.auth_provider, enabled: u.enabled,
  last_login_at: u.last_login_at, created_at: u.created_at, updated_at: u.updated_at,
})

const tenantName = (id: string) => TENANTS.find(t => t.id === id)?.name ?? id

// Settings > API tokens rows (TOKEN_VIEW_SELECT): only the prefix is ever shown, never the secret.
const API_TOKENS = [
  { id: 'demo-tok-terraform', tenantId: 'default', name: 'Terraform CI', description: 'Provisioning pipeline of the platform team', tokenPrefix: 'pxc_00000001', scopes: ['vms:read', 'vms:write', 'vms:power', 'network:write', 'storage:read', 'pools:write'], connectionIds: [PROD], expiresAt: '2027-03-31T00:00:00.000Z', revokedAt: null, lastUsedDaysAgo: 0, lastUsedIp: '10.10.0.21', rateLimitPerMin: 120, writeRateLimitPerMin: 30, createdByUserId: 'demo-user-002', createdByEmail: 'alice@demo.proxcenter.io', createdAt: '2026-04-14T09:20:00.000Z' },
  { id: 'demo-tok-grafana', tenantId: 'default', name: 'Grafana exporter', description: 'Read-only metrics scrape', tokenPrefix: 'pxc_00000002', scopes: ['vms:read', 'nodes:read', 'storage:read', 'alerts:read'], connectionIds: null, expiresAt: null, revokedAt: null, lastUsedDaysAgo: 0, lastUsedIp: '10.42.0.11', rateLimitPerMin: 300, writeRateLimitPerMin: 0, createdByUserId: 'demo-user-001', createdByEmail: 'admin@demo.proxcenter.io', createdAt: '2026-02-02T15:00:00.000Z' },
  { id: 'demo-tok-acme-backup', tenantId: 'demo-tenant-acme', name: 'Acme backup orchestrator', description: 'Nightly restore tests run by Acme', tokenPrefix: 'pxc_00000003', scopes: ['backups:read', 'backups:write', 'backups:restore', 'vms:read'], connectionIds: [PROD], expiresAt: '2026-12-31T00:00:00.000Z', revokedAt: null, lastUsedDaysAgo: 1, lastUsedIp: '192.0.2.41', rateLimitPerMin: 60, writeRateLimitPerMin: 10, createdByUserId: 'demo-user-003', createdByEmail: 'bob@acme.example', createdAt: '2026-05-20T08:45:00.000Z' },
  { id: 'demo-tok-globex-ansible', tenantId: 'demo-tenant-globex', name: 'Globex Ansible', description: null, tokenPrefix: 'pxc_00000004', scopes: ['vms:read', 'vms:power', 'vms:snapshot'], connectionIds: null, expiresAt: '2027-01-15T00:00:00.000Z', revokedAt: null, lastUsedDaysAgo: 3, lastUsedIp: '192.0.2.130', rateLimitPerMin: 60, writeRateLimitPerMin: 20, createdByUserId: 'demo-user-005', createdByEmail: 'dave@globex.example', createdAt: '2026-06-03T13:10:00.000Z' },
  { id: 'demo-tok-legacy', tenantId: 'default', name: 'Legacy monitoring', description: 'Replaced by the Grafana exporter', tokenPrefix: 'pxc_00000005', scopes: ['vms:read', 'nodes:read'], connectionIds: null, expiresAt: null, revokedAt: '2026-07-01T10:00:00.000Z', lastUsedDaysAgo: 121, lastUsedIp: '10.42.0.9', rateLimitPerMin: 60, writeRateLimitPerMin: 0, createdByUserId: 'demo-user-001', createdByEmail: 'admin@demo.proxcenter.io', createdAt: '2026-01-12T10:00:00.000Z' },
]

const lastUsedAt = (daysAgo: number) => {
  const now = Date.now() - (Date.now() % 60000)

  return new Date(now - (daysAgo === 0 ? 7 * 60000 : daysAgo * DAY)).toISOString()
}

// ---------------------------------------------------------------------------
// Settings tabs: TLS, SSH, broadcast, templates
// ---------------------------------------------------------------------------

const TLS_CERTS = [
  { id: 'demo-tls-le-3', source: 'acme', commonName: 'demo.proxcenter.io', sanNames: ['demo.proxcenter.io', 'console.demo.proxcenter.io'], issuer: "C=US, O=Let's Encrypt, CN=R11", serial: '04A1F3C9B27E5D8806F1C2A9D3E47B10', fingerprint: 'AB:3F:91:0C:5E:77:D2:48:19:A6:CB:E0:62:F4:8D:13:57:9A:2E:C1:B8:64:07:FD:3A:9E:11:C5:72:D8:4B:E6', notBefore: '2026-09-12T03:14:00.000Z', notAfter: '2026-12-11T03:13:59.000Z', isActive: true, createdAt: '2026-09-12T03:15:02.000Z' },
  { id: 'demo-tls-le-2', source: 'acme', commonName: 'demo.proxcenter.io', sanNames: ['demo.proxcenter.io', 'console.demo.proxcenter.io'], issuer: "C=US, O=Let's Encrypt, CN=R10", serial: '03F77A0D41C9B2E65810D7C3A9F2E08B', fingerprint: '5C:E2:08:A7:13:9F:44:B6:D1:2A:7E:C8:90:3B:F5:61:0D:A4:E9:27:8C:B3:16:5F:D0:72:AE:49:C3:1B:86:F0', notBefore: '2026-06-14T03:11:00.000Z', notAfter: '2026-09-12T03:10:59.000Z', isActive: false, createdAt: '2026-06-14T03:12:10.000Z' },
  { id: 'demo-tls-self', source: 'self_signed', commonName: 'proxcenter.local', sanNames: ['proxcenter.local'], issuer: 'CN=ProxCenter self-signed', serial: '01', fingerprint: 'E1:7D:4A:92:C0:3B:F8:65:21:9E:AD:07:B4:58:6C:F3:12:8A:D9:40:E7:35:BC:6F:01:A8:93:2D:C4:5E:7B:96', notBefore: '2026-01-01T00:00:00.000Z', notAfter: '2027-01-01T00:00:00.000Z', isActive: false, createdAt: '2026-01-01T00:00:05.000Z' },
]

const TLS_SETTINGS = {
  ...DEFAULT_TLS_SETTINGS,
  enabled: true,
  redirectHttp: true,
  minVersion: 'TLSv1.2',
  source: 'acme',
  hsts: { enabled: true, maxAge: 31536000, includeSubDomains: false, preload: false },
  acme: { ...DEFAULT_TLS_SETTINGS.acme, email: 'ops@demo.proxcenter.io', domains: ['demo.proxcenter.io', 'console.demo.proxcenter.io'] },
  order: { status: 'ok', step: 'done', startedAt: '2026-09-12T03:14:00.000Z', finishedAt: '2026-09-12T03:15:02.000Z', message: 'Certificate issued and activated' },
}

const cmd = (prefix: string, executablePath: string | undefined, category: string, description: string, usedBy: string) =>
  ({ prefix, ...(executablePath ? { executablePath } : {}), category, description, usedBy })

// Orchestrator allowlist (AllowlistCard, SecurityRecommendationsCard): `{ categories }`.
const SSH_ALLOWLIST = {
  categories: [
    { id: 'metrics', label: 'Metrics and inventory', description: 'Read-only probes run by the dashboards', commands: [
      cmd('cat /proc/pressure/', '/usr/bin/cat', 'metrics', 'Read CPU, memory and IO pressure', 'Node metrics'),
      cmd('smartctl -a', '/usr/sbin/smartctl', 'metrics', 'Disk health (SMART attributes)', 'Disk health'),
      cmd('lsblk -J', '/usr/bin/lsblk', 'metrics', 'Block device layout', 'Inventory, storage'),
      cmd('dmidecode -t', '/usr/sbin/dmidecode', 'metrics', 'Hardware inventory (BIOS, memory)', 'Inventory'),
    ] },
    { id: 'ceph', label: 'Ceph', description: 'Cluster flags and health', commands: [
      cmd('ceph osd set noout', '/usr/bin/ceph', 'ceph', 'Set noout before a node maintenance', 'Rolling updates, maintenance'),
      cmd('ceph osd unset noout', '/usr/bin/ceph', 'ceph', 'Clear noout after the maintenance', 'Rolling updates, maintenance'),
      cmd('ceph health detail -f json', '/usr/bin/ceph', 'ceph', 'Detailed health report', 'Ceph dashboard'),
    ] },
    { id: 'updates', label: 'Updates', description: 'Package updates during a rolling update', commands: [
      cmd('apt-get update', '/usr/bin/apt-get', 'updates', 'Refresh the package index', 'Rolling updates'),
      cmd('apt-get -y dist-upgrade', '/usr/bin/apt-get', 'updates', 'Apply the pending upgrades', 'Rolling updates'),
      cmd('needrestart -b', '/usr/sbin/needrestart', 'updates', 'Detect a pending reboot', 'Rolling updates'),
    ] },
    { id: 'migration', label: 'Migration', description: 'Disk conversion during VMware and Hyper-V imports', commands: [
      cmd('qemu-img convert', '/usr/bin/qemu-img', 'migration', 'Convert a source disk to raw or qcow2', 'Migrations'),
      cmd('virt-v2v', '/usr/bin/virt-v2v', 'migration', 'Inject virtio drivers into the guest', 'Migrations'),
      cmd('nbdkit vddk', undefined, 'migration', 'Stream a VMware disk over NBD', 'Warm migrations'),
    ] },
  ],
}

// Host keys pinned at first contact (HostKeysCard): `{ hosts, orchestratorUnavailable }`.
const SSH_HOST_KEYS = {
  hosts: [
    ...PROD_NODES.map((n, i) => ({ host: n.ip, keyTypes: ['ssh-ed25519'], pinnedAt: new Date(Date.parse('2026-03-03T12:10:00.000Z') + i * 60000).toISOString(), sources: ['frontend', 'orchestrator'] })),
    ...DR_NODES.map((n, i) => ({ host: n.ip, keyTypes: ['ecdsa-sha2-nistp256', 'ssh-ed25519'], pinnedAt: new Date(Date.parse('2026-02-15T10:05:00.000Z') + i * 60000).toISOString(), sources: ['orchestrator'] })),
  ].sort((a, b) => a.host.localeCompare(b.host, undefined, { numeric: true })),
  orchestratorUnavailable: false,
}

// Admin list of banners (BroadcastTab). None is live, matching GET /broadcasts/active.
function broadcasts() {
  const today = Date.now() - (Date.now() % DAY)
  const at = (days: number, hour: number) => new Date(today + days * DAY + hour * 3600000).toISOString()

  return [
    { id: 'demo-bc-maintenance', message: 'Planned maintenance on the Paris North 1 storage network, Saturday 22:00 to 02:00 UTC. Running guests are not affected.', bgColor: '#f59e0b', fgColor: '#111827', dismissible: true, enabled: true, startsAt: at(9, 8), endsAt: at(11, 2), targetKind: 'all', targetIds: [], createdBy: 'demo-user-002', createdAt: at(-2, 10), updatedAt: at(-2, 10) },
    { id: 'demo-bc-acme', message: 'Your DR test is scheduled for next Tuesday, replicas will be started in an isolated network.', bgColor: '#2563eb', fgColor: '#ffffff', dismissible: true, enabled: true, startsAt: at(5, 7), endsAt: at(7, 18), targetKind: 'tenants', targetIds: ['demo-tenant-acme'], createdBy: 'demo-user-001', createdAt: at(-1, 15), updatedAt: at(-1, 15) },
    { id: 'demo-bc-upgrade', message: 'ProxCenter was upgraded, see What\'s New for the release notes.', bgColor: '#16a34a', fgColor: '#ffffff', dismissible: true, enabled: false, startsAt: at(-20, 6), endsAt: at(-13, 6), targetKind: 'roles', targetIds: ['role_super_admin', 'role_tenant_admin'], createdBy: 'demo-user-001', createdAt: at(-20, 6), updatedAt: at(-13, 6) },
  ]
}

export const SETTINGS_MOCKS: DemoMockMap = {
  // Per-user appearance lives in the cookie: nothing stored server side for the demo visitor.
  'GET:/api/v1/settings/appearance': { data: {}, stored: false },
  get 'GET:/api/v1/settings/broadcast'() {
    return { data: broadcasts() }
  },
  'GET:/api/v1/settings/guest-file-restore': {
    data: {
      agentEnabled: true, sshEnabled: true, agentMaxBytes: 2 * 2 ** 30, agentParallelWrites: 4, defaultConflict: 'keep',
      restoredPrefix: 'RESTORED-', defaultCustomDirLinux: '~/proxcenter-restore', defaultCustomDirWindows: 'C:\\ProxCenter-Restore',
      sshConnectTimeoutSec: 20, maxConcurrentJobs: 4, jobRetentionDays: 60, spoolDir: '', spoolMinFreeBytes: 4 * 2 ** 30, sourceStallTimeoutSec: 120,
    },
  },
  // LoginBackground: no uploaded image, the stock background stays.
  'GET:/api/v1/settings/login-background': { imageUrl: null },
  'GET:/api/v1/settings/map': { data: { provider: 'osm', lightUrl: '', darkUrl: '', attribution: '' }, canEdit: true },
  // Flat body (normalizeReportTemplate value), read by ReportCustomization.
  'GET:/api/v1/settings/reports-template': {
    pageSize: 'A4', orientation: 'portrait', fontFamily: 'sans', baseFontSize: 10, primaryColor: '#0f766e', showLogo: true,
    coverSubtitle: 'Managed private cloud', coverNote: 'Prepared by the ProxCenter Demo MSP operations team.',
    headerText: '{app}  |  {report}', footerText: 'Confidential, for the named customer only', showPageNumbers: true, customCss: '',
  },
  // TlsTab: the secrets are redacted by the real route, none is configured here.
  'GET:/api/v1/settings/tls': {
    settings: TLS_SETTINGS,
    eabConfigured: false,
    dnsSecretsConfigured: [],
    active: TLS_CERTS[0],
    listener: { listening: true, port: 8443 },
    tlsPort: 8443,
    urlCoherence: { ok: true, issues: [] },
  },
  'GET:/api/v1/settings/tls/certificates': { certificates: TLS_CERTS },
  'GET:/api/v1/ssh/allowlist': SSH_ALLOWLIST,
  'GET:/api/v1/ssh/host-keys': SSH_HOST_KEYS,
  get 'GET:/api/v1/settings/api-tokens'() {
    return {
      data: API_TOKENS.map(({ lastUsedDaysAgo, ...t }) => ({ ...t, tenant: { name: tenantName(t.tenantId) }, lastUsedAt: lastUsedAt(lastUsedDaysAgo) })),
    }
  },
  // The demo visitor is a super admin: every scope is grantable.
  'GET:/api/v1/settings/api-tokens/grantable-scopes': { data: { grantable: [...ALL_SCOPE_IDS] } },
  // Flat orchestrator body (HaCluster). Every Patroni member is running, so the
  // navbar HA badge (NavbarContent haStatus) can only read healthy.
  'GET:/api/v1/ha/cluster': {
    patroni: {
      scope: 'proxcenter',
      members: [
        { name: 'pxc-ha-01', host: '10.10.10.201', role: 'leader', state: 'running', timeline: 4, lagBytes: 0, version: '4.0.4' },
        { name: 'pxc-ha-02', host: '10.10.10.202', role: 'sync_standby', state: 'running', timeline: 4, lagBytes: 0, version: '4.0.4' },
        { name: 'pxc-ha-03', host: '10.10.10.203', role: 'replica', state: 'running', timeline: 4, lagBytes: 1024, version: '4.0.4' },
      ],
      syncMode: 'synchronous',
      paused: false,
    },
    etcd: { healthy: true, members: ['pxc-ha-01', 'pxc-ha-02', 'pxc-ha-03'].map(name => ({ name, healthy: true })) },
    vip: { address: '10.10.10.200', holder: 'pxc-ha-01' },
    services: Object.fromEntries(['pxc-ha-01', 'pxc-ha-02', 'pxc-ha-03'].map(n => [n, Object.fromEntries(
      ['etcd', 'patroni', 'haproxy', 'frontend', 'orchestrator', 'weasyprint', 'keepalived'].map(svc => [svc, 'running']),
    )])),
    history: [
      { timeline: 4, lsn: '0/9A000060', newLeader: 'pxc-ha-01', timestamp: '2026-09-14T02:10:42Z', reason: 'switchover during rolling update' },
      { timeline: 3, lsn: '0/6F0000A0', newLeader: 'pxc-ha-02', timestamp: '2026-07-03T21:44:05Z', reason: 'leader node rebooted' },
    ],
  },
  // LicenseTab reads `imports`: the HA option of /license/status plus the DR cluster's own license.
  'GET:/api/v1/license/imports': {
    imports: [
      {
        id: 'demo-import-ha', license_id: 'PXC-OPT-HA-2026-0042', edition: 'enterprise', max_nodes: 0, cluster_uuid: null,
        expires_at: '2027-12-31T23:59:59.000Z', state: 'active', connection_ids: [], customer: 'ProxCenter Demo MSP',
        type: 'option', capabilities: ['control_plane_ha'],
      },
      {
        id: 'demo-import-dr', license_id: 'PXC-ENT-DR-2026-0117', edition: 'enterprise', max_nodes: 4, cluster_uuid: '3f9c1d2e-7a4b-4c8e-9b0d-5e6f7a8b9c0d',
        expires_at: '2027-06-30T23:59:59.000Z', state: 'active', connection_ids: [DR], customer: 'ProxCenter Demo MSP',
        type: 'edition', capabilities: [],
      },
    ],
  },
  // DatacenterAssignmentTree: direct assignments, as in /admin/datacenters/*/assignments.
  'GET:/api/v1/admin/green-assignments': {
    data: {
      clusters: { [PROD]: { datacenterId: 'demo-dc-paris', datacenterName: 'Paris North 1' } },
      nodes: {
        [`${PROD}|pve-node-04`]: { datacenterId: 'demo-dc-frankfurt', datacenterName: 'Frankfurt East 1' },
        [`${PROD}|pve-node-05`]: { datacenterId: 'demo-dc-frankfurt', datacenterName: 'Frankfurt East 1' },
      },
    },
  },
  get 'GET:/api/v1/admin/sessions'() {
    const now = Date.now() - (Date.now() % 60000)

    return {
      data: SESSION_ROWS.map(([userId, userEmail, tenantName, ipAddress, browser, os, createdH, seenMin], i) => ({
        id: `demo-session-${String(i + 1).padStart(3, '0')}`,
        userId, userEmail, tenantName,
        createdAt: new Date(now - createdH * 3600000).toISOString(),
        lastSeenAt: new Date(now - seenMin * 60000).toISOString(),
        ipAddress, browser, os,
        current: i === 0,
      })),
      truncated: false,
    }
  },
  'GET:/api/v1/audit/retention': { data: { autoCleanup: true, retentionDays: 365 } },
  // federatedSignOut: no IdP end-session redirect from the demo, local sign-out only.
  'GET:/api/v1/auth/oidc/logout-url': { url: null },
  get 'GET:/api/v1/compliance/login-lockouts'() {
    const now = Date.now() - (Date.now() % 300000)

    return {
      data: [
        { kind: 'ip', key: '185.220.101.47', label: '185.220.101.47', failedCount: 25, lastFailedAt: new Date(now - 8 * 60000).toISOString(), lockedUntil: new Date(now + 52 * 60000).toISOString() },
        { kind: 'account', key: 'carol@acme.example', label: 'carol@acme.example', failedCount: 5, lastFailedAt: new Date(now - 3 * 60000).toISOString(), lockedUntil: new Date(now + 12 * 60000).toISOString() },
      ],
    }
  },
  'GET:/api/v1/compliance/profiles/prof-001': { data: COMPLIANCE_PROFILE },
  'GET:/api/v1/admin/vdc-usage-history/deleted': {
    data: [{
      vdcId: DELETED_VDC.vdcId, vdcName: DELETED_VDC.vdcName, tenantId: DELETED_VDC.tenantId, tenantName: DELETED_VDC.tenantName,
      firstSampledAt: DELETED_VDC.firstSampledAt, lastSampledAt: DELETED_VDC.lastSampledAt, samples: DELETED_SAMPLES,
    }],
  },
  // VdcUsageHistorySettings reads `data` and `status`.
  get 'GET:/api/v1/settings/vdc-usage-history'() {
    const now = Date.now()

    return {
      data: HISTORY_SETTINGS,
      status: {
        samples: VDCS.length * Math.round((HISTORY_SETTINGS.retentionDays * DAY) / SAMPLE_MS) + DELETED_SAMPLES,
        lastSampledAt: new Date(now - (now % SAMPLE_MS)).toISOString(),
        samplerActive: true,
      },
    }
  },
}

const ADMIN_CONN_SUB = /^\/api\/v1\/admin\/connections\/([^/]+)\/(available-resources|green-config|node-addresses|provider-bridges|storage-policies)$/
const POLICY_DISKS = /^\/api\/v1\/admin\/connections\/([^/]+)\/storage-policies\/([^/]+)\/disks$/
const ADMIN_VDC_SUB = /^\/api\/v1\/admin\/vdcs\/([^/]+)\/(zone|transport\/provision)$/
const VDC_HISTORY = /^\/api\/v1\/(?:admin\/)?vdcs\/([^/]+)\/usage\/history$/
const VDC_GREEN = /^\/api\/v1\/vdcs\/([^/]+)\/green$/
const VDC_VNET = /^\/api\/v1\/vdcs\/([^/]+)\/vnets\/([^/]+)(\/ipam|\/ipam\/next-free)?$/

export const resolveSettingsMock: DemoMockResolver = (method, cleanPath, url) => {
  if (method !== 'GET') return null

  // A signed request file to download: answer like a disabled action rather than saving `{ data: [] }`.
  if (cleanPath === '/api/v1/license/request') {
    return new Response(JSON.stringify({ error: 'Action disabled in demo mode' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }

  const tenant = cleanPath.match(/^\/api\/v1\/tenants\/([^/]+)(\/users)?$/)

  if (tenant) {
    const row = TENANTS.find(t => t.id === decodeURIComponent(tenant[1]))

    if (!row) return null

    return tenant[2] ? { data: tenantUsers(row.id) } : { data: row }
  }

  const user = cleanPath.match(/^\/api\/v1\/users\/([^/]+)(\/api-tokens)?$/)

  if (user) {
    const row = USERS.find(u => u.id === decodeURIComponent(user[1]))

    if (!row) return null
    if (!user[2]) return { data: userDetail(row) }

    return {
      data: API_TOKENS.filter(t => t.createdByUserId === row.id && !t.revokedAt).map(t => ({
        id: t.id, name: t.name, token_prefix: t.tokenPrefix, tenant_id: t.tenantId, tenant_name: tenantName(t.tenantId),
        scopes: t.scopes, last_used_at: lastUsedAt(t.lastUsedDaysAgo), expires_at: t.expiresAt, created_at: t.createdAt,
      })),
    }
  }

  const asg = cleanPath.match(/^\/api\/v1\/rbac\/assignments\/([^/]+)$/)

  if (asg) {
    const row = ASSIGNMENTS.find(a => a.id === decodeURIComponent(asg[1]))

    return row ? { data: assignmentDetail(row) } : null
  }

  if (cleanPath === '/api/v1/admin/tenant-networks') {
    const tenantId = url.searchParams.get('tenantId')

    return { data: tenantId ? TENANT_NETWORKS.filter(n => n.tenantId === tenantId) : TENANT_NETWORKS }
  }

  const tnet = cleanPath.match(/^\/api\/v1\/admin\/tenant-networks\/([^/]+)$/)

  if (tnet) {
    const network = TENANT_NETWORKS.find(n => n.id === decodeURIComponent(tnet[1]))

    return network ? { data: network } : null
  }

  if (cleanPath === '/api/v1/compliance/frameworks') return frameworkAssessments(url.searchParams.get('connectionId') ?? '')

  if (cleanPath === '/api/v1/admin/connections') {
    const type = url.searchParams.get('type')

    return { data: type ? ADMIN_CONNECTIONS.filter(c => c.type === type) : ADMIN_CONNECTIONS }
  }

  const conn = cleanPath.match(ADMIN_CONN_SUB)

  if (conn) {
    const id = decodeURIComponent(conn[1])

    switch (conn[2]) {
      case 'available-resources': return availableResources(id)
      case 'green-config': return greenConfig(id)
      case 'node-addresses': return nodeAddresses(id)
      case 'provider-bridges': return providerBridges(id, url)
      default: return STORAGE_POLICIES[id] ? { data: STORAGE_POLICIES[id] } : null
    }
  }

  const disks = cleanPath.match(POLICY_DISKS)

  if (disks) return policyDisks(decodeURIComponent(disks[1]), decodeURIComponent(disks[2]))

  const vdcSub = cleanPath.match(ADMIN_VDC_SUB)

  if (vdcSub) {
    const vdc = vdcOf(decodeURIComponent(vdcSub[1]))

    if (!vdc) return null

    return vdcSub[2] === 'zone' ? vdcZone(vdc) : vdcTransport(vdc)
  }

  const history = cleanPath.match(VDC_HISTORY)

  if (history) return usageHistory(decodeURIComponent(history[1]), url)

  const green = cleanPath.match(VDC_GREEN)

  if (green) {
    const vdc = vdcOf(decodeURIComponent(green[1]))

    return vdc ? vdcGreen(vdc) : null
  }

  const vnetMatch = cleanPath.match(VDC_VNET)

  if (vnetMatch) {
    const vdc = vdcOf(decodeURIComponent(vnetMatch[1]))
    const vnet = vdc ? findVnet(vdc.id, decodeURIComponent(vnetMatch[2])) : null

    if (!vnet) return null
    if (!vnetMatch[3]) return { data: vnet }

    return vnetMatch[3] === '/ipam' ? vnetIpam(vdc, vnet) : vnetNextFree(vnet)
  }

  return null
}
