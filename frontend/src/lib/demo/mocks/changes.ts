/**
 * Demo change journal (/operations/changes, the guest Changes tab, the
 * navbar dropdown). See ./index.ts for the contract.
 *
 * Rows follow the orchestrator tracker (internal/changes/tracker.go): the
 * action comes from the changed fields (`_node` migrated, `snapshots`
 * snapshot_*, scsi/memory/cores hardware, net/ipconfig network, else config),
 * a creation or a deletion carries the whole config, and a backup carries its
 * vzdump task and the snapshot trace it left. Without `fields` a row cannot
 * be expanded, which is what made the old flat seed look dead.
 */

import mockData from '../mock-data.json'

import type { DemoMockMap, DemoMockResolver } from './index'

const DAY = 86_400_000
const HOUR = 3_600_000
const MIN = 60_000

const PROD = 'demo-pve-cluster-001'
const PROD_NAME = 'Production Cluster'

type Field = { field: string; oldValue: string; newValue: string }

type Guest = { vmid: number; name: string; node: string; maxmem: number }

type Draft = {
  at: number
  guest: Guest
  action: string
  user: string
  fields: Field[]
  source?: string
  node?: string
  task?: { upid: string; start: number; end: number; status: string }
}

const USERS = ['root@pam', 'alice@pve', 'admin@pve', 'bob@pve']

const GUESTS: Guest[] = ((mockData as any)[`/api/v1/connections/${PROD}/resources`]?.data ?? [])
  .filter((r: any) => r.type === 'qemu' && !r.template)
  .map((r: any) => ({ vmid: Number(r.vmid), name: r.name, node: r.node, maxmem: Number(r.maxmem) || 4 * 1024 ** 3 }))

const NODES = [...new Set(GUESTS.map(g => g.node))].sort((a, b) => a.localeCompare(b))

// Deterministic 0..1 from an integer, so a poll never reshuffles the journal.
const rand = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453

  return x - Math.floor(x)
}

const pick = <T,>(list: readonly T[], n: number): T => list[Math.floor(rand(n) * list.length) % list.length]

const mib = (g: Guest) => String(Math.round(g.maxmem / 1024 ** 2))

const mac = (vmid: number) => `BC:24:11:${(vmid >> 8).toString(16).padStart(2, '0')}:${(vmid & 255).toString(16).padStart(2, '0')}:2A`.toUpperCase()

const upid = (node: string, at: number, type: string, vmid: number) =>
  `UPID:${node}:000${(1000 + (vmid % 900)).toString(16).toUpperCase()}:00${(at / 1000 % 0xffffff | 0).toString(16).toUpperCase()}:${Math.floor(at / 1000).toString(16).toUpperCase()}:${type}:${vmid}:root@pam:`

/** The config a creation lists, or a deletion listed. */
function wholeConfig(g: Guest, side: 'old' | 'new'): Field[] {
  const cfg: [string, string][] = [
    ['agent', '1'],
    ['boot', 'order=scsi0;net0'],
    ['cores', '2'],
    ['cpu', 'x86-64-v2-AES'],
    ['memory', mib(g)],
    ['name', g.name],
    ['net0', `virtio=${mac(g.vmid)},bridge=vmbr0,firewall=1`],
    ['ostype', 'l26'],
    ['scsi0', `CephStoragePool:vm-${g.vmid}-disk-0,iothread=1,size=32G`],
    ['scsihw', 'virtio-scsi-single'],
  ]

  return cfg.map(([field, v]) => ({ field, oldValue: side === 'old' ? v : '', newValue: side === 'new' ? v : '' }))
}

// One template per kind of change; `n` seeds the values.
const TEMPLATES: { weight: number; build: (g: Guest, n: number, at: number) => Omit<Draft, 'at' | 'guest' | 'user'> }[] = [
  { weight: 5, build: g => ({ action: 'hardware_changed', fields: [{ field: 'memory', oldValue: mib(g), newValue: String(Number(mib(g)) * 2) }] }) },
  { weight: 4, build: (_g, n) => ({ action: 'hardware_changed', fields: [{ field: 'cores', oldValue: String(2 + (n % 2) * 2), newValue: String(4 + (n % 2) * 4) }] }) },
  {
    weight: 3,
    build: (g, n) => ({
      action: 'hardware_changed',
      fields: [{ field: 'scsi0', oldValue: `CephStoragePool:vm-${g.vmid}-disk-0,iothread=1,size=32G`, newValue: `CephStoragePool:vm-${g.vmid}-disk-0,iothread=1,size=${48 + (n % 3) * 16}G` }],
    }),
  },
  { weight: 2, build: g => ({ action: 'hardware_changed', fields: [{ field: 'scsi1', oldValue: '', newValue: `CephStoragePool:vm-${g.vmid}-disk-1,iothread=1,size=100G` }] }) },
  {
    weight: 3,
    build: (g, n) => ({
      action: 'network_changed',
      fields: [{ field: 'net0', oldValue: `virtio=${mac(g.vmid)},bridge=vmbr0,firewall=1`, newValue: `virtio=${mac(g.vmid)},bridge=vmbr0,firewall=1,tag=${[20, 30, 110][n % 3]}` }],
    }),
  },
  { weight: 2, build: g => ({ action: 'network_changed', fields: [{ field: 'net1', oldValue: '', newValue: `virtio=${mac(g.vmid + 1)},bridge=vmbr1,firewall=1` }] }) },
  { weight: 3, build: (_g, n) => ({ action: 'config_changed', fields: [{ field: 'tags', oldValue: 'prod', newValue: ['prod;critical', 'prod;pci-dss', 'prod;backup-daily'][n % 3] }] }) },
  { weight: 2, build: () => ({ action: 'config_changed', fields: [{ field: 'onboot', oldValue: '0', newValue: '1' }, { field: 'startup', oldValue: '', newValue: 'order=2,up=30' }] }) },
  { weight: 2, build: g => ({ action: 'config_changed', fields: [{ field: 'description', oldValue: '', newValue: `${g.name}: owner team-infra, ticket OPS-${4100 + (g.vmid % 300)}` }] }) },
  { weight: 1, build: () => ({ action: 'config_changed', fields: [{ field: 'protection', oldValue: '0', newValue: '1' }] }) },
  { weight: 4, build: (_g, n, at) => ({ action: 'snapshot_created', fields: [{ field: 'snapshots', oldValue: '', newValue: `${['pre-upgrade', 'before-patch', 'pre-migration'][n % 3]}-${new Date(at).toISOString().slice(0, 10).replaceAll('-', '')}` }] }) },
  { weight: 3, build: (_g, n) => ({ action: 'snapshot_deleted', fields: [{ field: 'snapshots', oldValue: `${['pre-upgrade', 'before-patch'][n % 2]}-202609${String(10 + (n % 18)).padStart(2, '0')}`, newValue: '' }] }) },
  { weight: 1, build: (_g, n) => ({ action: 'snapshot_modified', fields: [{ field: 'snapshots', oldValue: `weekly-202609${String(10 + (n % 18)).padStart(2, '0')}`, newValue: `weekly-202610${String(1 + (n % 20)).padStart(2, '0')}` }] }) },
]

const TOTAL_WEIGHT = TEMPLATES.reduce((s, t) => s + t.weight, 0)

function template(n: number) {
  let r = rand(n) * TOTAL_WEIGHT

  for (const t of TEMPLATES) {
    r -= t.weight
    if (r < 0) return t
  }

  return TEMPLATES[0]
}

function migration(g: Guest, n: number, at: number): Draft {
  // The guest ends on the node the inventory shows, so the last move lands there.
  const from = pick(NODES.filter(x => x !== g.node), n)
  const start = at - 90_000

  return {
    at, guest: g, action: 'migrated', user: n % 3 === 0 ? 'root@pam' : pick(USERS, n), node: g.node, source: 'task_event',
    fields: [{ field: '_node', oldValue: from, newValue: g.node }],
    task: { upid: upid(from, start, 'qmigrate', g.vmid), start, end: at, status: 'OK' },
  }
}

function backup(g: Guest, day: number, i: number): Draft {
  const start = day + 2 * HOUR + i * 7 * MIN
  const end = start + (4 + (g.vmid % 9)) * MIN + (g.vmid % 50) * 1000
  const failed = rand(day / DAY + g.vmid) < 0.06

  return {
    at: end, guest: g, action: 'backup', user: 'root@pam', source: 'config_poll',
    fields: [{ field: 'snapshots', oldValue: '', newValue: 'vzdump' }, { field: 'snapshots', oldValue: 'vzdump', newValue: '' }],
    task: { upid: upid(g.node, start, 'vzdump', g.vmid), start, end, status: failed ? 'job errors' : 'OK' },
  }
}

/** The journal at a given instant: 30 days, newest first, stable within a day. */
export function demoChangeJournal(now = Date.now()): any[] {
  if (GUESTS.length === 0) return []

  const today = now - (now % DAY)
  const drafts: Draft[] = []

  for (let d = 0; d < 30; d++) {
    const day = today - d * DAY
    const seed = Math.floor(day / DAY)

    // The nightly job's trace on a few guests (the journal keeps one row per guest).
    for (let i = 0; i < 2; i++) drafts.push(backup(pick(GUESTS, seed * 7 + i), day, i))

    const weekend = new Date(day).getUTCDay() % 6 === 0
    const count = weekend ? 1 : 3 + Math.floor(rand(seed) * 3)

    for (let k = 0; k < count; k++) {
      const n = seed * 31 + k
      const g = pick(GUESTS, n * 3)
      const at = day + (8 + Math.floor(rand(n + 5) * 10)) * HOUR + Math.floor(rand(n + 9) * 59) * MIN

      if (rand(n + 13) < 0.12) {
        drafts.push(migration(g, n, at))
        continue
      }

      const t = template(n + 17).build(g, n, at)

      drafts.push({ at, guest: g, user: pick(USERS, n + 21), ...t })

      // Maintenance windows come as bursts: more edits on the same guest within minutes.
      if (rand(n + 29) < 0.25) {
        drafts.push({ at: at + 2 * MIN, guest: g, user: pick(USERS, n + 21), ...TEMPLATES[1].build(g, n, at) })
        drafts.push({ at: at + 3 * MIN, guest: g, user: pick(USERS, n + 21), ...TEMPLATES[4].build(g, n, at) })
      }
    }

    // A guest provisioned now and then, and one decommissioned.
    if (d === 3 || d === 17) {
      const g = pick(GUESTS, seed * 11)

      drafts.push({ at: day + 10 * HOUR + 12 * MIN, guest: g, action: 'created', user: 'alice@pve', fields: wholeConfig(g, 'new'), source: 'task_event' })
    }

    if (d === 9) {
      const gone: Guest = { vmid: 199, name: 'legacy-crm-01', node: 'pve-node-07', maxmem: 8 * 1024 ** 3 }

      drafts.push({ at: day + 16 * HOUR + 40 * MIN, guest: gone, action: 'deleted', user: 'admin@pve', fields: wholeConfig(gone, 'old'), source: 'task_event' })
    }
  }

  return drafts
    .filter(c => c.at <= now)
    .sort((a, b) => b.at - a.at)
    .map((c, i, all) => ({
      id: all.length - i,
      timestamp: new Date(c.at).toISOString(),
      connectionId: PROD,
      connectionName: PROD_NAME,
      resourceType: 'vm',
      resourceId: String(c.guest.vmid),
      resourceName: c.guest.name,
      node: c.node ?? c.guest.node,
      action: c.action,
      user: c.user,
      fields: c.fields,
      source: c.source ?? 'config_poll',
      pool: null,
      ...(c.task
        ? { taskUpid: c.task.upid, taskStart: new Date(c.task.start).toISOString(), taskEnd: new Date(c.task.end).toISOString(), taskStatus: c.task.status }
        : {}),
    }))
}

/** GET /changes filters and limit, as handler_changes.go and GetChanges apply them. */
export function queryChanges(url: URL, now = Date.now()) {
  const q = url.searchParams
  let limit = Number.parseInt(q.get('limit') || '', 10)

  if (!(limit > 0) || limit > 500) limit = 200

  const from = q.get('from') ? Date.parse(q.get('from')!) : Number.NaN
  const to = q.get('to') ? Date.parse(q.get('to')!) : Number.NaN
  const eq = (key: string, value: unknown) => !q.get(key) || q.get(key) === String(value)

  const data = demoChangeJournal(now)
    .filter(c => eq('resourceType', c.resourceType) && eq('connectionId', c.connectionId) && eq('action', c.action) && eq('resourceId', c.resourceId) && eq('node', c.node))
    .filter(c => (Number.isNaN(from) || Date.parse(c.timestamp) >= from) && (Number.isNaN(to) || Date.parse(c.timestamp) <= to))
    .slice(0, limit)

  return { data, total: data.length }
}

export const CHANGES_MOCKS: DemoMockMap = {}

export const resolveChangesMock: DemoMockResolver = (method, cleanPath, url) => {
  if (method !== 'GET') return null

  if (cleanPath === '/api/v1/changes') return queryChanges(url)

  if (cleanPath === '/api/v1/changes/recent') {
    const limit = Number.parseInt(url.searchParams.get('limit') || '', 10) || 10

    return { data: demoChangeJournal().slice(0, limit > 0 && limit <= 500 ? limit : 200) }
  }

  return null
}
