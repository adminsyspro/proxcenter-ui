/**
 * Demo mocks for the inventory screens (/infrastructure/inventory): cluster,
 * node and guest panels, SDN, HA, firewall, CVE, migrations, external sources.
 * See ./index.ts for the contract.
 */

import { parseLogOffset, sliceJobLogs } from '@/lib/migration/jobLogs'

import mockData from '../mock-data.json'

import type { DemoMockMap, DemoMockResolver } from './index'

const MOCK: Record<string, any> = mockData as any
const PROD = 'demo-pve-cluster-001'
const DR = 'demo-pve-dr-001'
const HOUR = 3600
const DAY = 86400

const CONNECTIONS: any[] = MOCK['/api/v1/connections']?.data || []
const PROD_NODES: any[] = MOCK[`/api/v1/connections/${PROD}/nodes`]?.data || []
const PROD_GUESTS: any[] = (MOCK[`/api/v1/connections/${PROD}/resources`]?.data || [])
  .filter((r: any) => r.type === 'qemu' || r.type === 'lxc')

// Guests of the DR cluster: the replicas of the replicated production guests.
const DR_GUESTS: any[] = [
  { vmid: 5100, name: 'web-prod-01-replica', node: 'pve-dr-01', type: 'qemu', status: 'stopped', maxmem: 8589934592, maxdisk: 34359738368, maxcpu: 4 },
  { vmid: 5101, name: 'web-prod-02-replica', node: 'pve-dr-02', type: 'qemu', status: 'stopped', maxmem: 8589934592, maxdisk: 34359738368, maxcpu: 4 },
  { vmid: 5112, name: 'db-mysql-prod-01-replica', node: 'pve-dr-03', type: 'qemu', status: 'stopped', maxmem: 17179869184, maxdisk: 107374182400, maxcpu: 8 },
  { vmid: 5115, name: 'db-pgsql-prod-01-replica', node: 'pve-dr-04', type: 'qemu', status: 'stopped', maxmem: 17179869184, maxdisk: 107374182400, maxcpu: 8 },
  { vmid: 5236, name: 'erp-prod-01-replica', node: 'pve-dr-01', type: 'qemu', status: 'stopped', maxmem: 25769803776, maxdisk: 214748364800, maxcpu: 8 },
]

const hash = (s: string): number => {
  let h = 2166136261

  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.codePointAt(i)!, 16777619)

  return h >>> 0
}

const nowSec = () => Math.floor(Date.now() / 1000)
// Start of the current hour: timestamps stay stable between polls.
const hourBucket = () => nowSec() - (nowSec() % HOUR)

const fingerprintOf = (seed: string): string => {
  const h = hash(seed)
  const bytes = Array.from({ length: 32 }, (_, i) => ((h >>> (i % 24)) + i * 37) & 0xff)

  return bytes.map(b => b.toString(16).toUpperCase().padStart(2, '0')).join(':')
}

const connectionOf = (id: string) => CONNECTIONS.find(c => c.id === id)
const isDr = (connId: string) => connId === DR
const connKey = (connId: string) => (isDr(connId) ? DR : PROD)

function hostsOf(connId: string): { node: string, ip: string }[] {
  return (connectionOf(connKey(connId))?.hosts || []).map((h: any) => ({ node: h.node, ip: h.ip }))
}

function guestsOf(connId: string): any[] {
  return isDr(connId) ? DR_GUESTS : PROD_GUESTS
}

function nodeFingerprint(connId: string, node: string): string {
  return PROD_NODES.find(n => n.node === node)?.ssl_fingerprint || fingerprintOf(`${connId}:${node}`)
}

const clusterNameOf = (connId: string) => (isDr(connId) ? 'pve-dr-gra' : 'pve-prod-par')

// ClusterTabs (cluster > Cluster tab): isCluster, clusterStatus, nodes, joinInfo, networks.
function clusterConfig(connId: string): any {
  const hosts = hostsOf(connId)
  const first = hosts[0]
  const ring = (ip: string) => `172.16.${isDr(connId) ? 20 : 10}.${ip.split('.').pop()}`
  const joinFp = nodeFingerprint(connId, first.node)
  const joinData = { ipAddress: first.ip, fingerprint: joinFp, peerLinks: { 0: ring(first.ip) }, ring_addr: [ring(first.ip)], totem: { cluster_name: clusterNameOf(connId), config_version: hosts.length + 2 } }

  return {
    data: {
      isCluster: true,
      clusterName: clusterNameOf(connId),
      clusterStatus: { version: hosts.length + 2, quorate: true, nodes: hosts.length },
      nodes: hosts.map((h, i) => ({
        name: h.node,
        id: i + 1,
        corosyncIp: ring(h.ip),
        online: true,
        local: i === 0,
        ip: h.ip,
        managementIp: h.ip,
        corosyncLinks: [ring(h.ip)],
        votes: 1,
        maintenance: false,
      })),
      joinInfo: {
        ipAddress: first.ip,
        fingerprint: joinFp,
        corosyncLinks: [ring(first.ip)],
        encoded: Buffer.from(JSON.stringify(joinData)).toString('base64'),
        raw: { preferred_node: first.node, fingerprint: joinFp },
      },
      networks: [
        { iface: 'vmbr0', address: first.ip, cidr: `${first.ip}/24`, type: 'bridge', active: 1, comments: 'Management' },
        { iface: 'bond1', address: ring(first.ip), cidr: `${ring(first.ip)}/24`, type: 'bond', active: 1, comments: 'Corosync / Ceph' },
      ],
    },
  }
}

// hardware/utils fetchResourceMappings: PVE /cluster/mapping/{pci|usb|dir} rows.
function clusterMappings(connId: string, kind: string): any {
  const nodes = hostsOf(connId).map(h => h.node)

  if (kind === 'pci') {
    return {
      data: [{
        id: 'gpu-l40s',
        description: 'NVIDIA L40S for AI workloads',
        map: nodes.slice(0, 2).map(n => `node=${n},path=0000:41:00.0,id=10de:26b9,iommugroup=42,subsystem-id=10de:1851`),
        mdev: 0,
        checks: [],
      }],
    }
  }
  if (kind === 'usb') {
    return {
      data: [{
        id: 'license-dongle',
        description: 'Sentinel HASP license key',
        map: [`node=${nodes[0]},id=0529:0001`],
        checks: [],
      }],
    }
  }
  if (kind === 'dir') {
    return { data: [{ id: 'shared-iso', description: 'virtiofs ISO share', map: nodes.slice(0, 3).map(n => `node=${n},path=/mnt/pve/iso`) }] }
  }

  return { data: [] }
}

const METRIC_SERVERS = [
  { id: 'influx-prod', type: 'influxdb', server: '10.10.10.12', port: 8089, disable: 0, influxdbproto: 'udp', mtu: 1500 },
  { id: 'graphite-legacy', type: 'graphite', server: '10.10.10.13', port: 2003, disable: 1, path: 'proxmox', proto: 'udp' },
]

const NOTIFICATION_TARGETS = [
  { name: 'mail-to-root', type: 'sendmail', 'mailto-user': ['root@pam'], comment: 'Default mail target', origin: 'builtin' },
  { name: 'ops-smtp', type: 'smtp', server: 'smtp.example.com', port: 465, mode: 'tls', 'from-address': 'pve@example.com', mailto: ['ops@example.com'], comment: 'Ops team mailbox' },
  { name: 'gotify-oncall', type: 'gotify', server: 'https://gotify.example.com', comment: 'On-call phone' },
  { name: 'slack-webhook', type: 'webhook', url: 'https://hooks.example.com/services/T000/B000', method: 'post', comment: 'Slack #infra' },
]

const NOTIFICATION_MATCHERS = [
  { name: 'default-matcher', target: ['mail-to-root'], comment: 'Route all notifications to mail-to-root', origin: 'builtin' },
  { name: 'critical-to-oncall', target: ['gotify-oncall', 'slack-webhook'], 'match-severity': ['error'], mode: 'all', comment: 'Errors page the on-call' },
  { name: 'backups-to-ops', target: ['ops-smtp'], 'match-field': ['exact:type=vzdump'], comment: 'Backup reports' },
]

// DiagnosticModal reads the flat DiagnosticReport (no `data` wrapper).
function diagnostics(connId: string): any {
  const conn = connectionOf(connId)
  const type = conn?.type || 'pve'
  const check = (id: string, category: string, label: string, status: string, message: string, detail?: string, durationMs = 40) =>
    ({ id, category, label, status, message, ...(detail && { detail }), durationMs })
  let checks: any[]

  if (type === 'pbs') {
    checks = [
      check('pbs.network', 'network', 'PBS API reachability and version', 'ok', 'Connected to PBS 3.4.1', undefined, 38),
      check('pbs.auth', 'auth', 'PBS API token permissions', 'ok', 'Token can read datastores and tasks.', undefined, 52),
      check('pbs.datastore', 'datastore', 'PBS datastore health', 'ok', 'All datastores below 80% usage.', 'backup-main 61%, ARCHIVE 44%.', 71),
    ]
  } else if (type === 'pve') {
    const hosts = hostsOf(connId)

    checks = [
      check('pve.network', 'network', 'API reachability and version', 'ok', 'Connected to PVE 8.4.1', undefined, 34),
      check('pve.auth', 'auth', 'API token permissions', 'ok', 'Token has read access.', undefined, 61),
      check('pve.cluster', 'cluster', 'Cluster quorum and node health', 'ok', `Cluster "${clusterNameOf(connId)}" is quorate.`, `${hosts.length}/${hosts.length} nodes online.`, 45),
      check('pve.ceph', 'cluster', 'Ceph health', 'ok', 'Ceph is HEALTH_OK.', undefined, 88),
      check('pve.storage', 'storage', 'Cluster storage health', 'ok', 'All storages below 80% usage.', `Total storages: ${isDr(connId) ? 3 : 5}.`, 120),
      conn?.sshEnabled
        ? check('pve.ssh', 'ssh', 'SSH connectivity', 'ok', `SSH to ${hosts[0]?.ip} succeeded.`, undefined, 210)
        : check('pve.ssh', 'ssh', 'SSH connectivity', 'skip', 'SSH is not enabled for this connection.', undefined, 0),
    ]
  } else {
    checks = [check('ext.network', 'network', 'API host reachability', 'ok', `${conn?.baseUrl || 'Host'} answered.`, undefined, 55)]
  }

  const summary = { ok: 0, warn: 0, error: 0, skip: 0 } as Record<string, number>

  for (const c of checks) summary[c.status]++

  return {
    connectionId: connId,
    type,
    checks,
    summary,
    ranAt: new Date(hourBucket() * 1000).toISOString(),
    durationMs: checks.reduce((s, c) => s + c.durationMs, 0),
  }
}

function fingerprint(connId: string): any {
  const conn = connectionOf(connId)
  const url = new URL(conn?.baseUrl || 'https://10.10.10.1:8006')
  const host = url.hostname
  const port = url.port || '8006'
  const first = hostsOf(connId)[0]
  const fp = nodeFingerprint(connKey(connId), first?.node || 'pve-node-01')

  return {
    data: {
      fingerprint: fp,
      source: 'cluster/config/join',
      nodeName: first?.node || '',
      host,
      port,
      connectionName: conn?.name || connId,
      targetEndpointFormat: `apitoken=PVEAPIToken=***,host=${host}${port === '8006' ? '' : `,port=${port}`},fingerprint=${fp}`,
    },
  }
}

// /api/v1/clusters: one row per PVE connection (lib/api/clusters.ts).
function clustersList(): any {
  return {
    data: CONNECTIONS.filter(c => c.type === 'pve').map(c => {
      const hosts = hostsOf(c.id)
      const nodes = isDr(c.id) ? [] : PROD_NODES
      const cpu = nodes.length ? nodes.reduce((s, n) => s + Number(n.cpu || 0), 0) / nodes.length : 0.18
      const mem = nodes.reduce((s, n) => s + Number(n.mem || 0), 0)
      const maxmem = nodes.reduce((s, n) => s + Number(n.maxmem || 0), 0)

      return {
        id: c.id,
        name: c.name,
        status: 'healthy',
        nodes: hosts.length,
        nodesOnline: hosts.length,
        cpuUsagePct: Math.round(cpu * 1000) / 10,
        ramUsagePct: maxmem ? Math.round((mem / maxmem) * 1000) / 10 : 34.2,
        isCluster: hosts.length > 1,
      }
    }),
  }
}

function nextId(connId: string, url: URL): any {
  const used = new Set(guestsOf(connId).map(g => Number(g.vmid)))
  const requested = url.searchParams.get('vmid')

  if (requested !== null && requested !== '') {
    const n = Number(requested)

    if (!Number.isInteger(n) || n < 100 || n > 999999999) return { data: requested, available: false, error: 'VMID must be an integer between 100 and 999999999' }
    if (used.has(n)) return { data: n, available: false, error: `VM ${n} already exists` }

    return { data: n, available: true }
  }

  let next = 100

  while (used.has(next)) next++

  return { data: next, available: true }
}

// ---------------------------------------------------------------------------
// Guests: tabs of the guest panel (snapshots, notes, tasks, backups, agent)
// ---------------------------------------------------------------------------

const dayStart = () => nowSec() - (nowSec() % DAY)

function findGuest(connId: string, vmid: number | string): any | null {
  return guestsOf(connId).find(g => Number(g.vmid) === Number(vmid)) || null
}

// Same rule as the guest config mocks of demo-api.ts: NIC tagged VLAN 20 when vmid % 4 === 0.
function guestIp(vmid: number): string {
  return vmid % 4 === 0 ? `10.30.20.${(vmid % 200) + 20}` : `10.30.10.${(vmid % 200) + 20}`
}

function guestMac(vmid: number): string {
  const hex = (n: number) => n.toString(16).padStart(2, '0').toUpperCase()

  return `BC:24:11:${hex((vmid * 7) % 256)}:${hex((vmid * 13) % 256)}:${hex(vmid % 256)}`
}

const isWindows = (name: string) => name.startsWith('win-') || name.includes('ad-dc') || name.includes('power-bi')

function guestSnapshots(vmid: number, name: string): any[] {
  if (vmid % 3 === 0 || /^tpl-/.test(name)) return []
  const today = dayStart()
  const snaps = [
    { name: 'pre-upgrade', description: 'Before the OS upgrade', snaptime: today - 41 * DAY + 9 * HOUR, vmstate: false, parent: null },
    { name: 'before-patch', description: `Monthly patching ${new Date((today - 9 * DAY) * 1000).toISOString().slice(0, 7)}`, snaptime: today - 9 * DAY + 21 * HOUR, vmstate: vmid % 2 === 0, parent: 'pre-upgrade' },
  ]

  if (vmid % 5 === 0) snaps.push({ name: 'app-release', description: 'Release candidate deployed', snaptime: today - 2 * DAY + 15 * HOUR, vmstate: false, parent: 'before-patch' })

  return snaps.sort((a, b) => b.snaptime - a.snaptime)
}

function bulkSnapshots(connId: string, node: string | null): any {
  const guests = guestsOf(connId).filter(g => !node || g.node === node)
  const snapshots = guests.flatMap(g => guestSnapshots(Number(g.vmid), g.name).map(s => ({
    vmid: g.vmid,
    vmName: g.name,
    vmType: g.type,
    vmStatus: g.status,
    node: g.node,
    ...s,
  }))).sort((a, b) => b.snaptime - a.snaptime)

  return { data: { snapshots, totalCount: snapshots.length, vmCount: new Set(snapshots.map(s => `${s.vmType}/${s.vmid}`)).size } }
}

function parseVmKey(raw: string): { connId: string, type: string, node: string, vmid: number } | null {
  const parts = decodeURIComponent(raw).split(':')

  if (parts.length !== 4 || !/^\d+$/.test(parts[3])) return null

  return { connId: parts[0], type: parts[1], node: parts[2], vmid: Number(parts[3]) }
}

const fmtDuration = (s: number) => (s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`)

function upidOf(node: string, type: string, id: string | number, start: number, user = 'root@pam'): string {
  const hex = (n: number, w: number) => n.toString(16).toUpperCase().padStart(w, '0')

  return `UPID:${node}:${hex(0x1a000 + (Number(id) % 4096), 8)}:${hex(start % 0xffffffff, 8)}:${hex(start, 8)}:${type}:${id}:${user}:`
}

// Task list of one guest (VmDetailTabs > Tasks): newest first.
function guestTasks(node: string, vmid: number, type: string): any[] {
  const today = dayStart()
  const tasks: any[] = []
  const add = (taskType: string, start: number, duration: number, status = 'OK', user = 'root@pam') => {
    tasks.push({
      upid: upidOf(node, taskType, vmid, start, user),
      type: taskType,
      status: status === 'OK' ? 'success' : status.startsWith('WARNINGS') ? 'warning' : 'error',
      statusText: status,
      starttime: start,
      endtime: start + duration,
      duration,
      durationFormatted: fmtDuration(duration),
      user,
      node,
    })
  }

  for (let d = 0; d < 7; d++) {
    const start = today - d * DAY + 2 * HOUR + (vmid % 50) * 37

    if (start < nowSec()) add('vzdump', start, 180 + (vmid % 7) * 45, d === 4 && vmid % 11 === 0 ? 'WARNINGS: 1' : 'OK')
  }
  add(type === 'lxc' ? 'vzsnapshot' : 'qmsnapshot', today - 9 * DAY + 21 * HOUR, 12, 'OK', 'admin@pve')
  add(type === 'lxc' ? 'vzmigrate' : 'qmigrate', today - 15 * DAY + 10 * HOUR, 94, 'OK', 'admin@pve')
  add(type === 'lxc' ? 'vzstart' : 'qmstart', today - 15 * DAY + 10 * HOUR - 600, 3)

  return tasks.sort((a, b) => b.starttime - a.starttime)
}

// useHardwareHandlers loadBackups: data.backups / stats / warnings / pbsConfigured.
function guestBackups(vmid: number, url: URL): any {
  const type = url.searchParams.get('type') === 'ct' ? 'ct' : 'vm'
  const g = findGuest(url.searchParams.get('connectionId') || PROD, vmid)
  const name = g?.name || `vm-${vmid}`
  const sizeBase = Math.round((g?.maxdisk || 32 * 1024 ** 3) * (0.18 + (vmid % 9) / 40))
  const today = dayStart()
  const backups: any[] = []
  const entry = (pbsId: string, pbsName: string, pbsUrl: string, datastore: string, t: number, i: number) => {
    const iso = new Date(t * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
    const size = sizeBase + (i * 7919 * 1024 * 1024) % (512 * 1024 * 1024)

    return {
      id: `${datastore}/${type}/${vmid}/${t}`,
      source: 'pbs',
      pbsId,
      pbsName,
      pbsUrl,
      datastore,
      namespace: '',
      backupPath: `backup/${type}/${vmid}/${iso}`,
      backupType: type,
      backupId: String(vmid),
      vmName: name,
      backupTime: t,
      backupTimeFormatted: new Date(t * 1000).toLocaleString('en-US'),
      backupTimeIso: iso,
      size,
      sizeFormatted: `${(size / 1024 ** 3).toFixed(2)} GB`,
      files: ['index.json.blob', 'drive-scsi0.img.fidx', 'qemu-server.conf.blob'],
      fileCount: 3,
      verification: i < 5 ? { state: 'ok', upid: null } : null,
      verified: i < 5,
      verifiedAt: null,
      protected: i === 0 && vmid % 4 === 0,
      owner: 'root@pam',
      comment: name,
    }
  }

  if (!/^tpl-/.test(name)) {
    for (let d = 0; d < 7; d++) {
      const t = today - d * DAY + 2 * HOUR + (vmid % 50) * 37

      if (t < nowSec()) backups.push(entry('demo-pbs-001', 'PBS Master', 'https://10.10.10.50:8007', 'backup-main', t, d))
    }
    for (let w = 0; w < 3; w++) backups.push(entry('demo-pbs-002', 'PBS Replica', 'https://10.10.10.51:8007', 'offsite', today - (w * 7 + 1) * DAY + 3 * HOUR, w + 1))
  }
  backups.sort((a, b) => b.backupTime - a.backupTime)
  const totalSize = backups.reduce((s, b) => s + b.size, 0)

  return {
    data: {
      vmid: String(vmid),
      backups,
      stats: {
        total: backups.length,
        totalSize,
        totalSizeFormatted: `${(totalSize / 1024 ** 3).toFixed(2)} GB`,
        pbsTotal: backups.length,
        verifiedCount: backups.filter(b => b.verified).length,
        protectedCount: backups.filter(b => b.protected).length,
        oldestBackup: backups.at(-1)?.backupTimeFormatted ?? null,
        newestBackup: backups[0]?.backupTimeFormatted ?? null,
      },
      warnings: [],
      pbsConfigured: true,
      vzdumpScanned: url.searchParams.get('scanVzdump') === '1',
    },
  }
}

function guestNotes(connId: string, vmid: number): any {
  const g = findGuest(connId, vmid)
  const name = g?.name || `vm-${vmid}`
  const owner = /^db-/.test(name) ? 'DBA team' : /^(k8s|rancher)/.test(name) ? 'Platform team' : isWindows(name) ? 'Windows team' : 'Ops team'

  return {
    data: {
      content: `## ${name}\n\n- **Owner:** ${owner}\n- **IP:** ${guestIp(vmid)}\n- **Backups:** daily to PBS Master, weekly copy offsite\n\nMaintenance window: Sunday 02:00-04:00 UTC.`,
    },
  }
}

// InventoryDetails loadGuestInfo / RestoreToGuestDialog: agent facts of a running guest.
function guestAgent(connId: string, type: string, vmid: number): any {
  const g = findGuest(connId, vmid)
  const running = (g?.status || 'running') === 'running'
  const name = g?.name || ''
  const win = isWindows(name)
  const maxdisk = g?.maxdisk || 34359738368

  if (!running) return { data: { status: g?.status || 'stopped' } }

  return {
    data: {
      ip: guestIp(vmid),
      uptime: 86400 * (3 + (vmid % 40)) + (vmid * 977) % 86400,
      status: 'running',
      pid: 10000 + vmid * 13,
      osInfo: win
        ? { type: 'windows', name: 'Microsoft Windows Server 2022 Standard', version: '10.0.20348', kernel: '10.0' }
        : { type: 'linux', name: type === 'lxc' ? 'Debian GNU/Linux 12 (bookworm)' : 'Debian GNU/Linux 12 (bookworm)', version: '12', kernel: '6.1.0-26-amd64' },
      diskUsage: { used: Math.round(maxdisk * (0.3 + (vmid % 50) / 100)), total: maxdisk },
    },
  }
}

// ---------------------------------------------------------------------------
// SDN and host networking
// ---------------------------------------------------------------------------

const VDCS: any[] = MOCK['/api/v1/admin/vdcs']?.data || []

// VXLAN zone of each vDC (sdnZoneName) and its VNets (/vdcs/<id>/vnets).
const VDC_VNETS: any[] = VDCS.flatMap(vdc => (MOCK[`/api/v1/vdcs/${vdc.id}/vnets`]?.data || []).map((v: any) => ({
  vnet: v.pveName,
  alias: v.displayName,
  zone: vdc.sdnZoneName,
  tag: v.tag,
  vdcId: vdc.id,
  vdcSlug: vdc.slug,
  subnet: v.subnet,
})))

function sdnZones(connId: string): any[] {
  if (isDr(connId)) {
    return [
      { zone: 'drvx', type: 'vxlan', nodes: hostsOf(DR).map(h => h.node).join(','), mtu: 1450, ipam: 'pve', peers: hostsOf(DR).map(h => h.ip).join(',') },
      { zone: 'drvlan', type: 'vlan', bridge: 'vmbr0', ipam: 'pve' },
    ]
  }

  return [
    ...VDCS.filter(v => v.connectionId === PROD && v.sdnZoneName).map(v => ({
      zone: v.sdnZoneName,
      type: 'vxlan',
      nodes: v.nodes.join(','),
      mtu: 1450,
      ipam: 'pve',
      peers: v.nodes.map((n: string) => hostsOf(PROD).find(h => h.node === n)?.ip).filter(Boolean).join(','),
    })),
    { zone: 'prodvlan', type: 'vlan', bridge: 'vmbr0', ipam: 'pve' },
  ]
}

function sdnVnets(connId: string): any[] {
  if (isDr(connId)) {
    return [
      { vnet: 'drweb', alias: 'DR web', zone: 'drvx', tag: 20100, type: 'vnet' },
      { vnet: 'drrepl', alias: 'Replication', zone: 'drvlan', tag: 40, type: 'vnet' },
    ]
  }

  return [
    ...VDC_VNETS.map(v => ({ vnet: v.vnet, alias: v.alias, zone: v.zone, tag: v.tag, type: 'vnet' })),
    { vnet: 'vlan20', alias: 'Prod servers', zone: 'prodvlan', tag: 20, type: 'vnet' },
    { vnet: 'vlan30', alias: 'Prod apps', zone: 'prodvlan', tag: 30, type: 'vnet' },
  ]
}

// Production return of /sdn/status for PVE 8.4.1 (version mock of the cluster).
function sdnStatus(): any {
  return { data: { version: { release: '8.4.1', repoid: '2a5fa54a8503f96d' }, pveMajor: 8, pending: false, ipamBackends: ['pve'] } }
}

function ipamAllocations(connId: string): any[] {
  if (isDr(connId)) return DR_GUESTS.slice(0, 3).map((g, i) => ({ ip: `10.200.10.${i + 10}`, mac: guestMac(g.vmid), hostname: g.name, vmid: g.vmid, vnet: 'drweb', zone: 'drvx', subnet: '10.200.10.0/24' }))

  const out: any[] = []

  VDC_VNETS.forEach((v, vi) => {
    const [a, b, c] = String(v.subnet?.cidr || '10.0.0.0/24').split('.')

    out.push({ ip: v.subnet?.gateway, gateway: 1, vnet: v.vnet, zone: v.zone, subnet: v.subnet?.cidr })
    for (let i = 0; i < 4; i++) {
      const g = PROD_GUESTS[(vi * 7 + i * 3) % PROD_GUESTS.length]

      out.push({ ip: `${a}.${b}.${c}.${10 + i}`, mac: guestMac(Number(g.vmid)), hostname: g.name, vmid: g.vmid, vnet: v.vnet, zone: v.zone, subnet: v.subnet?.cidr })
    }
  })

  return out
}

// ClusterSdnVNetFirewallPanel: PVE 8.3+ vnet firewall rules.
function vnetFirewallRules(vnet: string): any[] {
  const known = VDC_VNETS.find(v => v.vnet === vnet)

  if (!known) return []
  const web = /web/i.test(known.alias)

  return [
    { pos: 0, type: 'forward', action: 'ACCEPT', proto: 'tcp', dport: web ? '80,443' : '8080', enable: 1, comment: web ? 'HTTP(S) to the web tier' : 'App port from the web tier' },
    { pos: 1, type: 'forward', action: 'ACCEPT', proto: 'icmp', enable: 1, comment: 'Ping' },
    { pos: 2, type: 'forward', action: 'DROP', enable: 1, log: 'info', comment: 'Default deny' },
  ]
}

// PVE /nodes/{node}/network rows: two bonded uplinks, VLAN-aware vmbr0, a corosync/ceph bond.
function nodeNetwork(connId: string, node: string): any[] {
  const host = hostsOf(connId).find(h => h.node === node) || hostsOf(connId)[0]
  const ip = host?.ip || '10.10.10.1'
  const last = ip.split('.').pop()
  const site = isDr(connId) ? 20 : 10
  const gw = ip.replace(/\.\d+$/, '.254')

  return [
    { iface: 'eno1', type: 'eth', active: 1, autostart: 1, method: 'manual', families: ['inet'], exists: 1 },
    { iface: 'eno2', type: 'eth', active: 1, autostart: 1, method: 'manual', families: ['inet'], exists: 1 },
    { iface: 'ens1f0', type: 'eth', active: 1, autostart: 1, method: 'manual', families: ['inet'], exists: 1, mtu: 9000 },
    { iface: 'ens1f1', type: 'eth', active: 1, autostart: 1, method: 'manual', families: ['inet'], exists: 1, mtu: 9000 },
    { iface: 'bond0', type: 'bond', active: 1, autostart: 1, method: 'manual', families: ['inet'], slaves: 'eno1 eno2', bond_mode: '802.3ad', 'bond-xmit-hash-policy': 'layer3+4', comments: 'Uplink LACP' },
    { iface: 'bond1', type: 'bond', active: 1, autostart: 1, method: 'static', families: ['inet'], slaves: 'ens1f0 ens1f1', bond_mode: 'active-backup', address: `172.16.${site}.${last}`, netmask: '24', cidr: `172.16.${site}.${last}/24`, mtu: 9000, comments: 'Corosync / Ceph' },
    { iface: 'vmbr0', type: 'bridge', active: 1, autostart: 1, method: 'static', families: ['inet'], bridge_ports: 'bond0', bridge_stp: 'off', bridge_fd: '0', bridge_vlan_aware: 1, bridge_vids: '2-4094', address: ip, netmask: '24', cidr: `${ip}/24`, gateway: gw, comments: 'Management and guests' },
    { iface: 'vmbr0.40', type: 'vlan', active: 1, autostart: 1, method: 'static', families: ['inet'], 'vlan-raw-device': 'vmbr0', 'vlan-id': 40, address: `10.40.${site}.${last}`, netmask: '24', cidr: `10.40.${site}.${last}/24`, comments: 'Migration network' },
  ]
}

// Shape of /nodes/{node}/storages: PVE node storage rows plus formats and tenantCanUpload.
function nodeStorages(connId: string, node: string, url: URL): any[] {
  const all: any[] = MOCK[`/api/v1/connections/${connKey(connId)}/storage`]?.data || []
  const wanted = (url.searchParams.get('content') || '').split(',').map(s => s.trim()).filter(Boolean)
  const rows = all.filter(s => s.shared || s.node === node || (s.nodes || []).includes(node))
  const seen = new Set<string>()

  return rows.filter(s => !seen.has(s.storage) && seen.add(s.storage)).map(s => {
    const content: string[] = Array.isArray(s.content) ? s.content : String(s.content || '').split(',')
    const formats = s.type === 'dir' ? ['raw', 'qcow2', 'vmdk'] : ['raw']

    return {
      storage: s.storage,
      type: s.type,
      content: content.join(','),
      active: 1,
      enabled: 1,
      shared: s.shared ? 1 : 0,
      total: s.total,
      used: s.used,
      avail: s.free ?? Math.max(0, (s.total || 0) - (s.used || 0)),
      used_fraction: s.total ? s.used / s.total : 0,
      formats,
      defaultFormat: s.type === 'dir' ? 'qcow2' : 'raw',
      tenantCanUpload: true,
    }
  }).filter(s => !wanted.length || wanted.some(c => s.content.split(',').includes(c)))
}

// NetworkDetailPanel: guests with parsed NICs, host bridges, VLANs, SDN vnets.
function connectionNetworks(connId: string): any {
  const guests = guestsOf(connId)
  const hosts = hostsOf(connId)
  const zones = sdnZones(connId)
  const vnets = sdnVnets(connId)

  return {
    data: guests.map(g => {
      const vmid = Number(g.vmid)
      const tag = vmid % 4 === 0 ? 20 : undefined

      return {
        vmid: String(vmid),
        name: g.name,
        node: g.node,
        type: g.type,
        status: g.status,
        nets: [{ id: 'net0', model: g.type === 'lxc' ? 'veth' : 'virtio', bridge: 'vmbr0', macaddr: guestMac(vmid), ...(tag && { tag, effectiveTag: tag }), firewall: vmid % 3 !== 0 }],
      }
    }),
    bridges: hosts.map(h => ({ node: h.node, iface: 'vmbr0', type: 'bridge', active: true, autostart: true, vlanAware: true, ports: 'bond0', cidr: `${h.ip}/24` })),
    vlans: hosts.map(h => ({ node: h.node, iface: 'vmbr0.40', tag: 40, active: true, autostart: true, cidr: `10.40.${isDr(connId) ? 20 : 10}.${h.ip.split('.').pop()}/24` })),
    sdnVnets: vnets.map(v => ({ vnet: v.vnet, alias: v.alias, zone: v.zone, zoneType: zones.find(z => z.zone === v.zone)?.type || '', tag: v.tag })),
    vnetAliases: Object.fromEntries(vnets.map(v => [v.vnet, v.alias])),
  }
}

// CreateVmDialog / AddNetworkDialog / DeployWizard: bridge + vnet choices of a node.
function networkChoices(connId: string): any {
  return {
    data: [
      { kind: 'bridge', name: 'vmbr0', type: 'bridge' },
      ...sdnVnets(connId).map(v => {
        const vdcVnet = VDC_VNETS.find(x => x.vnet === v.vnet)

        return {
          kind: 'vnet',
          name: v.vnet,
          displayName: v.alias ?? v.vnet,
          vdc: '*',
          vdcId: null,
          zone: v.zone,
          subnet: vdcVnet?.subnet ? { cidr: vdcVnet.subnet.cidr, gateway: vdcVnet.subnet.gateway, dnsServers: vdcVnet.subnet.dnsServers || [], subnetId: vdcVnet.subnet.id } : null,
        }
      }),
    ],
  }
}

// ---------------------------------------------------------------------------
// Firewall, microsegmentation, CVE
// ---------------------------------------------------------------------------

// Same rule as demo-api.ts: a guest is firewalled when its vmid is not a multiple of 3.
const isFirewalled = (vmid: number) => vmid % 3 !== 0

const MICROSEG_NETWORKS = [
  { name: 'prod-servers', cidr: '10.30.20.0/24', comment: 'VLAN 20, production servers', gateway: '10.30.20.1', base_sg: 'sg-base-prod-servers', has_base_sg: true },
  { name: 'prod-apps', cidr: '10.30.10.0/24', comment: 'Untagged application guests', gateway: '10.30.10.1', base_sg: 'sg-base-prod-apps', has_base_sg: false },
]

const guestNetwork = (vmid: number) => (vmid % 4 === 0 ? MICROSEG_NETWORKS[0] : MICROSEG_NETWORKS[1])
// Isolated: firewalled and on the network that has its base security group.
const isIsolated = (vmid: number) => isFirewalled(vmid) && guestNetwork(vmid).has_base_sg

function firewallStatus(connId: string): any {
  const guests = guestsOf(connId)

  return {
    cluster_enabled: true,
    status: 'enabled',
    total_aliases: 5,
    total_ipsets: 3,
    total_groups: 5,
    total_cluster_rules: 6,
    protected_nodes: hostsOf(connId).length,
    total_nodes: hostsOf(connId).length,
    protected_vms: guests.filter(g => isFirewalled(Number(g.vmid))).length,
    total_vms: guests.length,
  }
}

// FirewallLogView: FirewallLogResult (flat), rows newest first inside the window.
function firewallLog(connId: string, url: URL): any {
  const scope = url.searchParams.get('scope') || 'cluster'
  const windowSec = Math.min(Number(url.searchParams.get('window')) || 3600, 7 * DAY)
  const vmidFilter = Number(url.searchParams.get('vmid')) || null
  const nodeFilter = url.searchParams.get('node')
  const group = url.searchParams.get('group')
  const end = Math.floor(nowSec() / 300) * 300
  const guests = guestsOf(connId).filter(g => g.status === 'running')
  const count = Math.min(60, Math.max(8, Math.floor(windowSec / 120)))
  const rows: any[] = []

  for (let i = 0; i < count; i++) {
    const h = hash(`${connId}:${i}`)
    const g = vmidFilter ? (findGuest(connId, vmidFilter) || guests[0]) : guests[h % guests.length]
    const node = nodeFilter || g.node
    const ts = (end - Math.floor((i * windowSec) / count) - (h % 60)) * 1000
    const blocked = h % 5 < 2
    const inbound = h % 7 !== 0
    const host = scope === 'cluster'
    const vmid = host ? 0 : Number(g.vmid)
    const src = inbound ? `192.168.${240 + (h % 4)}.${10 + (h % 200)}` : guestIp(Number(g.vmid))
    const dst = inbound ? (host ? hostsOf(connId)[h % hostsOf(connId).length].ip : guestIp(Number(g.vmid))) : `10.10.10.${50 + (h % 2)}`
    const dport = blocked ? [3389, 23, 445, 5900][h % 4] : [22, 443, 8007, 3306][h % 4]
    const action = blocked ? 'DROP' : 'ACCEPT'
    const chain = host ? (inbound ? 'PVEFW-HOST-IN' : 'PVEFW-HOST-OUT') : group ? `GROUP-${group}-${inbound ? 'IN' : 'OUT'}` : `tap${vmid}i0-${inbound ? 'IN' : 'OUT'}`
    const origin = host ? 'host' : group ? 'group' : 'guest'

    rows.push({
      id: `${node}:${ts}:${i}`,
      node,
      ts,
      level: blocked ? 4 : 6,
      chain,
      direction: inbound ? 'in' : 'out',
      action,
      actionInferred: origin === 'group',
      policy: blocked && h % 3 === 0,
      origin,
      ...(group && { group }),
      ...(vmid && { vmid }),
      src,
      dst,
      proto: 'TCP',
      sport: 40000 + (h % 20000),
      dport,
      ...(origin !== 'host' && { ruleCandidates: [h % 3] }),
      raw: `${vmid} 6 ${chain} ${new Date(ts).toUTCString()} policy ${action}: IN=fwbr${vmid}i0 SRC=${src} DST=${dst} PROTO=TCP SPT=${40000 + (h % 20000)} DPT=${dport}`,
    })
  }

  return { rows, warnings: [], truncated: false }
}

function microsegAnalysis(connId: string): any {
  const guests = guestsOf(connId)
  const vdcNets = VDC_VNETS.slice(0, 2).map(v => ({ name: `${v.vdcSlug}-${v.alias.toLowerCase().replace(/\s+/g, '-')}`, cidr: v.subnet.cidr, comment: `${v.alias} (vDC ${v.vdcSlug})`, gateway: v.subnet.gateway, has_gateway: false, has_base_sg: false }))
  const networks = [...MICROSEG_NETWORKS.map(({ base_sg: _b, ...n }) => ({ ...n, has_gateway: true })), ...vdcNets]

  return {
    networks,
    gateway_aliases: MICROSEG_NETWORKS.map(n => `gw-${n.name}`),
    base_sgs: ['sg-base-prod-servers'],
    missing_gateways: vdcNets.map(n => ({ network_name: n.name, alias_name: `gw-${n.name}`, gateway_ip: n.gateway })),
    missing_base_sgs: networks.filter(n => !n.has_base_sg).map(n => ({ network_name: n.name, sg_name: `sg-base-${n.name}`, gateway_name: `gw-${n.name}` })),
    total_vms: guests.length,
    isolated_vms: guests.filter(g => isIsolated(Number(g.vmid))).length,
    unprotected_vms: guests.filter(g => !isFirewalled(Number(g.vmid))).length,
    segmentation_ready: false,
  }
}

function microsegVmSummary(g: any): any {
  const vmid = Number(g.vmid)
  const net = guestNetwork(vmid)

  return {
    vmid,
    name: g.name,
    node: g.node,
    type: g.type,
    status: g.status,
    network: net.name,
    networks: [net.name],
    firewall_enabled: isFirewalled(vmid),
    is_isolated: isIsolated(vmid),
    missing_base_sgs: isIsolated(vmid) ? [] : [net.base_sg],
    applied_sgs: isIsolated(vmid) ? [net.base_sg, ...(/^web/.test(g.name) || /nginx|haproxy/.test(g.name) ? ['web-servers'] : /^db-/.test(g.name) ? ['db-servers'] : [])] : [],
  }
}

function microsegVms(connId: string, network: string | null): any {
  const vms = guestsOf(connId).map(microsegVmSummary).filter(v => !network || v.networks.includes(network))

  return {
    total_vms: vms.length,
    isolated_vms: vms.filter(v => v.is_isolated).length,
    unprotected_vms: vms.filter(v => !v.firewall_enabled).length,
    vms,
  }
}

function microsegVmStatus(connId: string, vmid: number): any {
  const g = findGuest(connId, vmid) || { vmid, name: `vm-${vmid}`, node: hostsOf(connId)[0]?.node, type: 'qemu', status: 'running' }
  const s = microsegVmSummary(g)
  const net = guestNetwork(vmid)
  const recommendations: string[] = []

  if (!s.firewall_enabled) recommendations.push('Enable the firewall on net0')
  if (!s.is_isolated) recommendations.push(`Apply the base security group ${net.base_sg}`)

  return {
    vmid,
    name: s.name,
    node: s.node,
    firewall_enabled: s.firewall_enabled,
    policy_in: s.is_isolated ? 'DROP' : 'ACCEPT',
    policy_out: 'ACCEPT',
    networks: [{ interface: 'net0', bridge: 'vmbr0', ip_address: guestIp(vmid), network: net.name, gateway: net.gateway, base_sg: net.base_sg, firewall: s.firewall_enabled }],
    is_isolated: s.is_isolated,
    applied_base_sgs: s.is_isolated ? [net.base_sg] : [],
    applied_sgs: s.applied_sgs,
    direct_rules: s.firewall_enabled ? 2 + (vmid % 2) : 0,
    recommendations,
  }
}

function microsegSimulation(connId: string, vmid: number): any {
  const st = microsegVmStatus(connId, vmid)
  const net = guestNetwork(vmid)
  const peers = guestsOf(connId).filter(g => Number(g.vmid) !== vmid && guestNetwork(Number(g.vmid)).name === net.name && g.status === 'running').slice(0, 3)
  const state = (isolated: boolean) => ({ firewall_enabled: isolated || st.firewall_enabled, policy_in: isolated ? 'DROP' : st.policy_in, policy_out: 'ACCEPT', is_isolated: isolated, applied_sgs: isolated ? [net.base_sg, ...st.applied_sgs.filter((x: string) => x !== net.base_sg)] : st.applied_sgs })

  return {
    vmid,
    name: st.name,
    current_state: state(st.is_isolated),
    simulated_state: state(true),
    allowed_flows: [
      { direction: 'out', protocol: 'any', port: '*', source: guestIp(vmid), destination: net.gateway, reason: `Gateway alias gw-${net.name}`, critical: true },
      { direction: 'in', protocol: 'tcp', port: '22', source: '+management', destination: guestIp(vmid), reason: 'Management ipset', critical: false },
    ],
    blocked_flows: peers.map(p => ({ direction: 'in', protocol: 'any', port: '*', source: guestIp(Number(p.vmid)), destination: guestIp(vmid), reason: `Same network ${net.name}, no rule allows it`, critical: false })),
    affected_vms: peers.map(p => ({ vmid: Number(p.vmid), name: p.name, node: p.node, network: net.name, ip_address: guestIp(Number(p.vmid)), impact: 'Can no longer reach this VM directly', can_resolve: true, resolution: 'Add an allow rule in a security group' })),
    warnings: st.is_isolated ? [] : ['Existing sessions from the same network will be dropped'],
    required_actions: st.firewall_enabled ? [] : ['Enable the firewall on net0'],
  }
}

const CVE_CATALOG = [
  { cveId: 'CVE-2024-6387', package: 'openssh-server', installedVersion: '1:9.2p1-2+deb12u2', fixedVersion: '1:9.2p1-2+deb12u3', severity: 'critical', description: 'Signal handler race condition in sshd (regreSSHion) allowing unauthenticated remote code execution.', publishedAt: '2024-07-01T00:00:00Z', nodes: 'even' },
  { cveId: 'CVE-2024-2961', package: 'libc6', installedVersion: '2.36-9+deb12u4', fixedVersion: '2.36-9+deb12u7', severity: 'high', description: 'Out-of-bounds write in iconv() when converting to ISO-2022-CN-EXT.', publishedAt: '2024-04-17T00:00:00Z', nodes: 'all' },
  { cveId: 'CVE-2024-45490', package: 'libexpat1', installedVersion: '2.5.0-1', fixedVersion: '2.5.0-1+deb12u1', severity: 'high', description: 'Negative length passed to XML_ParseBuffer can lead to memory corruption.', publishedAt: '2024-08-30T00:00:00Z', nodes: 'all' },
  { cveId: 'CVE-2024-38474', package: 'apache2-utils', installedVersion: '2.4.59-1~deb12u1', fixedVersion: '2.4.61-1~deb12u1', severity: 'medium', description: 'Substitution encoding issue in mod_rewrite.', publishedAt: '2024-07-01T00:00:00Z', nodes: 'odd' },
  { cveId: 'CVE-2023-50387', package: 'libunbound8', installedVersion: '1.17.1-2+deb12u1', fixedVersion: '1.17.1-2+deb12u2', severity: 'medium', description: 'DNSSEC KeyTrap: crafted zones exhaust CPU on the validating resolver.', publishedAt: '2024-02-14T00:00:00Z', nodes: 'odd' },
  { cveId: 'CVE-2023-45853', package: 'zlib1g', installedVersion: '1:1.2.13.dfsg-1', fixedVersion: '', fixAvailable: false, noDsaReason: 'Minor issue', severity: 'medium', description: 'Integer overflow in MiniZip zipOpenNewFileInZip4_64 (contrib code, not built by Debian).', publishedAt: '2023-10-14T00:00:00Z', nodes: 'all' },
  { cveId: 'CVE-2022-0563', package: 'util-linux', installedVersion: '2.38.1-5+deb12u1', fixedVersion: '', fixAvailable: false, noDsaReason: 'Minor issue', severity: 'low', description: 'chfn and chsh partial disclosure of arbitrary files when compiled with libreadline.', publishedAt: '2022-02-21T00:00:00Z', nodes: 'all' },
]

// CveTab: flat { vulnerabilities, nodes, lastScan } from the orchestrator.
function cveScan(connId: string, node: string | null): any {
  const hosts = hostsOf(connId).filter(h => !node || h.node === node)
  const vulnerabilities: any[] = []
  const nodes = hosts.map((h, i) => {
    const hits = CVE_CATALOG.filter(c => c.nodes === 'all' || (c.nodes === 'even') === ((i + 1) % 2 === 0))
    const fixable = hits.filter(c => c.fixAvailable !== false).length

    for (const c of hits) {
      const { nodes: _n, ...entry } = c

      vulnerabilities.push({ ...entry, fixAvailable: c.fixAvailable !== false, node: h.node })
    }

    return { node: h.node, release: 'bookworm', source: 'api', packagesScanned: 812 + (i % 3) * 7, packagesTracked: 64, fixable, noFix: hits.length - fixable }
  })

  return { vulnerabilities, nodes, lastScan: new Date((hourBucket() - 2 * HOUR) * 1000).toISOString() }
}

// ---------------------------------------------------------------------------
// Migrations from the VMware source, hosts, tags, tasks
// ---------------------------------------------------------------------------

const ESXI = 'demo-esxi-001'
const GiB = 1024 ** 3

// Jobs on the ESXi source guests of GET /vmware/demo-esxi-001/vms.
const MIGRATION_DEFS = [
  { id: 'demo-mig-001', vm: 'vm-104', name: 'legacy-jenkins', node: 'pve-node-04', vmid: 3104, status: 'completed', ageH: 26 * 24, durH: 0.6, disks: 1, totalGb: 80 },
  { id: 'demo-mig-002', vm: 'vm-106', name: 'legacy-monitoring', node: 'pve-node-06', vmid: 3106, status: 'completed', ageH: 19 * 24, durH: 0.4, disks: 1, totalGb: 60 },
  { id: 'demo-mig-003', vm: 'vm-102', name: 'legacy-fileserver', node: 'pve-node-02', vmid: 3102, status: 'failed', ageH: 6 * 24, durH: 1.2, disks: 2, totalGb: 1024, error: 'Target storage CephStoragePool ran out of space during the copy of disk 2' },
  { id: 'demo-mig-004', vm: 'vm-102', name: 'legacy-fileserver', node: 'pve-node-03', vmid: 3112, status: 'completed', ageH: 5 * 24, durH: 3.1, disks: 2, totalGb: 1024 },
  { id: 'demo-mig-005', vm: 'vm-105', name: 'legacy-sharepoint', node: 'pve-node-05', vmid: 3105, status: 'transferring', ageH: 0.4, durH: 0, disks: 2, totalGb: 300 },
]

function migrationJob(def: typeof MIGRATION_DEFS[number]): any {
  const created = (hourBucket() - Math.round(def.ageH * HOUR)) * 1000
  const started = created + 20_000
  const done = def.status !== 'transferring'
  const completed = done ? started + Math.round(def.durH * HOUR * 1000) : null
  const totalBytes = def.totalGb * GiB
  const progress = def.status === 'completed' ? 100 : def.status === 'failed' ? 62 : 41
  const bytes = def.status === 'completed' ? totalBytes : Math.round(totalBytes * (def.status === 'failed' ? 0.55 : 0.37))
  const iso = (ms: number) => new Date(ms).toISOString()
  const logs = [
    { ts: iso(started), msg: `Preflight checks passed for ${def.name}`, level: 'info', progress: 2 },
    { ts: iso(started + 15_000), msg: `Created VM ${def.vmid} on ${def.node}`, level: 'info', progress: 5 },
    { ts: iso(started + 30_000), msg: `Transferring disk 1/${def.disks} to CephStoragePool`, level: 'info', progress: 10 },
    ...(def.status === 'failed' ? [{ ts: iso(completed!), msg: def.error, level: 'error', progress }] : []),
    ...(def.status === 'completed' ? [{ ts: iso(completed! - 60_000), msg: 'Guest configured (virtio drivers, network)', level: 'info', progress: 95 }, { ts: iso(completed!), msg: 'Migration completed', level: 'success', progress: 100 }] : []),
  ]

  return {
    id: def.id,
    tenantId: 'default',
    sourceConnectionId: ESXI,
    sourceVmId: def.vm,
    sourceVmName: def.name,
    sourceHost: def.vm === 'vm-105' || def.vm === 'vm-106' ? 'esxi-02.demo.local' : 'esxi-01.demo.local',
    targetConnectionId: PROD,
    targetNode: def.node,
    targetStorage: 'CephStoragePool',
    targetVmid: def.vmid,
    config: { migrationType: 'cold', sourceType: 'vmware', targetNode: def.node, targetStorage: 'CephStoragePool', networkBridge: 'vmbr0', startAfterMigration: true },
    status: def.status,
    currentStep: def.status === 'transferring' ? `Copying disk 1/${def.disks}` : null,
    progress,
    totalDisks: def.disks,
    currentDisk: def.status === 'transferring' ? 0 : def.disks - 1,
    bytesTransferred: bytes,
    totalBytes,
    transferSpeed: def.status === 'transferring' ? '186 MB/s' : null,
    projectedDowntimeSec: null,
    cutoverRequestedAt: null,
    forcePowerOffRequestedAt: null,
    rootChoice: null,
    error: def.error ?? null,
    logs,
    startedAt: iso(started),
    completedAt: completed ? iso(completed) : null,
    createdAt: iso(created),
    updatedAt: iso(completed ?? hourBucket() * 1000),
    createdBy: 'demo-user',
    ownerInstanceId: null,
    batchId: null,
    batchOrder: null,
  }
}

const migrationJobs = () => MIGRATION_DEFS.map(migrationJob).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))

// Same aggregation as lib/migration/migration-stats aggregateMigrationStats.
function migrationStats(): any {
  const stats = { completed: 0, failed: 0, cancelled: 0, queued: 0, inProgress: 0, bytesTransferred: 0 } as Record<string, number>

  for (const j of migrationJobs()) {
    if (j.status === 'completed') { stats.completed++; stats.bytesTransferred += j.bytesTransferred } else if (j.status === 'failed') stats.failed++
    else if (j.status === 'cancelled') stats.cancelled++
    else if (j.status === 'queued') stats.queued++
    else stats.inProgress++
  }

  return { data: { bySource: { [ESXI]: { ...stats } }, byType: { vmware: { ...stats } } } }
}

// ESXi source VM details read by the migrate dialog (disks, NICs, CPU).
function vmwareVmDetail(vmid: string): any {
  const vms: any[] = [
    { vmid: 'vm-101', name: 'legacy-erp-01', guestOS: 'windows2019srvNext_64Guest', cpu: 4, mem: 16384, power: 'poweredOn', disks: [180, 40], host: 'esxi-01.demo.local', ds: 'datastore1' },
    { vmid: 'vm-102', name: 'legacy-fileserver', guestOS: 'windows2016srv_64Guest', cpu: 2, mem: 8192, power: 'poweredOn', disks: [100, 924], host: 'esxi-01.demo.local', ds: 'datastore2' },
    { vmid: 'vm-103', name: 'legacy-oracle-db', guestOS: 'oracleLinux8_64Guest', cpu: 8, mem: 65536, power: 'poweredOn', disks: [100, 1948], host: 'esxi-02.demo.local', ds: 'datastore2' },
    { vmid: 'vm-104', name: 'legacy-jenkins', guestOS: 'ubuntu64Guest', cpu: 4, mem: 8192, power: 'poweredOff', disks: [80], host: 'esxi-01.demo.local', ds: 'datastore1' },
    { vmid: 'vm-105', name: 'legacy-sharepoint', guestOS: 'windows2019srv_64Guest', cpu: 4, mem: 16384, power: 'poweredOn', disks: [120, 180], host: 'esxi-02.demo.local', ds: 'datastore1' },
    { vmid: 'vm-106', name: 'legacy-monitoring', guestOS: 'centos8_64Guest', cpu: 2, mem: 4096, power: 'suspended', disks: [60], host: 'esxi-02.demo.local', ds: 'datastore1' },
  ]
  const vm = vms.find(v => v.vmid === vmid)

  if (!vm) return null
  const n = Number(vm.vmid.slice(3))
  const committed = vm.disks.reduce((s: number, gb: number) => s + gb * GiB, 0)
  const mac = `00:50:56:a1:${n.toString(16).padStart(2, '0')}:0${n % 10}`

  return {
    data: {
      vmid: vm.vmid,
      name: vm.name,
      guestOS: vm.guestOS,
      el10: false,
      numCPU: vm.cpu,
      numCoresPerSocket: vm.cpu > 2 ? 2 : 1,
      sockets: vm.cpu > 2 ? vm.cpu / 2 : vm.cpu,
      memoryMB: vm.mem,
      vmxVersion: 'vmx-19',
      uuid: `4201a1b2-c3d4-e5f6-0718-29${String(n).padStart(10, '0')}`,
      firmware: /windows/.test(vm.guestOS) ? 'efi' : 'bios',
      annotation: '',
      toolsStatus: vm.vmid === 'vm-103' ? 'toolsOld' : 'toolsOk',
      toolsRunningStatus: vm.power === 'poweredOn' ? 'guestToolsRunning' : 'guestToolsNotRunning',
      ipAddress: vm.power === 'poweredOn' ? `10.10.50.${100 + n}` : '',
      hostName: vm.name,
      powerState: vm.power,
      status: vm.power === 'poweredOn' ? 'running' : vm.power === 'suspended' ? 'suspended' : 'stopped',
      bootTime: vm.power === 'poweredOn' ? new Date((dayStart() - 40 * DAY) * 1000).toISOString() : null,
      maxCpuUsage: vm.cpu * 2600,
      committed,
      uncommitted: 0,
      provisioned: committed,
      disks: vm.disks.map((gb: number, i: number) => ({
        label: `Hard disk ${i + 1}`,
        capacityBytes: gb * GiB,
        fileName: `[${vm.ds}] ${vm.name}/${vm.name}${i ? `_${i}` : ''}.vmdk`,
        thinProvisioned: i > 0,
        diskMode: 'persistent',
        sharing: 'sharingNone',
      })),
      networks: [{ label: 'Network adapter 1', macAddress: mac, network: 'VM Network', connected: true }],
      nics: [{ label: 'Network adapter 1', type: 'Vmxnet3', macAddress: mac, network: 'VM Network', pciSlot: 192 }],
      hasVtpm: false,
      snapshotCount: vm.vmid === 'vm-101' ? 1 : 0,
      connectionId: ESXI,
      connectionName: 'ESXi Datacenter',
      vcenterDatacenter: null,
      vcenterCluster: null,
      vcenterHost: vm.host,
      vcenterHostStatus: 'green',
      vcenterHostConnectionState: 'connected',
      vcenterHostPowerState: 'poweredOn',
    },
  }
}

function vmwareCopyInterfaces(): any {
  return {
    data: {
      hostName: 'esxi-01.demo.local',
      source: 'esxi',
      defaultDevice: 'vmk1',
      vnics: [
        { device: 'vmk0', address: '10.10.10.60', subnetMask: '255.255.255.0', portgroup: 'Management Network', mtu: 1500, services: ['management'] },
        { device: 'vmk1', address: '10.40.10.60', subnetMask: '255.255.255.0', portgroup: 'Backup', mtu: 9000, services: ['vSphereBackupNFC'] },
      ],
    },
  }
}

const HOST_TAGS = (node: string) => {
  const n = Number(node.split('-').pop())

  if (node.startsWith('pve-dr-')) return 'gra'

  return [n <= 6 ? 'rack-a' : 'rack-b', ...(n <= 2 ? ['gpu'] : [])].join(';')
}

function hostsList(connFilter: string | null): any {
  const conns = CONNECTIONS.filter(c => c.type === 'pve' && (!connFilter || connFilter === '*' || c.id === connFilter))
  const fmt = (b: number) => `${(b / 1024 ** 3).toFixed(1)} GiB`
  const hosts = conns.flatMap(c => hostsOf(c.id).map((h, i) => {
    const n = PROD_NODES.find(x => x.node === h.node) || { cpu: 0.12 + i * 0.03, mem: 101 * GiB + i * 4 * GiB, maxmem: 251.6 * GiB, disk: 9 * GiB, maxdisk: 19.5 * GiB, uptime: 9_800_000 + i * 3600 }
    const days = Math.floor(n.uptime / DAY)

    return {
      id: `${c.id}:${h.node}`,
      connId: c.id,
      connectionName: c.name,
      scope: 'cluster',
      node: h.node,
      status: 'online',
      cpu: Math.round(n.cpu * 1000) / 10,
      cpuCores: 0,
      ram: Math.round((n.mem / n.maxmem) * 1000) / 10,
      ramUsed: n.mem,
      ramMax: n.maxmem,
      ramUsedFormatted: fmt(n.mem),
      ramMaxFormatted: fmt(n.maxmem),
      disk: Math.round((n.disk / n.maxdisk) * 1000) / 10,
      diskUsed: n.disk,
      diskMax: n.maxdisk,
      diskUsedFormatted: fmt(n.disk),
      diskMaxFormatted: fmt(n.maxdisk),
      uptime: n.uptime,
      uptimeFormatted: `${days}d ${Math.floor((n.uptime % DAY) / HOUR)}h`,
      tags: HOST_TAGS(h.node),
    }
  })).sort((a, b) => a.node.localeCompare(b.node))

  return { data: { hosts, stats: { total: hosts.length, online: hosts.length, offline: 0 } } }
}

const TASK_LOGS: Record<string, (id: string, node: string) => string[]> = {
  vzdump: id => [
    `INFO: starting new backup job: vzdump ${id} --storage PBS_MASTER --mode snapshot --notes-template '{{guestname}}'`,
    `INFO: Starting Backup of VM ${id} (qemu)`,
    'INFO: status = running',
    'INFO: backup mode: snapshot',
    'INFO: creating Proxmox Backup Server archive \'vm/' + id + '\'',
    'INFO: using fast incremental mode (dirty-bitmap), 2.1 GiB dirty of 32.0 GiB total',
    'INFO: 100% (2.1 GiB of 2.1 GiB) in 21s, read: 102.4 MiB/s, write: 98.7 MiB/s',
    'INFO: backup was done incrementally, reused 29.9 GiB (93%)',
    `INFO: Finished Backup of VM ${id} (00:00:24)`,
    'INFO: Backup job finished successfully',
    'TASK OK',
  ],
  qmigrate: (id, node) => [
    `${new Date().toISOString().slice(0, 10)} starting migration of VM ${id} to node '${node === 'pve-node-04' ? 'pve-node-05' : 'pve-node-04'}'`,
    'starting VM on remote node',
    'start remote tunnel',
    'starting online/live migration',
    'migration active, transferred 2.1 GiB of 8.0 GiB VM-state, 1.1 GiB/s',
    'migration active, transferred 6.4 GiB of 8.0 GiB VM-state, 1.1 GiB/s',
    'average migration speed: 1.1 GiB/s - downtime 41 ms',
    'migration status: completed',
    'TASK OK',
  ],
}

// UPIDs of GET /tasks/running (demo-api.ts), still running for this many seconds.
const RUNNING_TASKS: Record<string, number> = {
  'UPID:pve-node-03:0001A2B3:0C4D5E6F:68C0D1E2:qmigrate:103:admin@pam:': 240,
  'UPID:pve-node-08:0002C3D4:0E5F6071:68C0D1F0:vzdump:117:root@pam:': 95,
}

// useTaskDetail (task drawer): the route's flat response, parsed from the UPID.
function taskDetail(node: string, upid: string): any {
  const parts = upid.split(':')

  if (parts[0] !== 'UPID' || parts.length < 8) return null
  const type = parts[5]
  const id = parts[6]
  const user = parts[7]
  const now = nowSec()
  const runningFor = RUNNING_TASKS[upid]
  const running = runningFor !== undefined
  const start = running ? now - runningFor : Number.parseInt(parts[4], 16) || hourBucket()
  const lines = (TASK_LOGS[type] || (() => [`${type} ${id}`, 'TASK OK']))(id, node)
  const shown = running ? lines.slice(0, Math.ceil(lines.length / 2)) : lines
  const end = running ? null : start + 24 + (Number(id) % 40)
  const dur = (end ?? now) - start

  return {
    upid,
    node,
    type,
    id: id || null,
    user,
    status: running ? 'running' : 'stopped',
    exitstatus: running ? null : 'OK',
    failureReason: null,
    starttime: start,
    endtime: end,
    duration: fmtDuration(dur),
    durationSec: dur,
    progress: running ? 55 : 100,
    message: running ? 'In progress' : 'Completed successfully',
    speed: running ? '1.1 GiB/s' : '',
    eta: running ? '2m' : '',
    totalLogLines: shown.length,
    logs: shown.map((t, i) => ({ n: i + 1, t })),
  }
}

// SharedTaskDetailDialog: the shared task of GET /tasks/shared plus its logs.
function sharedTaskDetail(id: string): any {
  if (id !== 'demo-shared-001') return null
  const now = Date.now()
  const started = now - 10 * 60 * 1000

  return {
    data: {
      id,
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
      bytesTransferred: 16 * GiB,
      totalBytes: 42 * GiB,
      transferSpeed: '412 MB/s',
      error: null,
      isMine: true,
      createdByName: 'Admin Demo',
      createdAt: new Date(now - 11 * 60 * 1000).toISOString(),
      startedAt: new Date(started).toISOString(),
      completedAt: null,
      logs: [
        { ts: new Date(started).toISOString(), msg: 'Preflight checks passed', level: 'info', progress: 2 },
        { ts: new Date(started + 40_000).toISOString(), msg: 'Created VM 5102 on pve-dr-01', level: 'info', progress: 5 },
        { ts: new Date(started + 60_000).toISOString(), msg: 'Disk 1/2 (scsi0, 32 GiB) transferred', level: 'info', progress: 30 },
        { ts: new Date(started + 300_000).toISOString(), msg: 'Transferring disk 2/2 (scsi1, 10 GiB)', level: 'info', progress: 38 },
      ],
    },
  }
}

export const INVENTORY_MOCKS: DemoMockMap = {
  'GET:/api/v1/clusters': clustersList(),
  [`GET:/api/v1/connections/${PROD}/cluster/metrics/server`]: { data: METRIC_SERVERS.map(({ id, type, server, port, disable }) => ({ id, type, server, port, disable })) },
  [`GET:/api/v1/connections/${PROD}/cluster/notifications/targets`]: { data: NOTIFICATION_TARGETS },
  [`GET:/api/v1/connections/${PROD}/cluster/notifications/matchers`]: { data: NOTIFICATION_MATCHERS },
}

type Handler = (m: RegExpMatchArray, url: URL) => any

// GET handlers on paths carrying the original ids (per-connection answers).
const GET_ROUTES: [RegExp, Handler][] = [
  // useHA reads `data` as the guest's HA resource; the aggregate /ha mock lists
  // none, so every guest is unmanaged (the route answers null for a missing sid).
  [/^\/api\/v1\/connections\/[^/]+\/ha\/(vm|ct)(:|%3A)\d+$/i, () => ({ data: null })],
  [/^\/api\/v1\/connections\/([^/]+)\/cluster\/config$/, m => clusterConfig(m[1])],
  [/^\/api\/v1\/connections\/([^/]+)\/cluster\/mapping\/([^/]+)$/, m => clusterMappings(m[1], m[2])],
  [/^\/api\/v1\/connections\/[^/]+\/cluster\/metrics\/server\/([^/]+)$/, m => {
    const server = METRIC_SERVERS.find(s => s.id === decodeURIComponent(m[1]))

    return { data: server || {} }
  }],
  [/^\/api\/v1\/connections\/[^/]+\/cluster\/notifications\/endpoints\/([^/]+)\/([^/]+)$/, m => ({
    data: NOTIFICATION_TARGETS.find(t => t.type === m[1] && t.name === decodeURIComponent(m[2])) || {},
  })],
  [/^\/api\/v1\/connections\/[^/]+\/cluster\/notifications\/matchers\/([^/]+)$/, m => ({
    data: NOTIFICATION_MATCHERS.find(x => x.name === decodeURIComponent(m[1])) || {},
  })],
  [/^\/api\/v1\/connections\/([^/]+)\/cluster\/nextid$/, (m, url) => nextId(m[1], url)],
  [/^\/api\/v1\/connections\/([^/]+)\/diagnostics$/, m => diagnostics(decodeURIComponent(m[1]))],
  [/^\/api\/v1\/connections\/([^/]+)\/fingerprint$/, m => fingerprint(decodeURIComponent(m[1]))],
  [/^\/api\/v1\/connections\/([^/]+)\/ha\/auto-ha$/, m => ({
    data: { enabled: !isDr(m[1]), state: 'started', group: '', max_restart: 1, max_relocate: 1, comment: 'Auto-HA' },
  })],
  [/^\/api\/v1\/connections\/([^/]+)\/snapshots$/, (m, url) => bulkSnapshots(m[1], url.searchParams.get('node'))],
  [/^\/api\/v1\/connections\/([^/]+)\/guests\/(qemu|lxc)\/[^/]+\/(\d+)\/guest$/, m => guestAgent(m[1], m[2], Number(m[3]))],
  [/^\/api\/v1\/connections\/[^/]+\/guests\/(?:qemu|lxc)\/[^/]+\/\d+\/migrate\/pending-check$/, () => ({ data: { changes: [] } })],
  // Guests sit on shared Ceph: snapshots never block a live or offline migration.
  [/^\/api\/v1\/connections\/[^/]+\/guests\/(?:qemu|lxc)\/[^/]+\/\d+\/migrate\/snapshot-check$/, () => ({ data: { live: [], offline: [] } })],
  // InventoryDetails reads the lock state of the selected guest.
  [/^\/api\/v1\/connections\/[^/]+\/guests\/(?:qemu|lxc)\/[^/]+\/\d+\/unlock$/, () => ({ data: { locked: false, lockType: null } })],
  // MigrateVmDialog (cross-cluster tab): flat prerequisites of the source guest.
  [/^\/api\/v1\/connections\/([^/]+)\/guests\/qemu\/[^/]+\/(\d+)\/remote-migrate\/prepare$/, m => {
    const g = findGuest(m[1], m[2])

    return { ha: null, replication: [], snapshots: guestSnapshots(Number(m[2]), g?.name || '').map(s => s.name), siteRecoveryJobs: [] }
  }],
  // useDiskSnapshotRefs: snapshots still referencing the disk volume.
  [/^\/api\/v1\/connections\/([^/]+)\/guests\/(?:qemu|lxc)\/[^/]+\/(\d+)\/disk\/snapshot-refs$/, (m, url) => {
    const disk = url.searchParams.get('disk') || ''
    const g = findGuest(m[1], m[2])
    const isRoot = /^(scsi0|rootfs|virtio0)$/.test(disk)

    return { data: { volid: isRoot ? `CephStoragePool:vm-${m[2]}-disk-0` : null, snapshots: isRoot ? guestSnapshots(Number(m[2]), g?.name || '').map(s => s.name) : [] } }
  }],
  [/^\/api\/v1\/connections\/[^/]+\/sdn\/status$/, () => sdnStatus()],
  [/^\/api\/v1\/connections\/([^/]+)\/sdn\/zones$/, m => ({ data: { zones: sdnZones(m[1]) } })],
  [/^\/api\/v1\/connections\/([^/]+)\/sdn\/vnets$/, m => ({ data: { vnets: sdnVnets(m[1]) } })],
  [/^\/api\/v1\/connections\/[^/]+\/sdn\/controllers$/, () => ({ data: { controllers: [] } })],
  [/^\/api\/v1\/connections\/[^/]+\/sdn\/dns$/, () => ({ data: { dns: [] } })],
  [/^\/api\/v1\/connections\/[^/]+\/sdn\/ipams$/, () => ({ data: { ipams: [{ ipam: 'pve', type: 'pve' }] } })],
  // Fabrics need PVE 9; the demo clusters run 8.4.1.
  [/^\/api\/v1\/connections\/[^/]+\/sdn\/fabrics$/, () => ({ data: { unavailable: true, reason: 'pve-version' } })],
  [/^\/api\/v1\/connections\/([^/]+)\/sdn\/ipams\/([^/]+)\/status$/, m => ({ data: { allocations: m[2] === 'pve' ? ipamAllocations(m[1]) : [] } })],
  [/^\/api\/v1\/connections\/[^/]+\/sdn\/vnets\/([^/]+)\/firewall\/rules$/, m => ({ data: { rules: vnetFirewallRules(decodeURIComponent(m[1])) } })],
  [/^\/api\/v1\/connections\/([^/]+)\/networks$/, m => connectionNetworks(m[1])],
  [/^\/api\/v1\/connections\/([^/]+)\/network-choices$/, m => networkChoices(m[1])],
  [/^\/api\/v1\/connections\/([^/]+)\/nodes\/([^/]+)\/network$/, m => ({ data: nodeNetwork(m[1], decodeURIComponent(m[2])) })],
  [/^\/api\/v1\/connections\/([^/]+)\/nodes\/([^/]+)\/storages$/, (m, url) => ({ data: nodeStorages(m[1], decodeURIComponent(m[2]), url) })],
  [/^\/api\/v1\/connections\/[^/]+\/nodes\/[^/]+\/check-sshfs$/, () => ({ data: { installed: true } })],
  [/^\/api\/v1\/firewall$/, (_m, url) => firewallStatus(url.searchParams.get('connectionId') || PROD)],
  [/^\/api\/v1\/firewall\/logs\/([^/]+)$/, (m, url) => firewallLog(m[1], url)],
  [/^\/api\/v1\/firewall\/microseg\/([^/]+)\/analyze$/, m => microsegAnalysis(m[1])],
  [/^\/api\/v1\/firewall\/microseg\/([^/]+)\/vms$/, (m, url) => microsegVms(m[1], url.searchParams.get('network'))],
  [/^\/api\/v1\/firewall\/microseg\/([^/]+)\/vm\/[^/]+\/(?:qemu|lxc)\/(\d+)$/, m => microsegVmStatus(m[1], Number(m[2]))],
  [/^\/api\/v1\/firewall\/microseg\/([^/]+)\/vm\/[^/]+\/(?:qemu|lxc)\/(\d+)\/simulate$/, m => microsegSimulation(m[1], Number(m[2]))],
  // lib/api/firewall getVMFirewallLog: PVE log lines { n, t }.
  [/^\/api\/v1\/firewall\/vms\/([^/]+)\/[^/]+\/(?:qemu|lxc)\/(\d+)\/log$/, (m, url) => firewallLog(m[1], new URL(`http://demo/?scope=vm&vmid=${m[2]}&window=3600`)).rows
    .slice(0, Number(url.searchParams.get('limit')) || 50)
    .map((r: any, i: number) => ({ n: i + 1, t: r.raw }))],
  [/^\/api\/v1\/cve\/([^/]+)$/, (m, url) => cveScan(decodeURIComponent(m[1]), url.searchParams.get('node'))],
  // The list leaves the logs out and narrows to one source VM; the job read
  // sends the log lines past ?after= (migrations/route.ts, migrations/[id]/route.ts).
  [/^\/api\/v1\/migrations$/, (_m, url) => {
    const vm = url.searchParams.get('sourceVmId')
    const conn = url.searchParams.get('sourceConnectionId')

    return {
      data: migrationJobs()
        .filter(j => (!vm || j.sourceVmId === vm) && (!conn || j.sourceConnectionId === conn))
        .map(({ logs: _logs, ...job }) => job),
    }
  }],
  [/^\/api\/v1\/migrations\/stats$/, () => migrationStats()],
  [/^\/api\/v1\/migrations\/(demo-mig-\d+)$/, (m, url) => {
    const job = migrationJobs().find(j => j.id === m[1])

    return job ? { data: { ...job, ...sliceJobLogs(job.logs, parseLogOffset(url.searchParams.get('after'))) } } : null
  }],
  [/^\/api\/v1\/vmware\/demo-esxi-001\/vms\/([^/]+)$/, m => vmwareVmDetail(decodeURIComponent(m[1]))],
  [/^\/api\/v1\/vmware\/demo-esxi-001\/vms\/[^/]+\/copy-interfaces$/, () => vmwareCopyInterfaces()],
  [/^\/api\/v1\/hosts$/, (_m, url) => hostsList(url.searchParams.get('connId'))],
  [/^\/api\/v1\/tags$/, () => ({ data: ['gpu', 'gra', 'rack-a', 'rack-b'] })],
  [/^\/api\/v1\/tasks\/shared\/([^/]+)$/, m => sharedTaskDetail(decodeURIComponent(m[1]))],
  [/^\/api\/v1\/tasks\/[^/]+\/([^/]+)\/([^/]+)$/, m => taskDetail(decodeURIComponent(m[1]), decodeURIComponent(m[2]))],
  [/^\/api\/v1\/guests\/(\d+)\/backups$/, (m, url) => guestBackups(Number(m[1]), url)],
  [/^\/api\/v1\/guests\/([^/]+)\/(snapshots|notes|features|tasks)$/, m => {
    const key = parseVmKey(m[1])

    if (!key) return null
    if (m[2] === 'features') return { data: { hasFeature: true } }
    if (m[2] === 'notes') return guestNotes(key.connId, key.vmid)
    if (m[2] === 'tasks') {
      const tasks = guestTasks(key.node, key.vmid, key.type)

      return { data: { tasks, count: tasks.length } }
    }
    const g = findGuest(key.connId, key.vmid)
    const snapshots = guestSnapshots(key.vmid, g?.name || '')

    return { data: { snapshots, count: snapshots.length } }
  }],
]

export const resolveInventoryMock: DemoMockResolver = (method, cleanPath, url) => {
  if (method === 'GET') {
    for (const [re, handler] of GET_ROUTES) {
      const m = cleanPath.match(re)

      if (m) return handler(m, url)
    }
  }
  // CveTab "Scan now" POSTs and shows the fresh result.
  if (method === 'POST') {
    const m = cleanPath.match(/^\/api\/v1\/cve\/([^/]+)$/)

    if (m) return cveScan(decodeURIComponent(m[1]), url.searchParams.get('node'))
  }

  return null
}

