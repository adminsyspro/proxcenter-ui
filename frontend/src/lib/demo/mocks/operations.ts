/**
 * Demo mocks for the operations and automation screens. See ./index.ts for the contract.
 */

import { resolveBackupCoverage, type CoverageGuest, type VzdumpJob } from '@/lib/backups/coverage'
import {
  matchesArchiveFilters,
  mergeArchiveTasks,
  parseArchiveQuery,
  summarizeArchive,
  toArchiveTask,
  type PveTaskEntry,
} from '@/lib/tasks/archive'
import { parseVzdumpLog } from '@/lib/backups/vzdumpLog'
import { buildNetworkOptions } from '@/lib/templates/networkOptions'

import MOCK_DATA from '../mock-data.json'
import { demoBackupRuns } from './backups'
import type { DemoMockMap, DemoMockResolver } from './index'

const PROD = 'demo-pve-cluster-001'
const PROD_NAME = 'Production Cluster'
const DR = 'demo-pve-dr-001'
const MIN = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000

const md = MOCK_DATA as Record<string, any>

const PROD_GUESTS: any[] = (md[`/api/v1/connections/${PROD}/resources`]?.data || []).filter(
  (r: any) => r && (r.type === 'qemu' || r.type === 'lxc'),
)
const PROD_NODES: any[] = md[`/api/v1/connections/${PROD}/nodes`]?.data || []

const guestByVmid = (vmid: number) => PROD_GUESTS.find(g => g.vmid === vmid)
const guestName = (vmid: number) => guestByVmid(vmid)?.name || `vm-${vmid}`

// Stable 0..1 value per string, so polled screens do not reshuffle.
function hash01(key: string): number {
  let h = 2166136261

  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }

  return ((h >>> 0) % 10000) / 10000
}

const iso = (ms: number) => new Date(ms).toISOString()
const round1 = (n: number) => Math.round(n * 10) / 10

// ---------------------------------------------------------------------------
// Backup coverage: the two jobs of GET /connections/<prod>/backup-jobs in their
// PVE /cluster/backup form. The daily "all" job leaves the decommissioned test
// guest and the sandboxes out, so the card lists a few uncovered guests.
// ---------------------------------------------------------------------------

const COVERAGE_JOBS: VzdumpJob[] = [
  { id: 'backup-daily-001', enabled: 1, all: 1, exclude: '224,227,228,229' },
  { id: 'backup-weekly-001', enabled: 1, vmid: '100,101,102,104' },
]
const COVERAGE_SETTINGS = { graceHours: 24, excludeTag: 'no-backup' }

function demoBackupCoverage(now = Date.now()) {
  const nodeStatus = new Map(PROD_NODES.map((n: any) => [String(n.node), String(n.status || 'unknown')]))
  const guests: CoverageGuest[] = PROD_GUESTS.map(r => ({
    connId: PROD,
    connectionName: PROD_NAME,
    node: String(r.node || ''),
    nodeStatus: nodeStatus.get(String(r.node || '')),
    vmid: String(r.vmid),
    type: r.type,
    name: r.name || `${r.type}/${r.vmid}`,
    status: r.status || 'unknown',
    template: r.template === 1 || r.template === true,
    tags: Array.isArray(r.tags) ? r.tags : [],
    pool: r.pool || null,
  }))
  const { uncovered, summary } = resolveBackupCoverage({
    guests,
    jobsByConnection: { [PROD]: COVERAGE_JOBS },
    settings: COVERAGE_SETTINGS,
    now,
  })

  uncovered.sort((a, b) => Number(a.vmid) - Number(b.vmid))

  return { data: { guests: uncovered, summary, settings: COVERAGE_SETTINGS, errors: [], generatedAt: iso(now) } }
}

// ---------------------------------------------------------------------------
// Top consumers (TopConsumersWidget): ranked from the per-guest figures of the
// prod resources. CPU and RAM are the resource percentages; the I/O rates scale
// with the guest's CPU load, with a stable per-guest factor.
// ---------------------------------------------------------------------------

const TOP_METRICS = new Set(['cpu', 'ram', 'diskread', 'diskwrite', 'netin', 'netout'])
const IO_BASE: Record<string, number> = { diskread: 180e6, diskwrite: 95e6, netin: 60e6, netout: 85e6 }

function topValue(g: any, metric: string, agg: string): number {
  const cpu = Math.max(0, Number(g.cpu) || 0)
  let avg: number

  if (metric === 'cpu') avg = cpu * 100
  else if (metric === 'ram') avg = g.maxmem ? (Number(g.mem) / Number(g.maxmem)) * 100 : 0
  else avg = cpu * IO_BASE[metric] * (0.4 + hash01(`${metric}:${g.vmid}`) * 1.2)

  if (agg !== 'max') return metric === 'cpu' || metric === 'ram' ? round1(avg) : Math.round(avg)
  const peak = avg * (1.25 + hash01(`peak:${metric}:${g.vmid}`) * 0.6)

  return metric === 'cpu' || metric === 'ram' ? round1(Math.min(100, peak + 3)) : Math.round(peak)
}

function demoTopConsumers(url: URL) {
  const metric = url.searchParams.get('metric') || 'cpu'
  const agg = url.searchParams.get('agg') === 'max' ? 'max' : 'avg'

  if (!TOP_METRICS.has(metric)) return new Response(JSON.stringify({ error: 'Unknown metric' }), { status: 400 })
  const limit = [10, 20, 50].includes(Number(url.searchParams.get('limit'))) ? Number(url.searchParams.get('limit')) : 10
  const to = url.searchParams.get('to') ? new Date(String(url.searchParams.get('to'))) : new Date()
  const from = url.searchParams.get('from') ? new Date(String(url.searchParams.get('from'))) : new Date(to.getTime() - HOUR)
  const wanted = (url.searchParams.get('connections') || '').split(',').map(s => s.trim()).filter(Boolean)
  const samples = Math.max(1, Math.min(1440, Math.round((to.getTime() - from.getTime()) / MIN)))
  const guests = wanted.length && !wanted.includes(PROD) ? [] : PROD_GUESTS.filter(g => g.status === 'running' && !g.template)

  const items = guests
    .map(g => ({
      connId: PROD,
      connection: PROD_NAME,
      vmid: g.vmid,
      name: g.name,
      node: g.node,
      type: g.type,
      status: g.status,
      value: topValue(g, metric, agg),
      samples,
    }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name))
    .slice(0, limit)

  return {
    metric,
    agg,
    unit: metric === 'cpu' || metric === 'ram' ? 'percent' : 'bytes_per_second',
    from: from.toISOString(),
    to: to.toISOString(),
    firstSampleAt: iso(Date.now() - 14 * DAY),
    items,
  }
}

// ---------------------------------------------------------------------------
// Blueprint network options (CreateBlueprintDialog): the vDC VNets of mock-data.
// ---------------------------------------------------------------------------

function demoNetworkOptions() {
  const vdcs = (md['/api/v1/vdcs']?.data || []).filter((v: any) => v.enabled !== false)
  const rows = vdcs.map((v: any) => ({
    id: v.id,
    slug: v.slug,
    connectionId: v.connectionId,
    vnets: (md[`/api/v1/vdcs/${v.id}/vnets`]?.data || []).map((n: any) => ({
      pveName: n.pveName,
      displayName: n.displayName,
      subnet: n.subnet
        ? { cidr: n.subnet.cidr, gateway: n.subnet.gateway, dnsServers: (n.subnet.dnsServers || []).join(',') || null }
        : null,
    })),
  }))

  return { data: { options: buildNetworkOptions(rows) } }
}

// ---------------------------------------------------------------------------
// Report layout preview (ReportCustomization): a one-page sample PDF, shown in
// an iframe. The "Action disabled" JSON answer rendered as a broken document.
// ---------------------------------------------------------------------------

function samplePdf(lines: string[]): string {
  const esc = (v: string) => v.replace(/([()\\])/g, '\\$1')
  const content = lines.map((l, i) => `BT /F1 ${i === 0 ? 20 : 11} Tf 60 ${720 - i * 22} Td (${esc(l)}) Tj ET`).join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
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

  return body
}

function demoReportPreview() {
  const pdf = samplePdf([
    'Sample report',
    'ProxCenter demo instance',
    'A real install renders this preview with your layout and branding.',
  ])

  return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'x-demo-mode': 'true' } })
}

// ---------------------------------------------------------------------------
// Task archive (/operations/events, Archive view): the vzdump tasks of
// mocks/backups.ts plus an hourly sprinkle of guest tasks, shaped and filtered
// by the same helpers as src/app/api/v1/events/archive/route.ts.
// ---------------------------------------------------------------------------

const DR_NODES = ['pve-dr-01', 'pve-dr-02', 'pve-dr-03', 'pve-dr-04']
const ARCHIVE_DAYS = 60
// [type, status] picked per hour slot; most succeed.
const ARCHIVE_KINDS: [string, string][] = [
  ['qmstart', 'OK'], ['qmshutdown', 'OK'], ['qmreboot', 'OK'], ['qmigrate', 'OK'], ['qmsnapshot', 'OK'],
  ['qmdelsnapshot', 'OK'], ['hamigrate', 'OK'], ['qmclone', 'OK'], ['aptupdate', 'OK'], ['qmigrate', 'WARNINGS: 1'],
  ['qmstart', 'OK'], ['vncproxy', 'OK'], ['qmsnapshot', 'snapshot feature is not available'], ['qmrestore', 'OK'],
]

function upid(node: string, startSec: number, type: string, id: string, user: string, seq: number): string {
  const hex = (n: number) => n.toString(16).toUpperCase().padStart(8, '0')

  return `UPID:${node}:${hex(0x3a000 + seq)}:${hex(0x1f00000 + seq * 7)}:${hex(startSec)}:${type}:${id}:${user}:`
}

function demoArchiveEntries(nowSec: number): { connectionId: string; entry: PveTaskEntry }[] {
  const out: { connectionId: string; entry: PveTaskEntry }[] = []
  const running = PROD_GUESTS.filter(g => !g.template)
  const lastHour = Math.floor(nowSec / 3600)

  for (const job of demoBackupRuns(ARCHIVE_DAYS, nowSec).jobs) {
    for (const run of job.runs) {
      for (const t of run.tasks) {
        out.push({ connectionId: PROD, entry: { upid: t.upid, node: t.node, starttime: t.start, endtime: t.end ?? undefined, type: 'vzdump', id: '', user: 'root@pam', status: t.status } })
      }
    }
  }

  for (let h = lastHour - ARCHIVE_DAYS * 24; h <= lastHour; h++) {
    const r = hash01(`arch:${h}`)

    if (r < 0.35) continue
    const [type, status] = ARCHIVE_KINDS[Math.floor(hash01(`kind:${h}`) * ARCHIVE_KINDS.length)]
    const start = h * 3600 + Math.floor(hash01(`min:${h}`) * 3000)

    if (start > nowSec) continue
    const onDr = r > 0.93
    const guest = running[Math.floor(hash01(`guest:${h}`) * running.length)]
    const node = onDr ? DR_NODES[h % DR_NODES.length] : guest.node
    const id = type === 'aptupdate' ? '' : String(onDr ? 9000 + (guest.vmid % 1000) : guest.vmid)
    const user = hash01(`user:${h}`) < 0.6 ? 'root@pam' : 'admin@pve'
    const duration = type === 'qmigrate' || type === 'hamigrate' ? 45 + (h % 90) : type === 'qmrestore' ? 600 + (h % 600) : 2 + (h % 20)
    const live = h === lastHour && start + duration > nowSec

    out.push({
      connectionId: onDr ? DR : PROD,
      entry: { upid: upid(node, start, type, id, user, h % 4096), node, starttime: start, endtime: live ? undefined : start + duration, type, id, user, status: live ? undefined : status },
    })
  }

  return out
}

function demoTaskArchive(url: URL) {
  const nowSec = Math.floor(Date.now() / 1000)
  const query = parseArchiveQuery(url.searchParams, nowSec)
  const guests = new Map<string, any>(PROD_GUESTS.map(g => [String(g.vmid), { name: g.name, type: g.type, status: g.status }]))
  const nodes = [
    ...PROD_NODES.map((n: any) => ({ connectionId: PROD, node: String(n.node), status: String(n.status || 'online') })),
    ...DR_NODES.map(node => ({ connectionId: DR, node, status: 'online' })),
  ].sort((a, b) => a.node.localeCompare(b.node))
  const nodeStatus = new Map(nodes.map(n => [n.node, n.status]))
  const names: Record<string, string> = { [PROD]: PROD_NAME, [DR]: 'DR Cluster (GRA)' }

  const tasks = demoArchiveEntries(nowSec)
    .filter(({ connectionId, entry }) =>
      entry.starttime >= query.since && entry.starttime <= query.until &&
      (!query.connectionId || query.connectionId === connectionId) &&
      (!query.node || query.node === entry.node) &&
      (!query.vmid || entry.id === query.vmid))
    .map(({ connectionId, entry }) => toArchiveTask(entry, { connectionId, connectionName: names[connectionId], nowSec, guests: connectionId === PROD ? guests : new Map(), nodeStatus }))
    .filter(t => matchesArchiveFilters(t, { ...query, status: 'all' }))

  const inWindow = mergeArchiveTasks(tasks)
  const merged = query.status === 'all' ? inWindow : inWindow.filter(t => t.statusClass === query.status)
  const lastPage = Math.max(0, Math.ceil(merged.length / query.pageSize) - 1)
  const page = Math.min(query.page, lastPage)

  return {
    data: merged.slice(page * query.pageSize, (page + 1) * query.pageSize),
    meta: {
      total: merged.length,
      page,
      pageSize: query.pageSize,
      since: query.since,
      until: query.until,
      truncated: false,
      history: true,
      summary: summarizeArchive(inWindow),
      unavailable: [],
      connections: [{ id: DR, name: names[DR] }, { id: PROD, name: PROD_NAME }],
      nodes: query.connectionId ? nodes.filter(n => n.connectionId === query.connectionId) : nodes,
    },
  }
}

// ---------------------------------------------------------------------------
// Restore drills (Backups > Restore drills): a few finished drills of guests
// backed up on PBS Master, and one weekly schedule that queued two of them.
// ---------------------------------------------------------------------------

const DRILL_SETTINGS = {
  max_concurrent: 2,
  capacity_budget_gb: 500,
  free_space_margin_pct: 15,
  restore_timeout_sec: 3600,
  boot_timeout_sec: 600,
  agent_timeout_sec: 300,
  default_network_mode: 'link_down',
  default_bridge: 'vmbr0',
  screenshot_delay_sec: 60,
}

const DRILL_SCHEDULE_ID = 'demo-drill-sched-001'
const DRILL_SCHEDULE_NAME = 'Weekly production restore test'
// [id, vmid, daysAgo, startHourUtc, result, failedStage, error, fromSchedule, sizeGb]
const DRILL_ROWS: [string, number, number, number, string, string, string, boolean, number][] = [
  ['demo-drill-005', 115, 0, 4, 'boot_verified', '', '', true, 38],
  ['demo-drill-004', 112, 0, 4, 'boot_verified', '', '', true, 52],
  ['demo-drill-003', 131, 3, 14, 'failed', 'guest_agent', 'The guest agent did not answer within 300 s', false, 24],
  ['demo-drill-002', 100, 7, 4, 'vm_started', '', '', true, 12],
  ['demo-drill-001', 245, 12, 10, 'boot_verified', '', '', false, 18],
]

function drillStages(result: string, failedStage: string, start: number) {
  const steps: [string, number][] = [['archive_found', 5], ['restore_completed', 540], ['guest_started', 25], ['guest_agent', 70], ['application_check', 0]]
  let t = start
  let failed = false

  return steps.map(([key, len]) => {
    const started = t

    t += len * 1000
    if (failed) return { key, status: 'skipped', started_at: '', ended_at: '', detail: '' }
    if (key === failedStage) {
      failed = true

      return { key, status: 'failed', started_at: iso(started), ended_at: iso(t), detail: 'No answer from qemu-guest-agent' }
    }
    if (key === 'application_check') return { key, status: 'not_assessed', started_at: '', ended_at: '', detail: '' }
    if (key === 'guest_agent' && result === 'vm_started') return { key, status: 'skipped', started_at: '', ended_at: '', detail: 'No guest agent configured' }

    return { key, status: 'ok', started_at: iso(started), ended_at: iso(t), detail: '' }
  })
}

function demoDrills(now = Date.now()) {
  const today = Math.floor(now / DAY) * DAY

  return DRILL_ROWS.map(([id, vmid, daysAgo, hour, result, failedStage, error, fromSchedule, sizeGb], i) => {
    const guest = guestByVmid(vmid)
    const start = today - daysAgo * DAY + hour * HOUR + i * 17 * MIN
    const backupTime = start - 2 * HOUR - (vmid % 50) * MIN
    const end = start + (result === 'failed' ? 640 : 700) * 1000
    const failed = result === 'failed'

    return {
      id,
      status: failed ? 'failed' : 'succeeded',
      phase: 'done',
      result,
      failed_stage: failedStage,
      error,
      cleanup_state: 'done',
      cleanup_error: '',
      connection_id: PROD,
      node: guest?.node || 'pve-node-01',
      target_storage: 'CephStoragePool',
      network_mode: 'link_down',
      bridge: '',
      source: {
        pbs_id: 'demo-pbs-001',
        pbs_name: 'PBS Master',
        pbs_storage: 'PBS_MASTER',
        datastore: 'backup-main',
        namespace: '',
        backup_type: 'vm',
        backup_id: String(vmid),
        backup_time: iso(backupTime),
        vm_name: guestName(vmid),
        verify_state: 'ok',
        verified_at: iso(backupTime + HOUR),
        backup_size_bytes: sizeGb * 1024 ** 3,
        archive: `PBS_MASTER:backup/vm/${vmid}/${iso(backupTime).replace(/\.\d{3}Z$/, 'Z')}`,
      },
      temp_vmid: 9900 + i,
      temp_name: `drill-${vmid}-${id.slice(-3)}`,
      required_bytes: Math.round(sizeGb * 1.15 * 1024 ** 3),
      restore_timeout_sec: DRILL_SETTINGS.restore_timeout_sec,
      boot_timeout_sec: DRILL_SETTINGS.boot_timeout_sec,
      agent_timeout_sec: DRILL_SETTINGS.agent_timeout_sec,
      stages: drillStages(result, failedStage, start),
      screenshot_state: failed ? 'unavailable' : '',
      screenshot_at: '',
      screenshot_error: failed ? 'The console showed no output before the guest stopped' : '',
      cancel_requested: false,
      requested_by: fromSchedule ? 'scheduler' : 'admin@demo.proxcenter.io',
      schedule_id: fromSchedule ? DRILL_SCHEDULE_ID : '',
      schedule_name: fromSchedule ? DRILL_SCHEDULE_NAME : '',
      queued_at: '',
      created_at: iso(start - 5000),
      started_at: iso(start),
      finished_at: iso(end),
      cleaned_at: iso(end + 40_000),
    }
  })
}

function drillEvents(drill: any) {
  const ev = (ts: string, level: string, stage: string, message: string) => ({ ts, level, stage, message })
  const out = [ev(drill.created_at, 'info', 'archive_found', `Drill requested by ${drill.requested_by}`)]

  for (const s of drill.stages) {
    if (!s.started_at) continue
    out.push(ev(s.started_at, 'info', s.key, `${s.key.replace(/_/g, ' ')} started`))
    out.push(ev(s.ended_at, s.status === 'failed' ? 'error' : 'info', s.key, s.status === 'failed' ? s.detail : `${s.key.replace(/_/g, ' ')} ok`))
  }
  out.push(ev(drill.cleaned_at, 'info', 'cleaning', `Temporary guest ${drill.temp_vmid} destroyed`))

  return out
}

function demoDrillSchedule(now = Date.now()) {
  const drills = demoDrills(now).filter(d => d.schedule_id === DRILL_SCHEDULE_ID)
  const today = Math.floor(now / DAY) * DAY
  const runs = [0, 7].map((daysAgo, i) => {
    const ids = drills.filter(d => Math.floor(new Date(d.started_at).getTime() / DAY) * DAY === today - daysAgo * DAY).map(d => d.id)

    return {
      id: `demo-drill-run-00${2 - i}`,
      schedule_id: DRILL_SCHEDULE_ID,
      started_at: iso(today - daysAgo * DAY + 4 * HOUR),
      state: 'done',
      result: daysAgo === 7 ? 'warning' : 'ok',
      summary: daysAgo === 7 ? '1 guest started, boot not verified (no guest agent)' : `${ids.length} guests restored and booted`,
      drill_ids: ids,
      skipped_vmids: daysAgo === 7 ? [{ vmid: 101, reason: 'No verified backup in the window' }] : [],
    }
  })
  const schedule = {
    id: DRILL_SCHEDULE_ID,
    name: DRILL_SCHEDULE_NAME,
    enabled: true,
    scope: { mode: 'vms', vmids: [100, 101, 112, 115, 118, 122] },
    restore_point: 'latest_verified',
    source: { pbs_id: 'demo-pbs-001', pbs_name: 'PBS Master', pbs_storage: 'PBS_MASTER', datastore: 'backup-main', namespace: '' },
    connection_id: PROD,
    node: 'pve-node-04',
    target_storage: 'CephStoragePool',
    network_mode: 'link_down',
    bridge: '',
    calendar: 'sun 04:00',
    vms_per_run: 2,
    created_by: 'admin@demo.proxcenter.io',
    rotation_last_vmid: 115,
    next_run_at: iso(today + (7 - new Date(today).getUTCDay()) * DAY + 4 * HOUR),
    last_run: runs[0],
    created_at: iso(today - 40 * DAY),
    updated_at: iso(today - 14 * DAY),
  }

  return { schedule, runs }
}

function drillListPage(url: URL) {
  const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 20, 1), 200)
  const offset = Math.max(Number(url.searchParams.get('offset')) || 0, 0)
  const scheduleId = url.searchParams.get('schedule_id') || ''
  const all = demoDrills().filter(d => !scheduleId || d.schedule_id === scheduleId)

  return { data: all.slice(offset, offset + limit), total: all.length }
}

// ---------------------------------------------------------------------------
// Site Recovery: the three jobs and the plan of GET /orchestrator/replication/
// jobs and /plans (EXTRA_MOCKS). Only the facts the detail screens need are
// restated here: guests, sync interval, throughput and how long ago the last
// sync ran. RBD pools are those of the replication-storages mocks.
// ---------------------------------------------------------------------------

type ReplJob = { vms: [number, string][]; interval: number; bps: number; lastAgo: number }

const REPL_JOBS: Record<string, ReplJob> = {
  'repl-001': { vms: [[100, 'web-prod-01'], [101, 'db-master'], [102, 'api-gateway'], [104, 'redis-cache']], interval: 900, bps: 125829120, lastAgo: 420_000 },
  'repl-002': { vms: [[103, 'db-replica-01'], [110, 'postgres-main'], [111, 'mysql-analytics']], interval: 900, bps: 83886080, lastAgo: 900_000 },
  'repl-003': {
    vms: [[105, 'monitoring'], [106, 'mail-server'], [107, 'dns-primary'], [108, 'ldap-auth'], [109, 'ci-runner'], [112, 'vault-prod'], [113, 'elastic-node-01'], [114, 'proxy-lb'], [115, 'web-prod-02'], [116, 'web-prod-03'], [117, 'grafana'], [118, 'dev-staging'], [119, 'test-env-01'], [120, 'test-env-02'], [121, 'jenkins'], [122, 'sonarqube'], [123, 'nexus']],
    interval: 7200,
    bps: 209715200,
    lastAgo: 1_080_000,
  },
}
const SOURCE_POOL = 'rbd-pool'
const TARGET_POOL = 'rbd-dr'
const VMID_PREFIX = 9000
const targetVmid = (vmid: number) => VMID_PREFIX + (vmid % 1000)
const diskGb = (vmid: number) => 16 + Math.round(hash01(`disk:${vmid}`) * 12) * 8
const RESTORE_POINTS_KEPT = 6

function restorePoints(job: ReplJob, nowSec: number) {
  const last = Math.floor(nowSec / job.interval) * job.interval

  return Array.from({ length: RESTORE_POINTS_KEPT }, (_, k) => {
    const ts = last - k * job.interval

    return { snapshot: `mirror.${ts}`, created_ts: ts, created_iso: iso(ts * 1000) }
  })
}

function vmRestorePoints(jobId: string, job: ReplJob, vmid: number, name: string, nowSec: number) {
  return { vm_id: vmid, vm_name: name, target_vmid: targetVmid(vmid), job_id: jobId, disk_count: 1, restore_points: restorePoints(job, nowSec) }
}

function replicationLogs(jobId: string, job: ReplJob, now = Date.now()) {
  const last = now - job.lastAgo

  return Array.from({ length: 20 }, (_, k) => {
    const at = last - k * job.interval * 1000
    const slot = Math.floor(at / (job.interval * 1000))
    const bytes = Math.round(job.vms.length * 180e6 * (0.4 + hash01(`log:${jobId}:${slot}`)))
    const durationMs = Math.round((bytes / job.bps) * 1000) + 4000

    return {
      created_at: iso(at),
      level: hash01(`lvl:${jobId}:${slot}`) < 0.08 ? 'warning' : 'info',
      message: hash01(`lvl:${jobId}:${slot}`) < 0.08
        ? `Sync completed for ${job.vms.length} VM(s), rate limit reached for part of the transfer`
        : `Sync completed for ${job.vms.length} VM(s)`,
      bytes_sent: bytes,
      duration_ms: durationMs,
    }
  })
}

const THROUGHPUT_WINDOWS: Record<string, [number, number]> = { '1h': [60, MIN], '6h': [72, 5 * MIN], '24h': [96, 15 * MIN], '7d': [168, HOUR] }

function throughputSeries(key: string, job: ReplJob, window: string, now = Date.now()) {
  const [count, step] = THROUGHPUT_WINDOWS[window] || THROUGHPUT_WINDOWS['24h']
  const end = Math.floor(now / step) * step

  return Array.from({ length: count }, (_, i) => {
    const ts = end - (count - 1 - i) * step
    const r = hash01(`tp:${key}:${Math.floor(ts / step)}`)

    return { timestamp: iso(ts), bytes_per_sec: Math.round(job.bps * (0.15 + 0.85 * r * r)) }
  })
}

function jobVmRows(jobId: string, job: ReplJob, now = Date.now()) {
  const last = now - job.lastAgo

  return job.vms.map(([vmid, name], i) => ({
    job_id: jobId,
    vmid,
    vm_name: name,
    status: 'synced',
    last_sync: iso(last - i * 9000),
    bytes_sent: Math.round(180e6 * (0.4 + hash01(`vmb:${vmid}`))),
    duration_ms: 6000 + Math.round(hash01(`vmd:${vmid}`) * 40_000),
    updated_at: iso(last - i * 9000),
    throughput_history: throughputSeries(`${jobId}:${vmid}`, { ...job, bps: job.bps / job.vms.length }, '24h', now).filter((_, k) => k % 4 === 0),
  }))
}

function replicationSnapshots(now = Date.now()) {
  const nowSec = Math.floor(now / 1000)
  const rows: any[] = []

  for (const [jobId, job] of Object.entries(REPL_JOBS)) {
    const [point] = restorePoints(job, nowSec)

    for (const [vmid] of job.vms) {
      const size = diskGb(vmid) * 1024 ** 3

      rows.push(
        { cluster_id: PROD, cluster_name: PROD_NAME, storage_engine: 'rbd', pool: SOURCE_POOL, image: `vm-${vmid}-disk-0`, snapshot: point.snapshot, provisioned_bytes: size, created_ts: point.created_ts, created_iso: point.created_iso, vmid, job_id: jobId, is_orphan: false, side: 'source' },
        { cluster_id: DR, cluster_name: 'DR Cluster (GRA)', storage_engine: 'rbd', pool: TARGET_POOL, image: `vm-${targetVmid(vmid)}-disk-0`, snapshot: point.snapshot, provisioned_bytes: size, created_ts: point.created_ts, created_iso: point.created_iso, vmid: targetVmid(vmid), job_id: jobId, is_orphan: false, side: 'target' },
      )
    }
  }
  // A replica left behind by a guest removed from its job.
  const orphanTs = Math.floor(nowSec / 86400) * 86400 - 9 * 86400

  rows.push({ cluster_id: DR, cluster_name: 'DR Cluster (GRA)', storage_engine: 'rbd', pool: TARGET_POOL, image: 'vm-9126-disk-0', snapshot: `mirror.${orphanTs}`, provisioned_bytes: 64 * 1024 ** 3, created_ts: orphanTs, created_iso: iso(orphanTs * 1000), vmid: 9126, is_orphan: true, orphan_reason: 'No replication job references this image' })

  return rows
}

function snapshotUsage(url: URL) {
  const image = url.searchParams.get('image') || ''
  const vmid = Number(image.match(/^vm-(\d+)-disk/)?.[1]) || 0
  const provisioned = (vmid >= VMID_PREFIX ? diskGb(vmid - VMID_PREFIX + 100) : diskGb(vmid)) * 1024 ** 3

  return { used_bytes: Math.round(provisioned * (0.01 + hash01(`use:${image}:${url.searchParams.get('snap')}`) * 0.05)), provisioned_bytes: provisioned }
}

// Test failovers of plan-001: the latest matches the plan's last_test (7 days ago).
const PLAN_ID = 'plan-001'
const PLAN_VMS: [number, string][] = REPL_JOBS['repl-001'].vms
const PLAN_TESTS: [string, number, string][] = [
  ['demo-exec-004', 7, 'completed'],
  ['demo-exec-003', 35, 'completed'],
  ['demo-exec-002', 36, 'failed'],
  ['demo-exec-001', 63, 'completed'],
]

function planExecutions(now = Date.now()) {
  return PLAN_TESTS.map(([id, daysAgo, status]) => {
    const started = now - daysAgo * DAY
    const failed = status === 'failed'

    return {
      id,
      plan_id: PLAN_ID,
      type: 'test',
      status,
      network_isolated: true,
      started_at: iso(started),
      completed_at: iso(started + (failed ? 6 : 11) * MIN),
      screenshot_delay_seconds: 60,
      vm_results: PLAN_VMS.map(([vmid, name], i) => ({
        vm_id: vmid,
        vm_name: name,
        status: failed && i === 1 ? 'failed' : 'completed',
        progress_percent: failed && i === 1 ? 40 : 100,
        error: failed && i === 1 ? 'Clone of vm-9101-disk-0 failed: no space left on rbd-dr' : undefined,
        target_node: DR_NODES[i % DR_NODES.length],
        target_vmid: targetVmid(vmid),
        test_state: 'cleaned',
      })),
    }
  })
}

function executionEvents(exec: any) {
  const start = new Date(exec.started_at).getTime()
  const out: any[] = []
  let n = 0
  const push = (vmId: number, level: string, step: string, message: string, at: number) => {
    n++
    out.push({ id: n, execution_id: exec.id, vm_id: vmId, step, level, message, at: iso(at) })
  }

  push(0, 'info', 'start', `Test failover started for ${exec.vm_results.length} guests, network isolated`, start)
  exec.vm_results.forEach((r: any, i: number) => {
    const t = start + (i + 1) * 70_000

    push(r.vm_id, 'info', 'cloning', `Cloning the latest restore point of ${r.vm_name}`, t)
    if (r.status === 'failed') push(r.vm_id, 'error', 'cloning', r.error, t + 30_000)
    else {
      push(r.vm_id, 'check', 'starting', `${r.vm_name} started on ${r.target_node} as ${r.target_vmid}`, t + 40_000)
    }
  })
  push(0, exec.status === 'failed' ? 'error' : 'check', 'done', exec.status === 'failed' ? 'Test failover failed' : 'Test failover completed', new Date(exec.completed_at).getTime())

  return out
}

// Replication rows of the Task Center (GET /orchestrator/jobs): JobDetailDialog
// reads their log from /replication/jobs/<task id>/logs.
const TASK_REPLICATIONS: Record<string, { vmid: number; target: string; startMinAgo: number; endMinAgo: number; failed: boolean }> = {
  'demo-job-004': { vmid: 101, target: 'pve-dr-02', startMinAgo: 51, endMinAgo: 43, failed: true },
  'demo-job-005': { vmid: 100, target: 'pve-dr-01', startMinAgo: 74, endMinAgo: 71, failed: false },
}

function taskReplicationLogs(id: string, now = Date.now()) {
  const job = TASK_REPLICATIONS[id]
  const start = now - job.startMinAgo * MIN
  const end = now - job.endMinAgo * MIN
  const name = guestName(job.vmid)
  const line = (at: number, level: string, message: string, bytes = 0, ms = 0) => ({ created_at: iso(at), level, message, bytes_sent: bytes, duration_ms: ms })
  const sent = job.failed ? 1_932_735_283 : 10_630_044_058

  return [
    line(start, 'info', `Sync started for ${name} (${job.vmid}) to ${job.target}`),
    line(start + 20_000, 'info', `Snapshot mirror.${Math.floor(start / 1000)} created on vm-${job.vmid}-disk-0`),
    line(start + 45_000, 'info', `Sending incremental diff of vm-${job.vmid}-disk-0`),
    job.failed
      ? line(end, 'error', `Transfer of vm-${job.vmid}-disk-0 failed: connection reset by peer`, sent, end - start)
      : line(end, 'info', `Sync completed for ${name}: ${(sent / 1024 ** 3).toFixed(1)} GiB in ${Math.round((end - start) / 1000)}s`, sent, end - start),
  ]
}

function resolveReplication(cleanPath: string, url: URL): any | null {
  const now = Date.now()
  const nowSec = Math.floor(now / 1000)
  const taskLogs = cleanPath.match(/^\/api\/v1\/orchestrator\/replication\/jobs\/(demo-job-\d+)\/logs$/)

  if (taskLogs) return TASK_REPLICATIONS[taskLogs[1]] ? taskReplicationLogs(taskLogs[1], now) : null

  if (cleanPath === '/api/v1/orchestrator/replication/snapshots') return replicationSnapshots(now)
  if (cleanPath === '/api/v1/orchestrator/replication/snapshots/usage') return snapshotUsage(url)

  const job = cleanPath.match(/^\/api\/v1\/orchestrator\/replication\/jobs\/([^/]+)\/(logs|throughput|vms)$/)

  if (job) {
    const j = REPL_JOBS[job[1]]

    if (!j) return null
    if (job[2] === 'logs') return replicationLogs(job[1], j, now)
    if (job[2] === 'vms') return jobVmRows(job[1], j, now)

    return throughputSeries(job[1], j, url.searchParams.get('window') || '24h', now)
  }
  const points = cleanPath.match(/^\/api\/v1\/orchestrator\/replication\/jobs\/([^/]+)\/vms\/(\d+)\/restore-points$/)

  if (points) {
    const j = REPL_JOBS[points[1]]
    const vm = j?.vms.find(([vmid]) => vmid === Number(points[2]))

    return j && vm ? vmRestorePoints(points[1], j, vm[0], vm[1], nowSec) : null
  }
  const plan = cleanPath.match(/^\/api\/v1\/orchestrator\/replication\/plans\/([^/]+)\/(history|restore-points)$/)

  if (plan) {
    if (plan[1] !== PLAN_ID) return null
    if (plan[2] === 'history') return planExecutions(now)

    return { plan_id: PLAN_ID, target_cluster: DR, vms: PLAN_VMS.map(([vmid, name]) => vmRestorePoints('repl-001', REPL_JOBS['repl-001'], vmid, name, nowSec)) }
  }
  const exec = cleanPath.match(/^\/api\/v1\/orchestrator\/replication\/executions\/([^/]+)(?:\/(events|screenshots))?$/)

  if (exec) {
    const found = planExecutions(now).find(e => e.id === exec[1])

    if (!found) return null
    // No boot screenshot is stored for the demo runs: the PNG route has nothing to serve.
    if (exec[2] === 'screenshots') return []
    if (exec[2] === 'events') {
      const after = Number(url.searchParams.get('after')) || 0

      return executionEvents(found).filter(e => e.id > after)
    }

    return found
  }

  return null
}

// ---------------------------------------------------------------------------
// Rolling updates of the Task Center rows (demo-job-002 paused on prod,
// demo-job-009 done on DR), read by JobDetailDialog and RollingUpdateWizard.
// ---------------------------------------------------------------------------

const ROLLING_CONFIG = {
  migrate_non_ha_vms: true,
  shutdown_local_vms: false,
  max_concurrent_migrations: 2,
  migration_timeout: 600,
  auto_reboot: true,
  reboot_timeout: 900,
  require_manual_approval: true,
  min_healthy_nodes: 2,
  abort_on_failure: true,
  set_ceph_noout: true,
  wait_ceph_healthy: true,
  restore_vm_placement: true,
  notify_on_complete: true,
  notify_on_error: true,
}

function rollingUpdate(id: string, now = Date.now()) {
  const prod = id === 'demo-job-002'

  if (!prod && id !== 'demo-job-009') return null
  const nodes = prod ? Array.from({ length: 12 }, (_, i) => `pve-node-${String(i + 1).padStart(2, '0')}`) : DR_NODES
  const startedAt = now - (prod ? 96 : 1500) * MIN
  const perNode = prod ? 17 * MIN : 24 * MIN
  const done = prod ? 5 : nodes.length
  const [before, after] = prod ? ['8.4.0', '8.4.1'] : ['8.4.0', '8.4.1']
  const logs: any[] = [{ timestamp: iso(startedAt), level: 'info', message: `Rolling update started on ${nodes.length} nodes, Ceph noout set` }]

  const nodeStatuses = nodes.map((node, i) => {
    const s = startedAt + i * perNode

    if (i < done) {
      logs.push(
        { timestamp: iso(s), level: 'info', node, message: 'Entering maintenance, migrating guests' },
        { timestamp: iso(s + 6 * MIN), level: 'info', node, message: `apt dist-upgrade: pve-manager ${before} to ${after}` },
        { timestamp: iso(s + 11 * MIN), level: 'info', node, message: 'Rebooting' },
        { timestamp: iso(s + perNode - MIN), level: 'success', node, message: 'Node back online, Ceph healthy, guests restored' },
      )

      return { node_name: node, status: 'completed', started_at: iso(s), completed_at: iso(s + perNode - MIN), reboot_required: true, did_reboot: true, version_before: before, version_after: after }
    }
    if (prod && i === done) {
      logs.push({ timestamp: iso(s), level: 'warning', node, message: 'Waiting for manual approval before updating this node' })

      return { node_name: node, status: 'pending', reboot_required: false, did_reboot: false, version_before: before }
    }

    return { node_name: node, status: 'pending', reboot_required: false, did_reboot: false, version_before: before }
  })

  if (!prod) logs.push({ timestamp: iso(now - 1402 * MIN), level: 'success', message: `${nodes.length}/${nodes.length} nodes updated to ${after}` })

  return {
    data: {
      id,
      connection_id: prod ? PROD : DR,
      status: prod ? 'paused' : 'completed',
      config: { ...ROLLING_CONFIG, node_order: nodes },
      total_nodes: nodes.length,
      completed_nodes: done,
      current_node: prod ? nodes[done] : '',
      pending_approval: prod ? nodes[done] : undefined,
      node_statuses: nodeStatuses,
      logs,
      created_at: iso(startedAt - MIN),
      started_at: iso(startedAt),
      completed_at: prod ? undefined : iso(now - 1402 * MIN),
    },
  }
}

// ---------------------------------------------------------------------------
// One vzdump task of a backup run (BackupJobRunsDrawer): a log written for the
// task mocks/backups.ts generates, parsed like loadRunTaskDetail() does.
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0')
const pveTime = (sec: number) => {
  const d = new Date(sec * 1000)

  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}:${pad2(d.getUTCMinutes())}:${pad2(d.getUTCSeconds())}`
}
const hms = (sec: number) => `${pad2(Math.floor(sec / 3600))}:${pad2(Math.floor((sec % 3600) / 60))}:${pad2(sec % 60)}`
const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(2)} GiB`

function vzdumpTaskLines(jobId: string, task: any, runStatus: string): string[] {
  const all = jobId === 'backup-daily-001'
  const lines = [`INFO: starting new backup job: vzdump ${all ? '--all 1' : task.vmids.join(' ')} --node ${task.node} --storage PBS_MASTER --mode snapshot --compress zstd${jobId === 'manual' ? '' : ' --mailnotification always'}`]
  const slot = Math.floor((task.end - task.start - 10) / task.vmids.length)
  let failedGuests = 0

  task.vmids.forEach((vmid: number, i: number) => {
    const s = task.start + 5 + i * slot
    const e = s + slot - 3
    const name = guestName(vmid)
    const size = diskGb(vmid) * 1024 ** 3
    const dirty = Math.round(size * (0.02 + hash01(`dirty:${vmid}:${task.start}`) * 0.08))
    const fails = task.status !== 'OK' && i === 0

    lines.push(
      `INFO: Starting Backup of VM ${vmid} (qemu)`,
      `INFO: Backup started at ${pveTime(s)}`,
      'INFO: status = running',
      `INFO: VM Name: ${name}`,
      `INFO: include disk 'scsi0' 'CephStoragePool:vm-${vmid}-disk-0' ${diskGb(vmid)}G`,
      'INFO: backup mode: snapshot',
      'INFO: ionice priority: 7',
      `INFO: creating Proxmox Backup Server archive 'vm/${vmid}/${new Date(s * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')}'`,
      'INFO: issuing guest-agent \'fs-freeze\' command',
      'INFO: issuing guest-agent \'fs-thaw\' command',
      `INFO: started backup task '${(task.start + vmid).toString(16)}-demo-${vmid}'`,
      `INFO: scsi0: dirty-bitmap status: OK (${gib(dirty)} of ${gib(size)} dirty)`,
      `INFO: using fast incremental mode (dirty-bitmap), ${gib(dirty)} dirty of ${gib(size)} total`,
    )
    if (fails) {
      failedGuests++
      lines.push(`ERROR: Backup of VM ${vmid} failed - backup write data failed: command error: write_data upload error: pipelined request failed: connection reset`, `INFO: Failed at ${pveTime(e)}`)

      return
    }
    if (runStatus === 'warning' && i === 0) lines.push('WARN: guest-agent fs-freeze timed out, the backup is crash consistent')
    lines.push(
      `INFO: 100% (${gib(dirty)} of ${gib(dirty)}) in ${e - s - 4}s, read: ${gib(dirty / Math.max(1, e - s - 4))}/s, write: ${gib(dirty / Math.max(1, e - s - 4))}/s`,
      `INFO: backup was done incrementally, reused ${gib(size - dirty)} (${Math.round(((size - dirty) / size) * 100)}%)`,
      `INFO: transferred ${gib(dirty)} in ${e - s - 4} seconds (${gib(dirty / Math.max(1, e - s - 4))}/s)`,
      `INFO: Finished Backup of VM ${vmid} (${hms(e - s)})`,
      `INFO: Backup finished at ${pveTime(e)}`,
    )
  })
  if (failedGuests) lines.push('INFO: Backup job finished with errors', 'TASK ERROR: job errors')
  else lines.push('INFO: Backup job finished successfully', runStatus === 'warning' ? 'TASK WARNINGS: 1' : 'TASK OK')

  return lines
}

function runTaskDetail(upidParam: string) {
  const upidStr = decodeURIComponent(upidParam)
  const runs = demoBackupRuns(90)
  const groups = [...runs.jobs.map(j => ({ jobId: j.jobId, runs: j.runs })), { jobId: 'manual', runs: runs.manual.runs }]

  for (const g of groups) {
    for (const run of g.runs) {
      const task = run.tasks.find(t => t.upid === upidStr)

      if (!task) continue
      const lines = vzdumpTaskLines(g.jobId, task, run.status).map((t, i) => ({ n: i + 1, t }))
      const exitStatus = task.status === 'OK' && run.status === 'warning' ? 'WARNINGS: 1' : task.status

      return {
        data: {
          task: { node: task.node, upid: task.upid, status: exitStatus, start: task.start, end: task.end, user: 'root@pam' },
          log: parseVzdumpLog(lines, { taskStart: task.start, running: false, exitStatus, utcOffsetSec: 0 }),
          totalLines: lines.length,
        },
      }
    }
  }

  return null
}

// ---------------------------------------------------------------------------
// PVE file-restore browser (backup explorer of /operations/backups and the
// inventory): one archive per backup, then a small Linux tree.
// ---------------------------------------------------------------------------

type FsEntry = [string, 'd' | 'f' | 'l', number]
const FS_TREE: Record<string, FsEntry[]> = {
  '': [['bin', 'l', 7], ['boot', 'd', 0], ['etc', 'd', 0], ['home', 'd', 0], ['lib', 'l', 7], ['opt', 'd', 0], ['root', 'd', 0], ['srv', 'd', 0], ['usr', 'd', 0], ['var', 'd', 0]],
  boot: [['config-6.8.12-4-pve', 'f', 285_112], ['grub', 'd', 0], ['initrd.img-6.8.12-4-pve', 'f', 72_813_201], ['vmlinuz-6.8.12-4-pve', 'f', 14_283_520]],
  etc: [['fstab', 'f', 512], ['hostname', 'f', 14], ['hosts', 'f', 221], ['nginx', 'd', 0], ['os-release', 'f', 267], ['passwd', 'f', 1820], ['resolv.conf', 'f', 64], ['ssh', 'd', 0], ['systemd', 'd', 0]],
  'etc/nginx': [['nginx.conf', 'f', 1482], ['sites-enabled', 'd', 0]],
  'etc/nginx/sites-enabled': [['default', 'f', 2416]],
  'etc/ssh': [['sshd_config', 'f', 3289], ['ssh_host_ed25519_key.pub', 'f', 93]],
  'etc/systemd': [['system', 'd', 0]],
  home: [['admin', 'd', 0], ['deploy', 'd', 0]],
  'home/admin': [['.bashrc', 'f', 3526], ['.profile', 'f', 807], ['backup.sh', 'f', 1204], ['notes.txt', 'f', 4310]],
  'home/deploy': [['.ssh', 'd', 0], ['releases', 'd', 0]],
  opt: [['app', 'd', 0]],
  'opt/app': [['app.jar', 'f', 48_211_934], ['config.yaml', 'f', 2210], ['logs', 'd', 0]],
  root: [['.bash_history', 'f', 9124], ['.bashrc', 'f', 3106]],
  var: [['lib', 'd', 0], ['log', 'd', 0], ['www', 'd', 0]],
  'var/log': [['auth.log', 'f', 182_334], ['nginx', 'd', 0], ['syslog', 'f', 2_481_902]],
  'var/log/nginx': [['access.log', 'f', 8_412_005], ['error.log', 'f', 41_220]],
  'var/www': [['html', 'd', 0]],
  'var/www/html': [['index.html', 'f', 6114]],
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let u = 0

  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }

  return `${v.toFixed(v < 10 ? 2 : 1)} ${units[u]}`
}

function fileRestoreList(url: URL) {
  const storage = url.searchParams.get('storage')
  const volume = url.searchParams.get('volume')

  if (!storage || !volume) return new Response(JSON.stringify({ error: 'Missing required parameters: storage, volume' }), { status: 400 })
  const filepath = url.searchParams.get('filepath') || '/'
  const isCt = /(^|[/:])ct\//.test(volume)
  const archive = isCt ? 'root.pxar.didx' : 'drive-scsi0.img.fidx'
  const parts = filepath.split('/').filter(Boolean)
  const mtime = Math.floor(Date.now() / DAY) * 86400 - 2 * 86400
  const entry = (name: string, type: string, size: number, browsable: boolean) => ({
    name,
    type,
    size,
    sizeFormatted: formatSize(size),
    mtime,
    mtimeFormatted: new Date(mtime * 1000).toLocaleString('en-US'),
    leaf: !browsable,
    browsable,
  })
  const tree = (rel: string) =>
    (FS_TREE[rel] || []).map(([name, t, size]) => entry(name, t === 'd' ? 'directory' : t === 'l' ? 'symlink' : 'file', size, t === 'd'))
  let files: any[]

  if (parts.length === 0) files = [entry(`/${archive}`, 'virtual', 0, true)]
  else if (parts[0] !== archive) files = []
  else if (isCt) files = tree(parts.slice(1).join('/'))
  else if (parts.length === 1) files = [entry('part', 'virtual', 0, true)]
  else if (parts.length === 2) files = [entry('1', 'virtual', 0, true), entry('2', 'virtual', 0, true)]
  else if (parts[2] === '1') files = parts.length === 3 ? [entry('EFI', 'directory', 0, true)] : []
  else files = tree(parts.slice(3).join('/'))

  files.sort((a, b) => {
    const da = a.type === 'directory' || a.type === 'virtual'
    const db = b.type === 'directory' || b.type === 'virtual'

    return da === db ? a.name.localeCompare(b.name) : da ? -1 : 1
  })

  return { data: { path: filepath, storage, volume, node: 'pve-node-01', files } }
}

// Text preview of a file of FS_TREE (InventoryDetails), same extension rules as the route.
const PREVIEW_TEXT_EXT = ['.txt', '.log', '.conf', '.cfg', '.ini', '.yaml', '.yml', '.json', '.xml', '.sh', '.py', '.js', '.md', '.csv', '.env', '.sql', '.html', '.css']

function previewContent(filename: string, host: string): string {
  switch (filename) {
    case 'nginx.conf':
      return 'user www-data;\nworker_processes auto;\npid /run/nginx.pid;\n\nevents {\n    worker_connections 1024;\n}\n\nhttp {\n    sendfile on;\n    keepalive_timeout 65;\n    include /etc/nginx/mime.types;\n    access_log /var/log/nginx/access.log;\n    error_log /var/log/nginx/error.log;\n    include /etc/nginx/sites-enabled/*;\n}\n'
    case 'resolv.conf':
      return 'search demo.proxcenter.io\nnameserver 10.10.10.1\nnameserver 10.10.10.2\n'
    case 'notes.txt':
      return `${host}\n\n- Certificates renewed by certbot, check /var/log/letsencrypt after each renewal.\n- Backups: nightly vzdump to PBS Master, weekly copy to PBS Replica.\n- Ask the platform team before changing the firewall group of this guest.\n`
    case 'backup.sh':
      return '#!/bin/sh\nset -eu\n# Application dump before the nightly vzdump\npg_dump -Fc app > /var/backups/app-$(date +%F).dump\nfind /var/backups -name "app-*.dump" -mtime +7 -delete\n'
    case '.bashrc':
      return '# ~/.bashrc\n[ -z "$PS1" ] && return\nHISTCONTROL=ignoreboth\nHISTSIZE=5000\nalias ll=\'ls -alF\'\nalias la=\'ls -A\'\nexport EDITOR=vim\n'
    case '.profile':
      return '# ~/.profile\nif [ -n "$BASH_VERSION" ] && [ -f "$HOME/.bashrc" ]; then\n    . "$HOME/.bashrc"\nfi\nPATH="$HOME/bin:$PATH"\n'
    case '.bash_history':
      return 'systemctl status nginx\njournalctl -u nginx --since today\napt update && apt full-upgrade -y\ndf -h\nqm guest cmd 100 ping\n'
    case 'config.yaml':
      return 'server:\n  port: 8080\n  workers: 8\ndatabase:\n  host: db-pgsql-prod-01.demo.proxcenter.io\n  name: app\n  pool: 20\ncache:\n  host: db-redis-prod-01.demo.proxcenter.io\n'
    case 'index.html':
      return `<!doctype html>\n<html>\n  <head><title>${host}</title></head>\n  <body><h1>It works</h1></body>\n</html>\n`
    default:
      return Array.from({ length: 12 }, (_, i) => `${pveTime(1793232000 + i * 37)} ${host} app[${2400 + i}]: request handled in ${12 + ((i * 7) % 40)}ms`).join('\n') + '\n'
  }
}

function fileRestorePreview(url: URL) {
  const volume = url.searchParams.get('volume') || ''
  const filepath = url.searchParams.get('filepath') || ''

  if (!url.searchParams.get('storage') || !volume || !filepath) return new Response(JSON.stringify({ error: 'Missing required parameters' }), { status: 400 })
  const filename = filepath.split('/').pop() || ''
  const ext = `.${filename.split('.').pop()?.toLowerCase()}`

  if (!PREVIEW_TEXT_EXT.includes(ext) && !filename.startsWith('.')) {
    return new Response(JSON.stringify({ error: 'File type not supported for preview' }), { status: 400 })
  }
  const vmid = Number(volume.match(/\/(?:vm|ct)\/(\d+)\//)?.[1]) || 0
  const content = previewContent(filename, vmid ? guestName(vmid) : 'guest')

  return { data: { type: 'text', filename, extension: ext, content, size: content.length, truncated: false, truncatedAt: null } }
}

export const OPERATIONS_MOCKS: DemoMockMap = {
  get 'GET:/api/v1/backups/coverage'() {
    return demoBackupCoverage()
  },
  get 'GET:/api/v1/templates/network-options'() {
    return demoNetworkOptions()
  },
  'GET:/api/v1/events/archive/settings': { retentionDays: 90, maxRetentionDays: 730 },
  'GET:/api/v1/backups/restore-drills/settings': DRILL_SETTINGS,
}

export const resolveOperationsMock: DemoMockResolver = (method, cleanPath, url) => {
  if (method === 'POST' && cleanPath === '/api/v1/orchestrator/reports/preview') return demoReportPreview()
  if (method !== 'GET') return null

  if (cleanPath === '/api/v1/dashboard/top-consumers') return demoTopConsumers(url)
  if (cleanPath === '/api/v1/events/archive') return demoTaskArchive(url)
  if (cleanPath.startsWith('/api/v1/orchestrator/replication/')) return resolveReplication(cleanPath, url)

  const rolling = cleanPath.match(/^\/api\/v1\/orchestrator\/rolling-updates\/([^/]+)$/)

  if (rolling) return rollingUpdate(rolling[1])
  const runTask = cleanPath.match(/^\/api\/v1\/connections\/[^/]+\/backup-jobs\/runs\/[^/]+\/([^/]+)$/)

  if (runTask) return runTaskDetail(runTask[1])
  if (/^\/api\/v1\/connections\/[^/]+\/file-restore$/.test(cleanPath)) return fileRestoreList(url)
  if (/^\/api\/v1\/connections\/[^/]+\/file-restore\/preview$/.test(cleanPath)) return fileRestorePreview(url)

  if (cleanPath === '/api/v1/backups/restore-drills') return drillListPage(url)
  if (cleanPath === '/api/v1/backups/restore-drills/schedules') {
    const { schedule } = demoDrillSchedule()

    return { data: [schedule], total: 1 }
  }
  const schedule = cleanPath.match(/^\/api\/v1\/backups\/restore-drills\/schedules\/([^/]+)$/)

  if (schedule) {
    if (schedule[1] !== DRILL_SCHEDULE_ID) return null
    const { schedule: s, runs } = demoDrillSchedule()

    return { schedule: s, runs, events: runs.map(r => ({ ts: r.started_at, level: r.result === 'warning' ? 'warning' : 'info', stage: 'schedule', message: r.summary })) }
  }
  const drill = cleanPath.match(/^\/api\/v1\/backups\/restore-drills\/([^/]+)$/)

  if (drill) {
    const found = demoDrills().find(d => d.id === drill[1])

    return found ? { drill: found, events: drillEvents(found) } : null
  }

  return null
}
