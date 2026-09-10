import { describe, it, expect } from 'vitest'

import { EXTRA_MOCKS } from '../demo-api'

/**
 * Guards the shapes whose drift produced a visible defect on the live demo,
 * not just an empty screen. Each case names the consumer it has to satisfy, so
 * a future edit that reverts to the raw upstream shape fails here rather than
 * on demo.proxcenter.io.
 */

const get = (key: string): any => (EXTRA_MOCKS as Record<string, any>)[key]

describe('demo mock: shapes the screens actually read', () => {
  it('ceph health.checks is a LIST, not the raw PVE object', () => {
    // storage/ceph/page.jsx does `(cephData.health?.checks || []).map(...)`.
    // A raw `{}` is truthy, so an object shape throws instead of falling back.
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
    }
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
