import { describe, it, expect, vi, afterEach } from 'vitest'

import { staleRecommendations } from '@/components/automation/drs/recommendationPruning'
import { liveFingerprint } from '@/lib/ceph/live'
import { isCephHistory, isCephInventory, isCephLive, isCrushMap } from '@/lib/ceph/shape'
import { resolvePveNode } from '@/lib/ceph/osdTable'
import { buildCrushTopology } from '@/app/(dashboard)/infrastructure/inventory/components/cephCrushTopology'

import { EXTRA_MOCKS, demoResponse } from '../demo-api'

/**
 * Guards the shapes whose drift produced a visible defect on the live demo,
 * not just an empty screen. Each case names the consumer it has to satisfy, so
 * a future edit that reverts to the raw upstream shape fails here rather than
 * on demo.proxcenter.io.
 */

const get = (key: string): any => (EXTRA_MOCKS as Record<string, any>)[key]

describe('demo mock: shapes the screens actually read', () => {
  it('ceph health.checks is a LIST, not the raw PVE object', () => {
    // The Ceph cockpit (components/ceph/cockpit) maps `health.checks` as a
    // list. A raw `{}` is truthy, so an object shape throws instead of falling back.
    for (const key of [
      'GET:/api/v1/connections/demo-pve-cluster-001/ceph',
      'GET:/api/v1/connections/demo-pve-dr-001/ceph',
    ]) {
      const data = get(key).data
      expect(Array.isArray(data.health.checks), `${key} health.checks`).toBe(true)
      expect(data.health.numChecks).toBe(data.health.checks.length)
      // The page reads all of these directly.
      for (const k of ['capacity', 'performance', 'pgs', 'osds', 'monitors', 'pools', 'mds']) {
        expect(data, `${key} missing ${k}`).toHaveProperty(k)
      }
      expect(data.monitors.quorumNames.length).toBe(data.monitors.inQuorum)
      expect(data.osds.down).toBe(data.osds.total - data.osds.up)
      // One free-space reading per monitor, from the node it runs on, above the Ceph thresholds (the demo raises no MON_DISK_*).
      expect(data.monDisk.map((m: { mon: string }) => m.mon)).toEqual(data.monitors.list.map((m: { name: string }) => m.name))
      for (const m of data.monDisk) {
        expect(data.pveNodes, `${key} ${m.mon} node`).toContain(m.node)
        expect(m.availPct).toBeGreaterThan(30)
        expect(Math.abs(m.availPct - (m.availBytes / m.totalBytes) * 100)).toBeLessThan(0.1)
      }
      // The cockpit's shape guard refuses the legacy demo shape (managers list, PG state map).
      expect(isCephInventory(data), `${key} inventory shape`).toBe(true)
      // The stopped managers are a list of daemons the cockpit can start again, each on a node of the cluster.
      for (const g of data.managers.stopped ?? []) {
        expect(data.pveNodes, `${key} stopped mgr ${g.name}`).toContain(g.host)
        expect(data.managers.standbys.map((s: { name: string }) => s.name)).not.toContain(g.name)
      }
      for (const check of data.health.checks) for (const d of check.detail) expect(d).toHaveProperty('message')
      for (const pool of data.pools.list) for (const k of ['minSize', 'pgNum', 'bytesUsed', 'maxAvail', 'percentUsed']) expect(pool).toHaveProperty(k)
    }
  })

  it('the DR demo cluster shows a stopped manager next to its active and standby ones', () => {
    const dr = get('GET:/api/v1/connections/demo-pve-dr-001/ceph').data

    expect(dr.managers.stopped.map((g: { name: string }) => g.name)).toEqual(['pve-dr-04'])
    expect(get('GET:/api/v1/connections/demo-pve-cluster-001/ceph').data.managers.stopped).toEqual([])
  })

  it('ceph live reads follow the inventory of the same cluster', () => {
    for (const conn of ['demo-pve-cluster-001', 'demo-pve-dr-001']) {
      const inv = get(`GET:/api/v1/connections/${conn}/ceph`).data
      const live = get(`GET:/api/v1/connections/${conn}/ceph/live`).data
      expect(isCephLive(live), `${conn} live shape`).toBe(true)
      // The cockpit computes this on every read: it threw on the `{ data: [] }` fallback.
      expect(() => liveFingerprint(live)).not.toThrow()
      expect(live.health.status).toBe(inv.health.status)
      expect(live.osd).toEqual({ total: inv.osds.total, up: inv.osds.up, in: inv.osds.in })
      expect(live.pg.total).toBe(inv.pgs.total)
    }
    // The DR cluster tells a story: OSDs down, degraded PGs and a recovery.
    const dr = get('GET:/api/v1/connections/demo-pve-dr-001/ceph/live').data
    expect(dr.osd.up).toBeLessThan(dr.osd.total)
    expect(dr.pg.clean).toBeLessThan(dr.pg.total)
    expect(dr.recovery.bytesPerSec).toBeGreaterThan(0)
  })

  it('ceph crush maps carry every demo OSD under its host', () => {
    for (const conn of ['demo-pve-cluster-001', 'demo-pve-dr-001']) {
      const inv = get(`GET:/api/v1/connections/${conn}/ceph`).data
      const crush = get(`GET:/api/v1/connections/${conn}/ceph/crush`).data
      expect(isCrushMap(crush), `${conn} crush shape`).toBe(true)
      const hosts = crush.buckets.filter((b: any) => b.type === 'host')
      expect(hosts.map((h: any) => h.name).sort()).toEqual([...new Set(inv.osds.list.map((o: any) => o.host))].sort())
      expect(hosts.reduce((n: number, h: any) => n + h.children.length, 0)).toBe(inv.osds.total)
      expect(crush.rules.map((r: any) => r.name)).toContain('replicated_rule')
    }
  })

  it('ceph OSD hosts resolve to a demo node and carry their devices, so the cockpit actions stay on', () => {
    for (const conn of ['demo-pve-cluster-001', 'demo-pve-dr-001']) {
      const inv = get(`GET:/api/v1/connections/${conn}/ceph`).data

      expect(inv.pveNodes.length, conn).toBeGreaterThan(0)
      expect(Object.keys(inv.pveNodeStatus).sort(), conn).toEqual([...inv.pveNodes].sort())
      for (const n of inv.pveNodes) expect(typeof inv.pveNodeStatus[n], `${conn} ${n}`).toBe('string')
      for (const o of inv.osds.list) {
        expect(resolvePveNode(o.host, inv.pveNodes), `${conn} ${o.name}`).toBe(o.host)
        expect(o.osdType).toBe('bluestore')
        expect(typeof o.dataDevice).toBe('string')
      }
    }
  })

  it('syslog destinations are a FLAT body with destinations and status keyed by id', () => {
    // components/settings/SyslogDestinationsCard.tsx reads `data.destinations`
    // and `data.status[dest.id]` straight off the response, no `data` wrapper.
    const body = get('GET:/api/v1/settings/syslog')
    expect(body).not.toHaveProperty('data')
    expect(Array.isArray(body.destinations)).toBe(true)
    expect(body.destinations.length).toBeGreaterThan(0)
    for (const dest of body.destinations) {
      for (const k of ['id', 'name', 'enabled', 'host', 'port', 'transport', 'format', 'framing', 'facility', 'categories', 'tls']) {
        expect(dest, `destination ${dest.id} missing ${k}`).toHaveProperty(k)
      }
      expect(body.status, `status missing for ${dest.id}`).toHaveProperty(dest.id)
      expect(typeof body.status[dest.id].sent).toBe('number')
    }
    expect(body.limits.maxDestinations).toBe(20)
  })

  it('rbac assignments carry nested user and role objects', () => {
    // security/rbac/page.tsx:1153 builds its group key from `a.user.id` and
    // `a.role.id`; a flat userId/roleId pair throws on the first row.
    expect(get('GET:/api/v1/rbac/assignments'), 'must not shadow mock-data.json').toBeUndefined()
  })

  it('rbac roles expose the snake_case fields the roles tab reads', () => {
    const roles = get('GET:/api/v1/rbac/roles').data
    expect(roles.length).toBeGreaterThan(1)
    for (const r of roles) {
      for (const k of ['id', 'name', 'description', 'is_system', 'color', 'permissions', 'user_count']) {
        expect(r, `role ${r.id} missing ${k}`).toHaveProperty(k)
      }
      expect(Array.isArray(r.permissions)).toBe(true)
    }
    // Every role the seeded assignments reference must exist.
    const ids = new Set(roles.map((r: any) => r.id))
    for (const referenced of ['role_super_admin', 'role_tenant_admin']) {
      expect(ids.has(referenced), `assignments reference ${referenced}`).toBe(true)
    }
  })

  it('audit rows use the snake_case wire contract of getAuditLogs', () => {
    // security/audit/page.jsx reads row.timestamp / user_email / resource_type
    // / ip_address / status / category, and parses `details` as JSON.
    const payload = get('GET:/api/v1/audit')
    expect(payload.meta.total).toBe(payload.data.length)
    for (const row of payload.data) {
      for (const k of ['timestamp', 'user_email', 'action', 'category', 'resource_type', 'ip_address', 'status']) {
        expect(row, `audit ${row.id} missing ${k}`).toHaveProperty(k)
      }
      if (row.details !== null) {
        expect(() => JSON.parse(row.details), `audit ${row.id} details must be a JSON string`).not.toThrow()
      }
    }
  })

  it('orchestrator alerts use the Go wire contract and agree with their summary', () => {
    const alerts = get('GET:/api/v1/orchestrator/alerts').data
    for (const a of alerts) {
      for (const k of ['connection_id', 'resource', 'resource_type', 'current_value', 'unit', 'last_seen_at', 'occurrences']) {
        expect(a, `alert ${a.id} missing ${k}`).toHaveProperty(k)
      }
    }
    const summary = get('GET:/api/v1/orchestrator/alerts/summary').data
    const active = alerts.filter((a: any) => a.status === 'active')
    expect(summary.total_active).toBe(active.length)
    expect(summary.critical).toBe(active.filter((a: any) => a.severity === 'critical').length)
    expect(summary.warning).toBe(active.filter((a: any) => a.severity === 'warning').length)
  })

  it('reports types, languages and schedules are BARE arrays', () => {
    // useReports() gates each one on Array.isArray; a { data: [] } wrapper is
    // silently dropped and the whole Generate tab stays empty.
    for (const key of [
      'GET:/api/v1/orchestrator/reports/types',
      'GET:/api/v1/orchestrator/reports/languages',
      'GET:/api/v1/orchestrator/reports/schedules',
    ]) {
      expect(Array.isArray(get(key)), `${key} must be a bare array`).toBe(true)
    }
    expect(Array.isArray(get('GET:/api/v1/orchestrator/reports').data)).toBe(true)
  })

  it('orchestrator jobs stats are derived from the job list', () => {
    const payload = get('GET:/api/v1/orchestrator/jobs')
    const jobs = payload.data
    expect(payload.stats.total).toBe(jobs.length)
    expect(payload.stats.running).toBe(jobs.filter((j: any) => j.status === 'running').length)
    expect(payload.stats.failed).toBe(jobs.filter((j: any) => j.status === 'failed').length)
  })

  it('site recovery sites use cluster_id / role / node_count / vm_count', () => {
    const sites = get('GET:/api/v1/orchestrator/replication/status').sites
    expect(sites.length).toBe(2)
    for (const site of sites) {
      for (const k of ['cluster_id', 'name', 'role', 'status', 'node_count', 'vm_count']) {
        expect(site, `site ${site.name} missing ${k}`).toHaveProperty(k)
      }
    }
    expect(sites.map((s: any) => s.role)).toEqual(['primary', 'dr'])
  })

  it('site recovery status lists both engines', () => {
    // site-recovery/page.tsx falls back to ['rbd'] when engines is missing,
    // and the create dialog then shows ZFS as "Coming soon".
    expect(get('GET:/api/v1/orchestrator/replication/status').engines).toEqual(['rbd', 'zfs'])
  })

  it('drs recommendations agree with the metrics the page prunes them against', () => {
    // automation/drs/page.tsx rejects a recommendation whose source node is
    // not above its cluster's average memory; the demo cannot reject, so a
    // stale one was rejected again on every refresh.
    const recs = get('GET:/api/v1/orchestrator/drs/recommendations')
    const metrics = get('GET:/api/v1/orchestrator/metrics')
    expect(recs.length).toBeGreaterThan(0)
    expect(staleRecommendations(recs, metrics)).toEqual([])
    const nodes = metrics['demo-pve-cluster-001'].nodes
    const avg = nodes.reduce((sum: number, n: any) => sum + n.memory_usage, 0) / nodes.length
    for (const rec of recs) {
      expect(nodes.find((n: any) => n.node === rec.target_node).memory_usage, `${rec.id} target`).toBeLessThan(avg)
      // drsReason.ts translates the code; free text stays English everywhere.
      expect(['highMemory', 'homogenization'], `${rec.id} reason_code`).toContain(rec.reason_code)
    }
  })

  it('drs history rows carry a reason code', () => {
    // MigrationHistoryTab shows "Reason not recorded" without one.
    const migrations = get('GET:/api/v1/orchestrator/drs/migrations')
    expect(migrations.length).toBeGreaterThan(0)
    for (const m of migrations) expect(m.reason_code, m.id).toBe('homogenization')
  })

  it('ha config is a bare HaConfig, the shape useHaConfig types', () => {
    const cfg = get('GET:/api/v1/ha/config')
    for (const k of ['enabled', 'vip', 'deploymentState', 'deploymentStep', 'nodes']) {
      expect(cfg, `ha config missing ${k}`).toHaveProperty(k)
    }
    expect(cfg).not.toHaveProperty('data')
  })

  it('hardening report is flat, with a computeScore-shaped summary', () => {
    // The Hardening tab reads data.checks / data.summary / data.score at the
    // TOP level and sorts on pass/fail/warning/skip. A { data } wrapper or the
    // passed/failed vocabulary leaves every counter at zero.
    for (const key of [
      'GET:/api/v1/compliance/hardening/demo-pve-cluster-001',
      'GET:/api/v1/compliance/hardening/demo-pve-dr-001',
    ]) {
      const report = get(key)
      expect(report, `${key} must not be wrapped in data`).not.toHaveProperty('data')
      for (const k of ['connectionId', 'connectionName', 'score', 'checks', 'summary', 'scannedAt']) {
        expect(report, `${key} missing ${k}`).toHaveProperty(k)
      }
      expect(report.summary.total).toBe(report.checks.length)
      expect(report.score).toBe(report.summary.score)
      for (const c of report.checks) {
        expect(['pass', 'fail', 'warning', 'skip'], `${c.id} status`).toContain(c.status)
        expect(typeof c.maxPoints).toBe('number')
        expect(typeof c.earned).toBe('number')
      }
    }
  })
})

describe('demo mock: endpoints keyed by an id in the path', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  const fetchDemo = async (path: string) => {
    vi.stubEnv('DEMO_MODE', 'true')
    const res = await demoResponse(new Request(`http://localhost${path}`))
    return res!.json()
  }

  it('replicable vms are a bare ReplicableVM list', async () => {
    // CreateJobDialog maps the response straight away: { data: [] } crashed it.
    const vms = await fetchDemo('/api/v1/connections/demo-pve-cluster-001/replicable-vms?engine=zfs')
    expect(Array.isArray(vms)).toBe(true)
    expect(vms.length).toBeGreaterThan(0)
    for (const k of ['vmid', 'node', 'diskGb', 'mixed', 'unsupported']) expect(vms[0]).toHaveProperty(k)
  })

  it('ceph history answers the Enterprise CephHistory per range, 400 on an unknown range', async () => {
    // The demo announces Enterprise, so the cockpit offers 1 h to 30 d and reads this.
    for (const [range, step, count] of [['1h', 60, 60], ['24h', 300, 288], ['7d', 1800, 336], ['30d', 7200, 360]] as const) {
      const body = await fetchDemo(`/api/v1/orchestrator/ceph/demo-pve-cluster-001/history?range=${range}`)
      expect(isCephHistory(body.data), range).toBe(true)
      expect(body.data.step).toBe(step)
      expect(body.data.points).toHaveLength(count)
      expect(body.data.points.every((p: any) => Number.isInteger(p.time) && p.osd_total === 36)).toBe(true)
      expect(body.data.slowest_osds.length).toBeLessThanOrEqual(8)
    }
    const dr = await fetchDemo('/api/v1/orchestrator/ceph/demo-pve-dr-001/history?range=1h')
    expect(dr.data.points[0].health).toBe(2)
    vi.stubEnv('DEMO_MODE', 'true')
    const bad = await demoResponse(new Request('http://localhost/api/v1/orchestrator/ceph/demo-pve-cluster-001/history?range=9y'))
    expect(bad!.status).toBe(400)
  })

  it('ceph exporter readings grow with time and follow the inventory hosts', async () => {
    vi.useFakeTimers()
    try {
      const inv = get('GET:/api/v1/connections/demo-pve-cluster-001/ceph').data
      const osd = inv.osds.list[0]
      const url = `/api/v1/connections/demo-pve-cluster-001/nodes/${osd.host}/ceph/exporter?osd=${osd.id}`
      vi.setSystemTime(new Date('2026-11-01T10:00:00Z'))
      const first = (await fetchDemo(url)).data
      vi.setSystemTime(new Date('2026-11-01T10:00:05Z'))
      const second = (await fetchDemo(url)).data
      for (const k of ['op_r', 'op_w', 'op_r_out_bytes', 'op_w_in_bytes']) {
        expect(Number.isInteger(first[k]), k).toBe(true)
        expect(second[k], k).toBeGreaterThan(first[k])
      }
      expect(second.osd).toBe(osd.id)
      expect(second.at - first.at).toBe(5000)

      const hosts = [...new Set(inv.osds.list.map((o: any) => o.host))].slice(0, 2) as string[]
      const grouped = (await fetchDemo(`/api/v1/connections/demo-pve-cluster-001/ceph/exporter?nodes=${hosts.join(',')}`)).data
      expect(Object.keys(grouped.nodes)).toEqual(hosts)
      const expected = inv.osds.list.filter((o: any) => hosts.includes(o.host))
      expect(Object.keys(grouped.osds).sort()).toEqual(expected.map((o: any) => String(o.id)).sort())
      expect(grouped.osds[String(osd.id)].node).toBe(osd.host)

      vi.stubEnv('DEMO_MODE', 'true')
      const tooMany = Array.from({ length: 21 }, (_, i) => `n${i}`).join(',')
      const over = await demoResponse(new Request(`http://localhost/api/v1/connections/demo-pve-cluster-001/ceph/exporter?nodes=${tooMany}`))
      expect(over!.status).toBe(400)
      const wrongNode = await demoResponse(new Request(`http://localhost/api/v1/connections/demo-pve-cluster-001/nodes/nope/ceph/exporter?osd=${osd.id}`))
      expect(wrongNode!.status).toBe(404)
      expect((await wrongNode!.json()).code).toBe('osd_not_exported')
    } finally {
      vi.useRealTimers()
    }
  })

  it('ceph pools tab: the demo rbd storage of each cluster names a pool of that cluster inventory', async () => {
    // The Pools tab reads /connections/<id>/storage once and matches the `pool` field of the rbd and cephfs storages to a pool name.
    for (const conn of ['demo-pve-cluster-001', 'demo-pve-dr-001']) {
      const storages = (await fetchDemo(`/api/v1/connections/${conn}/storage`)).data
      const rbd = storages.filter((s: any) => s.type === 'rbd')
      const names = get(`GET:/api/v1/connections/${conn}/ceph`).data.pools.list.map((p: any) => p.name)

      expect(rbd.length, conn).toBeGreaterThan(0)
      for (const s of rbd) expect(names, `${conn} ${s.storage}`).toContain(s.pool)
    }
  })

  it('drs migration check is a MigrationCheckResult', async () => {
    const check = await fetchDemo('/api/v1/orchestrator/drs/check-migration/101?connection_id=demo-pve-cluster-001')
    expect(check.can_migrate).toBe(true)
    expect(check.local_disks).toEqual([])
    expect(check.total_shared_size).toBe(check.shared_disks[0].size)
  })
})

describe('demo mock: Ceph cockpit per-OSD history, precheck, exporter failure, CRUSH topology and status', () => {
  const PROD = 'demo-pve-cluster-001'
  const DR = 'demo-pve-dr-001'
  const NOW = new Date('2026-11-02T10:00:00Z')

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  const raw = async (path: string, method = 'GET') => {
    vi.stubEnv('DEMO_MODE', 'true')
    const res = await demoResponse(new Request(`http://localhost${path}`, { method }))

    return { status: res!.status, body: await res!.json() }
  }
  const inventory = (conn: string) => get(`GET:/api/v1/connections/${conn}/ceph`).data
  const history = (conn: string, query: string) => raw(`/api/v1/orchestrator/ceph/${conn}/history?${query}`)

  it('history with osds answers osd_series, the latency curve per OSD that useCephOsdLatencySeries reads', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    for (const range of ['1h', '24h', '7d', '30d']) {
      const { status, body } = await history(PROD, `range=${range}&top=1&osds=0,1,2`)

      expect(status, range).toBe(200)
      expect(isCephHistory(body.data), range).toBe(true)
      expect(Object.keys(body.data.osd_series).sort(), range).toEqual(['0', '1', '2'])
      expect(body.data.osd_io_series, range).toBeUndefined()
      expect(body.data.exporter, range).toBeUndefined()
      for (const points of Object.values<any[]>(body.data.osd_series)) {
        expect(points.length, range).toBeGreaterThan(1)
        expect(points.length, range).toBeLessThanOrEqual(60)
        for (const p of points) {
          expect(Number.isInteger(p.time) && Number.isFinite(p.avg_ms) && Number.isFinite(p.max_ms), range).toBe(true)
          expect(p.max_ms, range).toBeGreaterThanOrEqual(p.avg_ms)
        }
      }
    }
  })

  it('history without osds carries neither osd_series nor osd_io_series', async () => {
    const { body } = await history(PROD, 'range=1h')

    expect(body.data.osd_series).toBeUndefined()
    expect(body.data.osd_io_series).toBeUndefined()
  })

  it('osd_series scrolls with the clock: the same instant reads the same value, a later call shifts the window', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const first = (await history(PROD, 'range=24h&top=1&osds=4')).body.data.osd_series['4']
    vi.setSystemTime(new Date(NOW.getTime() + 3 * 3600_000))
    const later = (await history(PROD, 'range=24h&top=1&osds=4')).body.data.osd_series['4']
    const laterByTime = new Map<number, any>(later.map((p: any) => [p.time, p]))
    const shared = first.filter((p: any) => laterByTime.has(p.time))

    expect(shared.length).toBeGreaterThan(10)
    expect(shared.length).toBeLessThan(first.length)
    for (const p of shared) expect(laterByTime.get(p.time)).toEqual(p)
  })

  it('osd_io=1 answers osd_io_series and the exporter state, in the rate range of the exporter readings', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const inv = inventory(PROD)
    const { status, body } = await history(PROD, 'range=1h&top=1&osds=0,1,2&osd_io=1')

    expect(status).toBe(200)
    expect(isCephHistory(body.data)).toBe(true)
    expect(Object.keys(body.data.osd_io_series).sort()).toEqual(['0', '1', '2'])
    expect(Object.keys(body.data.osd_series).sort()).toEqual(['0', '1', '2'])
    const hosts = [...new Set(inv.osds.list.map((o: any) => o.host))]
    expect(Object.keys(body.data.exporter.nodes).sort()).toEqual([...hosts].sort())
    for (const n of Object.values<any>(body.data.exporter.nodes)) {
      expect(n.ok).toBe(true)
      expect(Number.isInteger(n.last_ok)).toBe(true)
    }

    // The same OSD read through the exporter counters (rate over 5 s) and through the stored history.
    const osd = inv.osds.list[1]
    const url = `/api/v1/connections/${PROD}/nodes/${osd.host}/ceph/exporter?osd=${osd.id}`
    const a = (await raw(url)).body.data
    vi.setSystemTime(new Date(NOW.getTime() + 5000))
    const b = (await raw(url)).body.data
    const live = { readOps: (b.op_r - a.op_r) / 5, writeOps: (b.op_w - a.op_w) / 5, readBytes: (b.op_r_out_bytes - a.op_r_out_bytes) / 5, writeBytes: (b.op_w_in_bytes - a.op_w_in_bytes) / 5 }
    const points = body.data.osd_io_series[String(osd.id)]

    expect(points.length).toBeGreaterThan(1)
    expect(points.length).toBeLessThanOrEqual(60)
    for (const p of points) {
      expect(Number.isInteger(p.time)).toBe(true)
      for (const k of ['read_ops', 'write_ops', 'read_bytes', 'write_bytes']) expect(Number.isFinite(p[k]) && p[k] > 0, k).toBe(true)
    }
    const mean = (k: string) => points.reduce((n: number, p: any) => n + p[k], 0) / points.length
    const pairs: [string, number][] = [['read_ops', live.readOps], ['write_ops', live.writeOps], ['read_bytes', live.readBytes], ['write_bytes', live.writeBytes]]

    for (const [k, rate] of pairs) {
      expect(mean(k) / rate, k).toBeGreaterThan(0.5)
      expect(mean(k) / rate, k).toBeLessThan(2)
    }
  })

  it('the per-OSD curves of one range do not peak at the same moment', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const ids = Array.from({ length: 12 }, (_, i) => i).join(',')
    const { body } = await history(PROD, `range=24h&top=1&osds=${ids}&osd_io=1`)
    const peakOf = (points: any[], k: string) => points.reduce((best, p) => (p[k] > best[k] ? p : best), points[0]).time
    const ioPeaks = new Set(Object.values<any[]>(body.data.osd_io_series).map(points => peakOf(points, 'read_ops')))
    const latPeaks = new Set(Object.values<any[]>(body.data.osd_series).map(points => peakOf(points, 'avg_ms')))

    expect(ioPeaks.size).toBeGreaterThanOrEqual(5)
    expect(latPeaks.size).toBeGreaterThanOrEqual(5)
  })

  it('history refuses what the real route refuses: bad osds, more than 100 distinct ids, osd_io without osds', async () => {
    const many = Array.from({ length: 101 }, (_, i) => i).join(',')

    expect((await history(PROD, `range=1h&osds=${many}`)).status).toBe(400)
    expect((await history(PROD, 'range=1h&osds=1,x')).status).toBe(400)
    expect((await history(PROD, 'range=1h&osds=')).status).toBe(400)
    expect((await history(PROD, 'range=1h&osds=-1')).status).toBe(400)
    expect((await history(PROD, 'range=1h&osd_io=1')).status).toBe(400)
    expect((await history(PROD, 'range=1h&osds=1&osd_io=2')).status).toBe(400)
    // Repeated ids count once.
    const repeated = Array.from({ length: 150 }, (_, i) => i % 3).join(',')
    const ok = await history(PROD, `range=1h&osds=${repeated}`)

    expect(ok.status).toBe(200)
    expect(Object.keys(ok.body.data.osd_series).sort()).toEqual(['0', '1', '2'])
  })

  it('the DR cluster has no curve for a down OSD after it went down, an OSD that is up keeps its curve', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const { body } = await history(DR, 'range=1h&top=1&osds=0,10&osd_io=1')
    const last = (points: any[]) => points[points.length - 1].time
    const to = Math.floor(NOW.getTime() / 1000 / 60) * 60

    expect(last(body.data.osd_series['0'])).toBeGreaterThan(to - 300)
    expect(last(body.data.osd_series['10'])).toBeLessThan(to - 30 * 60)
    expect(last(body.data.osd_io_series['10'])).toBeLessThan(to - 30 * 60)
  })

  it('ok-to-stop answers the OkToStopPayload: ok on the healthy cluster, refused on the DR one, 404 for an unknown OSD or node', async () => {
    const prod = inventory(PROD).osds.list[5]
    const ok = await raw(`/api/v1/connections/${PROD}/nodes/${prod.host}/ceph/osd/${prod.id}/ok-to-stop`, 'POST')

    expect(ok.status).toBe(200)
    expect(ok.body.data).toMatchObject({ ok: true, osds: [prod.id], numNotOkPgs: 0, message: null })
    expect(ok.body.data.numOkPgs).toBeGreaterThan(0)

    const dr = inventory(DR)
    const upOsd = dr.osds.list[0]
    const notClean = dr.pgs.states.filter((s: any) => s.state_name !== 'active+clean').reduce((n: number, s: any) => n + s.count, 0)
    const refused = await raw(`/api/v1/connections/${DR}/nodes/${upOsd.host}/ceph/osd/${upOsd.id}/ok-to-stop`, 'POST')

    expect(notClean).toBeGreaterThan(0)
    expect(refused.status).toBe(200)
    expect(refused.body.data).toMatchObject({ ok: false, osds: [upOsd.id], numNotOkPgs: notClean, message: null })

    expect((await raw(`/api/v1/connections/${PROD}/nodes/${prod.host}/ceph/osd/9999/ok-to-stop`, 'POST')).status).toBe(404)
    expect((await raw(`/api/v1/connections/${PROD}/nodes/nope/ceph/osd/${prod.id}/ok-to-stop`, 'POST')).status).toBe(404)
    expect((await raw(`/api/v1/connections/${PROD}/nodes/${prod.host}/ceph/osd/x/ok-to-stop`, 'POST')).status).toBe(400)
    // The actions themselves stay disabled in the demo.
    const action = await raw(`/api/v1/connections/${PROD}/nodes/${prod.host}/ceph/osd/${prod.id}/out`, 'POST')

    expect(action.body.message).toBe('Action disabled in demo mode')
  })

  it('the exporter of the last DR host is refused: grouped route, per-OSD route and history agree, PROD stays fully ok', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const dr = inventory(DR)
    const hosts = [...new Set(dr.osds.list.map((o: any) => o.host))] as string[]
    const failed = hosts[hosts.length - 1]
    const failedOsds = dr.osds.list.filter((o: any) => o.host === failed)
    const grouped = (await raw(`/api/v1/connections/${DR}/ceph/exporter?nodes=${hosts.join(',')}`)).body.data

    expect(grouped.nodes[failed]).toEqual({ ok: false, reason: 'refused' })
    for (const h of hosts.filter(h => h !== failed)) expect(grouped.nodes[h]).toEqual({ ok: true })
    for (const o of failedOsds) expect(grouped.osds[String(o.id)]).toBeUndefined()
    expect(Object.values<any>(grouped.osds).every(o => o.node !== failed)).toBe(true)

    const single = await raw(`/api/v1/connections/${DR}/nodes/${failed}/ceph/exporter?osd=${failedOsds[0].id}`)

    expect(single.status).toBe(503)
    expect(single.body).toEqual({ code: 'exporter_unreachable', error: 'The Ceph exporter of this node is not reachable', reason: 'refused' })

    const upOnFailed = failedOsds.find((o: any) => o.up)
    const ids = dr.osds.list.map((o: any) => o.id).join(',')
    const hist = (await history(DR, `range=1h&top=1&osds=${ids}&osd_io=1`)).body.data

    expect(hist.exporter.nodes[failed]).toEqual({ ok: false, last_ok: null })
    for (const h of hosts.filter(h => h !== failed)) expect(hist.exporter.nodes[h].ok).toBe(true)
    for (const o of failedOsds) expect(hist.osd_io_series[String(o.id)]).toBeUndefined()
    expect(upOnFailed).toBeDefined()
    expect(hist.osd_series[String(upOnFailed.id)].length).toBeGreaterThan(1)

    const prod = inventory(PROD)
    const prodHosts = [...new Set(prod.osds.list.map((o: any) => o.host))] as string[]
    const prodGrouped = (await raw(`/api/v1/connections/${PROD}/ceph/exporter?nodes=${prodHosts.slice(0, 20).join(',')}`)).body.data

    for (const n of Object.values<any>(prodGrouped.nodes)) expect(n).toEqual({ ok: true })
    const prodHist = (await history(PROD, 'range=1h&top=1&osds=0&osd_io=1')).body.data

    for (const n of Object.values<any>(prodHist.exporter.nodes)) expect(n.ok).toBe(true)
  })

  it('the inventory Ceph tab gets a CRUSH tree it can draw, built from the same hosts and OSDs as the cockpit CRUSH map', () => {
    for (const conn of [PROD, DR]) {
      const inv = inventory(conn)

      expect(inv.crushTree.length, conn).toBeGreaterThan(0)
      expect(inv.crushRules.length, conn).toBeGreaterThan(0)
      const { tree, poolRules } = buildCrushTopology(inv)

      expect(tree, conn).toHaveLength(1)
      expect(tree[0]).toMatchObject({ type: 'root', name: 'default', osdCount: inv.osds.total, osdUp: inv.osds.up })
      const hosts = tree[0].children!

      expect(hosts.map(h => h.name).sort(), conn).toEqual([...new Set(inv.osds.list.map((o: any) => o.host))].sort())
      expect(hosts.every(h => h.type === 'host' && (h.children?.length ?? 0) > 0), conn).toBe(true)
      expect(tree[0].classes, conn).toEqual([...new Set(inv.osds.list.map((o: any) => o.deviceClass))].sort())
      const leaves = hosts.flatMap(h => h.children!)

      expect(leaves.every(l => l.type === 'osd' && l.osd), conn).toBe(true)
      expect(leaves.map(l => Number(l.id)).sort((a, b) => a - b), conn).toEqual(inv.osds.list.map((o: any) => o.id))
      expect(poolRules.length, conn).toBe(inv.pools.total)
      expect(poolRules.every(r => r.ruleName === 'replicated_rule' && r.target === 'default'), conn).toBe(true)
      // The tree and the cockpit CRUSH map describe the same hosts.
      const crush = get(`GET:/api/v1/connections/${conn}/ceph/crush`).data

      expect(crush.buckets.filter((b: any) => b.type === 'host').map((b: any) => b.name).sort(), conn).toEqual(hosts.map(h => h.name).sort())
    }
    // The DR tree shows its down OSDs.
    expect(buildCrushTopology(inventory(DR)).tree[0].osdUp).toBeLessThan(inventory(DR).osds.total)
  })

  it('the inventory Ceph tab header (/ceph/status) tells the same story as the cockpit inventory', () => {
    for (const conn of [PROD, DR]) {
      const inv = inventory(conn)
      const status = get(`GET:/api/v1/connections/${conn}/ceph/status`).data

      expect(status.osdmap).toMatchObject({ num_osds: inv.osds.total, num_up_osds: inv.osds.up, num_in_osds: inv.osds.in })
      expect(status._normalized.osd).toMatchObject({ num_osds: inv.osds.total, num_up_osds: inv.osds.up, num_in_osds: inv.osds.in })
      expect(status._normalized.osd.list).toHaveLength(inv.osds.total)
      expect(status._normalized.osd.list.filter((o: any) => o.up)).toHaveLength(inv.osds.up)
      expect(status.pgmap.num_pgs).toBe(inv.pgs.total)
      expect(status.pgmap.pgs_by_state).toEqual(inv.pgs.states)
      expect(status.pgmap.bytes_total).toBe(inv.capacity.rawTotalBytes)
      expect(status.pgmap.bytes_used).toBe(inv.capacity.rawUsedBytes)
      expect(status.health.status).toBe(inv.health.status)
      expect(Object.keys(status.health.checks).sort()).toEqual(inv.health.checks.map((c: any) => c.name).sort())
      expect(status._normalized.healthChecks.map((c: any) => c.name).sort()).toEqual(inv.health.checks.map((c: any) => c.name).sort())
      expect(status.monmap.mons.map((m: any) => m.name)).toEqual(inv.monitors.list.map((m: any) => m.name))
      expect(status.mgrmap.active_name).toBe(inv.managers.active.name)
      expect(status.mgrmap.standbys.map((m: any) => m.name)).toEqual(inv.managers.standbys.map((m: any) => m.name))
      expect(status._normalized.mds.map((m: any) => m.name)).toEqual(inv.mds.list.map((m: any) => m.name))
    }
    // The DR header names its down OSDs, like the cockpit.
    expect(get(`GET:/api/v1/connections/${DR}/ceph/status`).data.health.checks.OSD_DOWN.detail[0].message).toContain('osd.10')
  })

  it('the /ceph/status throughput and IOPS move with the clock, read and write independently, and stay near the inventory figures', () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    const inv = inventory(PROD)
    const reads: number[] = []
    const writeOps: number[] = []

    for (let i = 0; i < 60; i++) {
      const pg = get(`GET:/api/v1/connections/${PROD}/ceph/status`).data.pgmap

      for (const k of ['read_bytes_sec', 'write_bytes_sec', 'read_op_per_sec', 'write_op_per_sec']) expect(Number.isInteger(pg[k]) && pg[k] > 0, k).toBe(true)
      reads.push(pg.read_bytes_sec)
      writeOps.push(pg.write_op_per_sec)
      vi.setSystemTime(new Date(NOW.getTime() + (i + 1) * 2000))
    }
    const spread = (xs: number[]) => (Math.max(...xs) - Math.min(...xs)) / (xs.reduce((a, b) => a + b, 0) / xs.length)

    expect(new Set(reads).size).toBeGreaterThan(30)
    expect(spread(reads)).toBeGreaterThan(0.08)
    expect(spread(writeOps)).toBeGreaterThan(0.08)
    for (const r of reads) {
      expect(r / inv.performance.readBytesSec).toBeGreaterThan(0.4)
      expect(r / inv.performance.readBytesSec).toBeLessThan(1.7)
    }
    // Read and write do not move in lockstep.
    const norm = (xs: number[]) => xs.map(x => x / (xs.reduce((a, b) => a + b, 0) / xs.length))
    const nr = norm(reads)
    const nw = norm(writeOps)

    expect(nr.some((x, i) => Math.abs(x - nw[i]) > 0.03)).toBe(true)
    // Same instant, same value.
    vi.setSystemTime(NOW)
    const a = get(`GET:/api/v1/connections/${PROD}/ceph/status`).data.pgmap
    const b = get(`GET:/api/v1/connections/${PROD}/ceph/status`).data.pgmap

    expect(a).toEqual(b)
  })

  it('no demo path is answered twice: EXTRA_MOCKS and mock-data.json share no Ceph status key', async () => {
    const data = (await import('../mock-data.json')).default as Record<string, unknown>

    expect(Object.keys(data).filter(k => k.endsWith('/ceph/status') && `GET:${k}` in EXTRA_MOCKS)).toEqual([])
  })
})
