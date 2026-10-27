import { describe, expect, it } from 'vitest'

import { PERIODS } from '@/lib/availability/period'

import {
  DEMO_AVAILABILITY_CONNECTION_ID,
  demoAvailabilityResponse,
  demoMaintenanceWindows,
  demoOverview,
  demoPolicies,
  demoPolicyDetail,
  demoSettings,
} from './availabilityDemo'

const NOW = new Date('2026-10-27T10:00:30Z')
const SLOTS: Record<string, number> = { '1h': 60, '24h': 1440, '7d': 1008, '30d': 720 }

describe('demoOverview', () => {
  it('describes one connection with a cluster row and three nodes', () => {
    const o = demoOverview('24h', NOW)
    expect(o.period).toBe('24h')
    expect(o.connections).toHaveLength(1)
    const c = o.connections[0]
    expect(c.id).toBe(DEMO_AVAILABILITY_CONNECTION_ID)
    expect(c.cluster?.ref.kind).toBe('cluster')
    expect(c.nodes.map(n => n.ref.node)).toEqual(['pve-node-01', 'pve-node-02', 'pve-node-03'])
    expect(o.tiles).toMatchObject({ nodesTotal: 3, nodesUp: 3, clustersTotal: 1, clustersQuorate: 1 })
    expect(o.current.states).toHaveLength(4)
  })

  it.each(PERIODS)('generates the slots of %s over its own window', period => {
    const o = demoOverview(period, NOW)
    for (const n of o.connections[0].nodes) {
      expect(n.slots).toHaveLength(SLOTS[period])
      const total = n.up_seconds + n.down_seconds + n.maintenance_seconds + n.unobserved_seconds
      expect(total).toBe((Date.parse(o.to) - Date.parse(o.from)) / 1000)
      expect(Date.parse(n.slots[0].start)).toBe(Date.parse(o.from))
    }
  })

  it('has one 47 minute incident on one node over 24 h', () => {
    const nodes = demoOverview('24h', NOW).connections[0].nodes
    const down = nodes.filter(n => n.down_seconds > 0)
    expect(down).toHaveLength(1)
    expect(down[0].down_seconds).toBe(47 * 60)
    expect(down[0].incidents).toHaveLength(1)
    expect(down[0].incidents[0].state).toBe('down')
    expect(down[0].slots.filter(s => s.state === 'down')).toHaveLength(47)
    expect(down[0].availability).toBeCloseTo((1 - 47 / 1440) * 100, 6)
  })

  it('has one node that spent 2 h in maintenance, outside both rates', () => {
    const nodes = demoOverview('24h', NOW).connections[0].nodes
    const maint = nodes.filter(n => n.maintenance_seconds > 0)
    expect(maint).toHaveLength(1)
    expect(maint[0].maintenance_seconds).toBe(2 * 3600)
    expect(maint[0].availability).toBe(100)
    expect(maint[0].slots.filter(s => s.state === 'maintenance')).toHaveLength(120)
  })

  it('keeps the connection summary in line with its nodes', () => {
    const c = demoOverview('24h', NOW).connections[0]
    expect(c.summary.down_seconds).toBe(47 * 60)
    expect(c.summary.coverage).toBe(100)
    expect(c.summary.budget).toBeNull()
  })
})

describe('policies', () => {
  it('lists the two policies of the demo, one respected, one violated', () => {
    const p = demoPolicies('24h', 1, NOW)
    expect(p).toMatchObject({ total: 2, page: 1, pageSize: 20, period: '24h', defaultTarget: 99.9 })
    const [erp, web] = p.data
    expect(web).toMatchObject({ name: 'Production web', target: 99.9, enabled: true, guestCount: 2 })
    expect(erp).toMatchObject({ name: 'ERP', target: 99.95, guestCount: 2 })
    expect(web.summary?.below_target).toBe(0)
    expect(web.summary?.budget?.remaining_seconds).toBeGreaterThanOrEqual(0)
    expect(erp.summary?.below_target).toBe(1)
    expect(erp.summary?.budget?.remaining_seconds).toBeLessThan(0)
  })

  it('answers a page past the end with no row', () => {
    const p = demoPolicies('24h', 2, NOW)
    expect(p.data).toEqual([])
    expect(p.total).toBe(2)
  })

  it('details a policy with the name and type of its guests', () => {
    const d = demoPolicyDetail('demo-sla-web', '7d', NOW)
    expect(d?.policy.guests).toHaveLength(2)
    expect(d?.results).toHaveLength(2)
    expect(d?.results.every(r => r.ref.kind === 'guest' && r.name && (r.type === 'qemu' || r.type === 'lxc'))).toBe(true)
    expect(d?.results[0].slots).toHaveLength(1008)
    expect(demoPolicyDetail('nope', '24h', NOW)).toBeNull()
  })

  it('lists maintenance windows with an upcoming one', () => {
    const w = demoMaintenanceWindows(NOW)
    expect(w.total).toBe(1)
    expect(Date.parse(w.data[0].startsAt)).toBeGreaterThan(NOW.getTime())
    expect(Date.parse(w.data[0].endsAt)).toBeGreaterThan(Date.parse(w.data[0].startsAt))
  })

  it('serves the settings', () => {
    expect(demoSettings()).toEqual({ retentionDays: 400, defaultTarget: 99.9 })
  })
})

describe('demoAvailabilityResponse', () => {
  const ask = (path: string) => demoAvailabilityResponse(new URL(`http://x${path}`), NOW)

  it('answers the five paths', () => {
    expect(ask('/api/v1/availability/overview?period=1h')).toMatchObject({ period: '1h' })
    expect(ask('/api/v1/sla/policies')).toMatchObject({ total: 2, period: '30d' })
    expect(ask('/api/v1/sla/policies?fields=names')).toEqual({
      items: [
        { id: 'demo-sla-erp', name: 'ERP', enabled: true },
        { id: 'demo-sla-web', name: 'Production web', enabled: true },
      ],
    })
    expect(ask('/api/v1/sla/policies/demo-sla-erp?period=24h')).toMatchObject({ policy: { name: 'ERP' } })
    expect(ask('/api/v1/sla/maintenance-windows')).toMatchObject({ total: 1 })
    expect(ask('/api/v1/availability/settings')).toEqual({ retentionDays: 400, defaultTarget: 99.9 })
  })

  it('refuses an unknown period or policy and ignores other paths', () => {
    expect(ask('/api/v1/availability/overview?period=2h')).toEqual({ error: 'invalid_period' })
    expect(ask('/api/v1/sla/policies/zzz')).toEqual({ error: 'not_found' })
    expect(ask('/api/v1/sla/policies/%')).toEqual({ error: 'not_found' })
    expect(ask('/api/v1/other')).toBeUndefined()
  })
})
