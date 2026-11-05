/**
 * Demo micro-segmentation (the Micro-segmentation tab of /automation/network).
 * See ./index.ts for the contract.
 *
 * One policy on the production cluster: five zones holding 22 of its guests (picked from the demo inventory by
 * vmid, tagged `zone-<name>` and given an address on the zone subnet through GET /api/v1/vms), the flows allowed
 * between them, what the engine observed (would-block in the zone still observed, blocked in the enforced ones),
 * three drifts, two revisions, the latest runs and a pre-flight with one warning. The shapes follow
 * lib/microseg/types.ts, which follows the orchestrator (internal/microseg).
 *
 * A write answers 403 FORBIDDEN "Action disabled in demo mode", like the demo's other locked mutations: the generic
 * no-op answer has none of the fields (run_id, version) the tab reads back.
 */

import mockData from '../mock-data.json'

import type { DemoMockMap, DemoMockResolver } from './index'

const PROD = 'demo-pve-cluster-001'
const POLICY_ID = 'demo-microseg-policy'
const TAG_PREFIX = 'zone-'
const AUTHOR = 'admin@demo.proxcenter.io'
const HOUR = 3_600_000
const DAY = 24 * HOUR

type ZoneState = 'disabled' | 'observe' | 'enforce'

type DemoZone = { id: string; name: string; label: string; color: string; state: ZoneState; observeDays: number; octet: number; vmids: number[] }

// Members are picked by vmid from the demo inventory (mock-data.json); `octet` is the third byte of the zone subnet.
const ZONES: DemoZone[] = [
  { id: 'demo-zone-web', name: 'web', label: 'Web tier', color: '#3b82f6', state: 'enforce', observeDays: 9, octet: 10, vmids: [100, 101, 102, 104, 108] },
  { id: 'demo-zone-app', name: 'app', label: 'Applications', color: '#10b981', state: 'enforce', observeDays: 9, octet: 20, vmids: [151, 152, 153, 155, 161, 162] },
  { id: 'demo-zone-db', name: 'db', label: 'Databases', color: '#f59e0b', state: 'enforce', observeDays: 9, octet: 30, vmids: [112, 113, 115, 118, 122] },
  { id: 'demo-zone-monitoring', name: 'monitoring', label: 'Monitoring', color: '#8b5cf6', state: 'observe', observeDays: 2, octet: 40, vmids: [131, 133, 134] },
  { id: 'demo-zone-infra', name: 'infra', label: 'Infrastructure services', color: '#64748b', state: 'disabled', observeDays: 0, octet: 50, vmids: [139, 146, 148] },
]

// A running guest of the app subnet that is in no zone: the "unzoned" drift.
const UNZONED = { vmid: 154, octet: 20 }

const zoneByName = (name: string) => ZONES.find(z => z.name === name)!

const GUESTS: Record<number, { name: string; node: string; type: 'qemu' | 'lxc'; running: boolean }> = {}
let RUNNING = 0

for (const r of ((mockData as any)[`/api/v1/connections/${PROD}/resources`]?.data ?? []) as any[]) {
  if ((r.type !== 'qemu' && r.type !== 'lxc') || r.template) continue
  GUESTS[Number(r.vmid)] = { name: r.name, node: r.node, type: r.type, running: r.status === 'running' }
  if (r.status === 'running') RUNNING += 1
}

const ipOf = (vmid: number, octet: number) => `10.20.${octet}.${(vmid % 250) + 1}`

const zoneOfGuest = new Map<number, DemoZone>()

for (const z of ZONES) for (const vmid of z.vmids) zoneOfGuest.set(vmid, z)

/** Tags and addresses the demo gives a guest of the inventory: the zone tag of its zone and its address on the zone subnet. */
export function microsegGuestOverlay(vmid: number, tags: unknown): { tags: string[]; ips?: string[] } {
  const own = Array.isArray(tags) ? tags.filter((t): t is string => typeof t === 'string') : []
  const zone = zoneOfGuest.get(vmid)

  if (zone) return { tags: [...own, `${TAG_PREFIX}${zone.name}`], ips: [ipOf(vmid, zone.octet)] }
  if (vmid === UNZONED.vmid) return { tags: own, ips: [ipOf(vmid, UNZONED.octet)] }

  return { tags: own }
}

const hourBucket = (now: number) => now - (now % HOUR)

// Outbound filtering: the app zone observes the local network and Internet, the others are off.
const egressOf = (z: DemoZone, now: number) => z.name === 'app'
  ? { egress_state: 'observe', egress_mode: 'all', egress_observe_since: new Date(hourBucket(now) - 2 * DAY).toISOString() }
  : { egress_state: 'off', egress_mode: 'local', egress_observe_since: null }

function zoneRows(now: number) {
  return ZONES.map(z => ({
    id: z.id, policy_id: POLICY_ID, name: z.name, label: z.label, color: z.color, enforcement: 'guest', vnet_id: '', state: z.state,
    isolate_members: z.name === 'db',
    observe_since: z.state === 'disabled' ? null : new Date(hourBucket(now) - z.observeDays * DAY).toISOString(),
    ...egressOf(z, now),
  }))
}

type FlowSeed = { id: string; src: string; srcCidr?: string; dst: string; proto: string; dport: string; comment: string; origin: 'manual' | 'learned'; by: string }

const FLOWS: FlowSeed[] = [
  { id: 'demo-flow-internet-web', src: '', srcCidr: '0.0.0.0/0', dst: 'web', proto: 'tcp', dport: '443', comment: 'Public HTTPS', origin: 'manual', by: AUTHOR },
  { id: 'demo-flow-web-app', src: 'web', dst: 'app', proto: 'tcp', dport: '8080', comment: 'Web to application servers', origin: 'manual', by: AUTHOR },
  { id: 'demo-flow-app-mysql', src: 'app', dst: 'db', proto: 'tcp', dport: '3306', comment: 'MySQL', origin: 'manual', by: AUTHOR },
  { id: 'demo-flow-app-pgsql', src: 'app', dst: 'db', proto: 'tcp', dport: '5432', comment: 'PostgreSQL', origin: 'manual', by: AUTHOR },
  { id: 'demo-flow-app-redis', src: 'app', dst: 'db', proto: 'tcp', dport: '6379', comment: '', origin: 'learned', by: 'alice@demo.proxcenter.io' },
  { id: 'demo-flow-app-dns', src: 'app', dst: 'infra', proto: 'udp', dport: '53', comment: 'DNS', origin: 'manual', by: AUTHOR },
  { id: 'demo-flow-app-ldap', src: 'app', dst: 'infra', proto: 'tcp', dport: '389', comment: '', origin: 'learned', by: 'alice@demo.proxcenter.io' },
  { id: 'demo-flow-mon-web', src: 'monitoring', dst: 'web', proto: 'tcp', dport: '9100', comment: 'Node exporter', origin: 'learned', by: 'alice@demo.proxcenter.io' },
  { id: 'demo-flow-mon-app', src: 'monitoring', dst: 'app', proto: 'tcp', dport: '9100', comment: 'Node exporter', origin: 'manual', by: AUTHOR },
]

const flowRows = (seeds: FlowSeed[] = FLOWS) => seeds.map(f => ({
  id: f.id, policy_id: POLICY_ID, src_zone_id: f.src ? zoneByName(f.src).id : '', src_cidr: f.srcCidr ?? '',
  dst_zone_id: zoneByName(f.dst).id, dst_cidr: '', proto: f.proto, dport: f.dport, comment: f.comment, origin: f.origin, created_by: f.by,
}))

const FIRST_REVISION_FLOWS = FLOWS.filter(f => ['demo-flow-web-app', 'demo-flow-app-mysql', 'demo-flow-app-pgsql'].includes(f.id))
const FIRST_REVISION_ZONES = ['web', 'app', 'db']

function revisions(now: number) {
  const zones = zoneRows(now)

  return [
    {
      id: 'demo-rev-2', version: 7, author: AUTHOR, created_at: new Date(hourBucket(now) - 3 * DAY).toISOString(),
      snapshot: { tag_prefix: TAG_PREFIX, zones, flows: flowRows() },
    },
    {
      id: 'demo-rev-1', version: 4, author: AUTHOR, created_at: new Date(hourBucket(now) - 12 * DAY).toISOString(),
      snapshot: { tag_prefix: TAG_PREFIX, zones: zones.filter(z => FIRST_REVISION_ZONES.includes(z.name)), flows: flowRows(FIRST_REVISION_FLOWS) },
    },
  ]
}

const withoutSnapshot = ({ snapshot: _snapshot, ...head }: ReturnType<typeof revisions>[number]) => head

function policy(now: number) {
  const [head] = revisions(now)

  return {
    policy: {
      id: POLICY_ID, connection_id: PROD, tag_prefix: TAG_PREFIX, version: 7, emergency_stop: false,
      settings: {
        light_interval_sec: 300, ips_interval_sec: 900, full_interval_sec: 1800, log_interval_sec: 60, ready_after_hours: 24, write_cap: 50,
        observe_log_rate_limit: '10/second', original_log_rate_limit: '1/second',
        notify_drift: true, notify_paused: true, notify_unprotected: true, notify_blocked: true,
      },
      created_at: new Date(hourBucket(now) - 14 * DAY).toISOString(),
      updated_at: head.created_at,
      updated_by: AUTHOR,
    },
    zones: zoneRows(now),
    flows: flowRows(),
    pending_members: [],
    last_revision: withoutSnapshot(head),
    version: 7,
    pending_changes: false,
  }
}

type SuggestionSeed = {
  id: string; kind: 'would_block' | 'blocked'; status: 'pending' | 'accepted' | 'dismissed'
  src: { zone: string; vmid: number } | { ip: string }; dst: { zone: string; vmid: number } | { ip: string } | { aggregate: string }
  direction?: 'out'
  proto: string; dport: string; hits: number; firstHours: number; lastHours: number
}

const SUGGESTIONS: SuggestionSeed[] = [
  { id: 'demo-sugg-1', kind: 'would_block', status: 'pending', src: { zone: 'monitoring', vmid: 131 }, dst: { zone: 'db', vmid: 112 }, proto: 'tcp', dport: '9104', hits: 1420, firstHours: 46, lastHours: 0 },
  { id: 'demo-sugg-2', kind: 'would_block', status: 'pending', src: { zone: 'monitoring', vmid: 133 }, dst: { zone: 'db', vmid: 115 }, proto: 'tcp', dport: '5432', hits: 310, firstHours: 40, lastHours: 1 },
  { id: 'demo-sugg-3', kind: 'would_block', status: 'pending', src: { zone: 'monitoring', vmid: 134 }, dst: { zone: 'web', vmid: 100 }, proto: 'tcp', dport: '443', hits: 96, firstHours: 30, lastHours: 2 },
  { id: 'demo-sugg-4', kind: 'blocked', status: 'pending', src: { zone: 'web', vmid: 100 }, dst: { zone: 'db', vmid: 112 }, proto: 'tcp', dport: '3306', hits: 37, firstHours: 20, lastHours: 3 },
  { id: 'demo-sugg-5', kind: 'blocked', status: 'pending', src: { ip: '192.168.1.57' }, dst: { zone: 'web', vmid: 101 }, proto: 'tcp', dport: '22', hits: 12, firstHours: 14, lastHours: 5 },
  { id: 'demo-sugg-6', kind: 'would_block', status: 'dismissed', src: { zone: 'monitoring', vmid: 131 }, dst: { zone: 'app', vmid: 152 }, proto: 'icmp', dport: '', hits: 58, firstHours: 44, lastHours: 8 },
  { id: 'demo-sugg-7', direction: 'out', kind: 'would_block', status: 'pending', src: { zone: 'app', vmid: 151 }, dst: { ip: '10.20.90.12' }, proto: 'tcp', dport: '3128', hits: 240, firstHours: 36, lastHours: 0 },
  { id: 'demo-sugg-8', direction: 'out', kind: 'would_block', status: 'pending', src: { zone: 'app', vmid: 152 }, dst: { ip: '151.101.1.69' }, proto: 'tcp', dport: '443', hits: 88, firstHours: 30, lastHours: 1 },
  { id: 'demo-sugg-9', direction: 'out', kind: 'would_block', status: 'pending', src: { zone: 'app', vmid: 155 }, dst: { aggregate: '0.0.0.0/0' }, proto: 'tcp', dport: '443', hits: 5120, firstHours: 44, lastHours: 0 },
]

function suggestionRow(s: SuggestionSeed, now: number) {
  const src = 'zone' in s.src ? { zone: zoneByName(s.src.zone), ip: ipOf(s.src.vmid, zoneByName(s.src.zone).octet) } : null
  const dst = 'zone' in s.dst
    ? { key: zoneByName(s.dst.zone).id, ip: ipOf(s.dst.vmid, zoneByName(s.dst.zone).octet), zoneId: zoneByName(s.dst.zone).id }
    : 'ip' in s.dst ? { key: s.dst.ip, ip: s.dst.ip, zoneId: '' } : { key: s.dst.aggregate, ip: '', zoneId: '' }

  return {
    id: s.id, policy_id: POLICY_ID, kind: s.kind,
    ...(s.direction ? { direction: s.direction } : {}),
    src_key: src ? src.zone.id : (s.src as { ip: string }).ip,
    src_ip: src ? src.ip : (s.src as { ip: string }).ip,
    src_zone_id: src ? src.zone.id : '',
    dst_key: dst.key,
    dst_ip: dst.ip,
    dst_zone_id: dst.zoneId,
    proto: s.proto, dport: s.dport, hits: s.hits,
    first_seen: new Date(hourBucket(now) - s.firstHours * HOUR).toISOString(),
    last_seen: new Date(hourBucket(now) - s.lastHours * HOUR).toISOString(),
    status: s.status,
  }
}

const guestRef = (vmid: number) => ({ node: GUESTS[vmid]?.node ?? 'pve-node-01', type: GUESTS[vmid]?.type ?? 'qemu', vmid })

const DRIFTS = [
  { kind: 'unzoned_running', guest: guestRef(UNZONED.vmid), detail: { name: GUESTS[UNZONED.vmid]?.name ?? 'app-prod-04' } },
  { kind: 'nic_firewall_off', guest: guestRef(153), detail: { name: GUESTS[153]?.name ?? 'app-prod-03', nics: ['net0'] } },
  { kind: 'foreign_accept', guest: guestRef(118), detail: { name: GUESTS[118]?.name ?? 'db-redis-prod-01', source: '10.0.0.0/8', proto: 'tcp', dport: '6379', pos: 3 } },
]

const CHECKS = [
  { id: 'cluster_firewall', status: 'pass' },
  { id: 'socle_rules', status: 'pass', detail: { web: true, ssh: true } },
  { id: 'log_ratelimit', status: 'warn', detail: { rate: '1/second' } },
  { id: 'self_in_zone', status: 'pass', detail: { self_ip: '10.20.60.5' } },
]

type RunSeed = { id: string; kind: string; status: 'done' | 'failed'; minutesAgo: number; ms: number; calls: number; writes: number; error?: string }

const RUNS: RunSeed[] = [
  { id: 'demo-run-1', kind: 'light', status: 'done', minutesAgo: 4, ms: 820, calls: 6, writes: 0 },
  { id: 'demo-run-2', kind: 'log', status: 'done', minutesAgo: 9, ms: 1_350, calls: 12, writes: 0 },
  { id: 'demo-run-3', kind: 'full', status: 'done', minutesAgo: 22, ms: 14_800, calls: 86, writes: 0 },
  { id: 'demo-run-4', kind: 'ips', status: 'done', minutesAgo: 41, ms: 3_900, calls: 34, writes: 0 },
  { id: 'demo-run-5', kind: 'apply', status: 'done', minutesAgo: 3 * 24 * 60, ms: 41_200, calls: 214, writes: 38 },
  { id: 'demo-run-6', kind: 'plan', status: 'done', minutesAgo: 3 * 24 * 60 + 12, ms: 9_600, calls: 71, writes: 0 },
  { id: 'demo-run-7', kind: 'apply', status: 'failed', minutesAgo: 12 * 24 * 60, ms: 22_100, calls: 131, writes: 17, error: 'Proxmox answered 500 while writing the firewall of node pve-node-03' },
]

function runRow(r: RunSeed, now: number) {
  return {
    id: r.id, policy_id: POLICY_ID, kind: r.kind, status: r.status,
    started_at: new Date(hourBucket(now) - r.minutesAgo * 60_000).toISOString(),
    duration_ms: r.ms, api_calls: r.calls, writes: r.writes, error: r.error ?? '',
  }
}

const step = (index: number, kind: string, object: string, summary: string, vmid?: number) => ({
  index, kind, object, summary, ...(vmid ? { guest: guestRef(vmid) } : {}),
})

function runResult(r: RunSeed) {
  const members = ZONES.reduce((n, z) => n + z.vmids.length, 0)

  if (r.kind === 'apply') {
    const done = [
      step(1, 'ipset.create', 'pxc-web', 'Create the IP set pxc-web'),
      step(2, 'group.create', 'pxc-app', 'Create the security group pxc-app'),
      step(3, 'guest.tags', 'qemu/100', 'Tag web-prod-01 with zone-web', 100),
    ]

    if (r.status === 'failed') {
      return {
        guests: members, members, steps: 41, done, drifts: 3, interrupted: true,
        failed: [step(4, 'guest.nic', 'qemu/101', 'Enable the NIC firewall of web-prod-02', 101)],
        not_run: [step(5, 'guest.enable', 'qemu/101', 'Enable the firewall of web-prod-02', 101)],
        errors: [r.error ?? ''],
      }
    }

    return { guests: members, members, steps: 41, done, drifts: 3, revision_id: 'demo-rev-2', complete: true }
  }

  if (r.kind === 'plan') return { guests: members, members, steps: 41, drifts: 3, version: 7, plan: [step(1, 'ipset.create', 'pxc-web', 'Create the IP set pxc-web')] }

  return { guests: members, members, steps: 0, drifts: 3, with_ips: members, events: r.kind === 'log' ? 1_920 : 0, suggestions: r.kind === 'log' ? 6 : 0 }
}

function lastRuns(now: number) {
  const out: Record<string, { started_at: string; status: string; api_calls: number; writes: number }> = {}

  // RUNS is newest first: the first run of a kind is its latest.
  for (const r of RUNS) {
    if (!(r.kind in out)) {
      const row = runRow(r, now)

      out[r.kind] = { started_at: row.started_at, status: row.status, api_calls: row.api_calls, writes: row.writes }
    }
  }

  return out
}

const LOG_NODES = [
  { node: 'pve-node-01', lines_last: 410, lines_per_min_15m: 380, lag_seconds: 12, full_pages_24h: 0 },
  { node: 'pve-node-02', lines_last: 365, lines_per_min_15m: 342, lag_seconds: 15, full_pages_24h: 0 },
  { node: 'pve-node-03', lines_last: 1000, lines_per_min_15m: 910, lag_seconds: 74, full_pages_24h: 6 },
]

function status(now: number) {
  const members = ZONES.reduce((n, z) => n + z.vmids.length, 0)
  const enforced = ZONES.filter(z => z.state === 'enforce').reduce((n, z) => n + z.vmids.length, 0)
  const count = (state: ZoneState) => ZONES.filter(z => z.state === state).length

  return {
    engine: { paused_until: null, held: false, check_pending: false, last_runs: lastRuns(now), last_log: runRow(RUNS[1], now).started_at },
    coverage: { running: RUNNING, zoned: members, members, protected: enforced },
    zones_by_state: { disabled: count('disabled'), observe: count('observe'), enforce: count('enforce') },
    emergency_stop: false,
    log_nodes: LOG_NODES,
  }
}

const page = (params: URLSearchParams, fallbackLimit: number, max: number) => {
  const limit = Math.min(Math.max(Number(params.get('limit')) || fallbackLimit, 1), max)
  const offset = Math.max(Number(params.get('offset')) || 0, 0)

  return { limit, offset }
}

export const MICROSEG_MOCKS: DemoMockMap = {}

const ROUTE = /^\/api\/v1\/firewall\/microseg\/[^/]+\/(policy|status|drifts|preflight|suggestions|runs|revisions)(?:\/([^/]+))?$/

const WRITE_ROUTE = /^\/api\/v1\/firewall\/microseg\/[^/]+\//

export const resolveMicrosegMock: DemoMockResolver = (method, cleanPath, url) => {
  if (method !== 'GET') {
    return WRITE_ROUTE.test(cleanPath)
      ? new Response(JSON.stringify({ code: 'FORBIDDEN', error: 'Action disabled in demo mode' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
      : null
  }

  const match = ROUTE.exec(cleanPath)

  if (!match) return null

  const now = Date.now()
  const [, route, id] = match

  if (id) return route === 'runs' ? runDetail(id, now) : null

  switch (route) {
    case 'policy': return policy(now)
    case 'status': return status(now)
    case 'drifts': return { drifts: DRIFTS }
    case 'preflight': return { checks: CHECKS }
    case 'revisions': {
      const { limit } = page(url.searchParams, 20, 100)

      return { revisions: revisions(now).slice(0, limit) }
    }
    case 'runs': {
      const { limit, offset } = page(url.searchParams, 50, 200)

      return { runs: RUNS.slice(offset, offset + limit).map(r => runRow(r, now)), limit, offset }
    }
    default: {
      const params = url.searchParams
      const { limit, offset } = page(params, 50, 200)
      const kind = params.get('kind')
      const stat = params.get('status')
      const zone = params.get('zone')
      const direction = params.get('direction')

      const rows = SUGGESTIONS.map(s => suggestionRow(s, now)).filter(s => (
        (!kind || s.kind === kind) && (!stat || s.status === stat) && (!zone || s.src_zone_id === zone || s.dst_zone_id === zone) &&
        (!direction || (s.direction ?? 'in') === direction)
      ))

      return { suggestions: rows.slice(offset, offset + limit), limit, offset }
    }
  }
}

function runDetail(id: string, now: number) {
  const seed = RUNS.find(r => r.id === id)

  return seed ? { ...runRow(seed, now), result: runResult(seed) } : null
}
