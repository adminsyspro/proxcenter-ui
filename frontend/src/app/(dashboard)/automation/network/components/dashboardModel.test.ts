import { describe, expect, it } from 'vitest'

import type { FirewallCoverage } from '@/hooks/useZeroTrust'
import type { FirewallRule } from '@/lib/api/firewall'

import { coveragePercent, dashboardPhase, guestTotals, missingManagementPorts, scoreBand, todoItems, zeroTrustScore } from './dashboardModel'

const row = (vmid: number, status: string, enabled: boolean | null) => ({
  type: 'lxc' as const, node: 'pve1', vmid: String(vmid), name: `ct${vmid}`, status, tags: [],
  enabled, optionsEnabled: enabled, nicFirewall: enabled, options: null, vlans: [],
})

/** 62 guests, 33 running: 36 containers protected (30 running), 26 guests without firewall. */
function demoCoverage(): FirewallCoverage {
  const guests = [
    ...Array.from({ length: 36 }, (_, i) => row(100 + i, i < 30 ? 'running' : 'stopped', true)),
    ...Array.from({ length: 26 }, (_, i) => row(200 + i, i < 3 ? 'running' : 'stopped', false)),
  ]
  return { total: 62, measured: 62, enabled: 36, disabled: 26, unknown: 0, sampled: false, partial: false, computedAt: '2026-11-03T08:00:00Z', computing: false, guests }
}

const rule = (over: Partial<FirewallRule>): FirewallRule => ({ pos: 0, type: 'in', action: 'ACCEPT', enable: 1, ...over })

describe('coveragePercent', () => {
  it('leaves the unknown guests out and says nothing when none could be told', () => {
    expect(coveragePercent({ enabled: 3, disabled: 1, unknown: 6, measured: 10, total: 10 })).toBe(75)
    expect(coveragePercent({ enabled: 0, disabled: 0, unknown: 4, measured: 4, total: 4 })).toBeNull()
    expect(coveragePercent(null)).toBeNull()
  })
})

describe('guestTotals (one source for every card)', () => {
  it('takes the total from the inventory, running and stopped from the same guest list, protected as Proxmox applies it', () => {
    expect(guestTotals(demoCoverage())).toEqual({
      total: 62, running: 33, stopped: 29, protected: 36, unprotected: 26, unknown: 0, measured: 62, sampled: false,
    })
  })

  it('has no running or stopped count on an answer without guest rows, and nothing without an answer', () => {
    const { guests: _guests, ...noRows } = demoCoverage()
    expect(guestTotals(noRows)).toMatchObject({ running: null, stopped: null, total: 62 })
    expect(guestTotals(null)).toBeNull()
  })
})

describe('zeroTrustScore', () => {
  it('adds the three components: firewall 30, inbound DROP 25, coverage 45 x the protected share', () => {
    const score = zeroTrustScore({ firewallOn: true, policyIn: 'DROP', coverage: { enabled: 36, disabled: 26, unknown: 0, measured: 62, total: 62 } })

    expect(score.components).toEqual([
      { key: 'firewall', weight: 30, points: 30 },
      { key: 'policyIn', weight: 25, points: 25 },
      { key: 'coverage', weight: 45, points: 26 },
    ])
    expect(score.total).toBe(81)
    expect(Math.round(score.coveragePercent!)).toBe(58)
  })

  it('gives 0 to a firewall off and to an inbound ACCEPT (the outbound policy does not count)', () => {
    const score = zeroTrustScore({ firewallOn: false, policyIn: 'ACCEPT', coverage: { enabled: 0, disabled: 4, unknown: 0, measured: 4, total: 4 } })

    expect(score.components.map(c => c.points)).toEqual([0, 0, 0])
    expect(score.total).toBe(0)
  })

  it('computes no total until every component is known', () => {
    expect(zeroTrustScore({ firewallOn: null, policyIn: 'DROP', coverage: { enabled: 1, disabled: 0, unknown: 0, measured: 1, total: 1 } }).total).toBeNull()
    expect(zeroTrustScore({ firewallOn: true, policyIn: null, coverage: { enabled: 1, disabled: 0, unknown: 0, measured: 1, total: 1 } }).total).toBeNull()
    const noGuestTold = zeroTrustScore({ firewallOn: true, policyIn: 'DROP', coverage: { enabled: 0, disabled: 0, unknown: 3, measured: 3, total: 3 } })
    expect(noGuestTold.total).toBeNull()
    expect(noGuestTold.components[2].points).toBeNull()
  })

  it('bands the score', () => {
    expect([scoreBand(80), scoreBand(79), scoreBand(50), scoreBand(49)]).toEqual(['good', 'fair', 'fair', 'poor'])
  })
})

describe('missingManagementPorts', () => {
  it('finds the web UI and SSH in cluster rules, by port list, range or macro', () => {
    expect(missingManagementPorts([rule({ proto: 'tcp', dport: '8006' }), rule({ macro: 'SSH' })], [])).toEqual([])
    expect(missingManagementPorts([rule({ proto: 'tcp', dport: '22,8000:8010' })], [])).toEqual([])
  })

  it('reports what no enabled inbound ACCEPT lets in', () => {
    expect(missingManagementPorts([], [])).toEqual([8006, 22])
    expect(missingManagementPorts([rule({ proto: 'tcp', dport: '8006', enable: 0 }), rule({ dport: '22', action: 'DROP' })], [])).toEqual([8006, 22])
    expect(missingManagementPorts([rule({ proto: 'udp', dport: '8006' }), rule({ type: 'out', dport: '22' })], [])).toEqual([8006, 22])
  })

  it('reads the rules of an enabled security group the cluster references', () => {
    const groups = [{ group: 'mgmt', rules: [rule({ proto: 'tcp', dport: '8006' }), rule({ proto: 'tcp', dport: '22' })] }]

    expect(missingManagementPorts([rule({ type: 'group', action: 'mgmt' })], groups)).toEqual([])
    expect(missingManagementPorts([rule({ type: 'group', action: 'mgmt', enable: 0 })], groups)).toEqual([8006, 22])
  })
})

describe('todoItems', () => {
  const clean = { firewallOn: true, stopped: false, stopHoldsFirewall: false, policyIn: 'DROP', missingManagement: [], unprotected: 0, unzoned: 0, pendingFlows: { count: 0, more: false } }

  it('is empty when there is nothing to do', () => {
    expect(todoItems(clean)).toEqual([])
  })

  it('lists every line, most urgent first, with its figure', () => {
    expect(todoItems({ ...clean, missingManagement: [22], policyIn: 'ACCEPT', unprotected: 29, unzoned: 13, pendingFlows: { count: 100, more: true } })).toEqual([
      { kind: 'managementRules', ports: [22] },
      { kind: 'policyIn' },
      { kind: 'unprotected', count: 29 },
      { kind: 'unzoned', count: 13 },
      { kind: 'pendingFlows', count: 100, more: true },
    ])
  })

  it('offers the deployment wizard for a firewall that is off, never during an emergency stop', () => {
    expect(todoItems({ ...clean, firewallOn: false })).toEqual([{ kind: 'firewallOff' }])
    expect(todoItems({ ...clean, firewallOn: false, stopped: true, stopHoldsFirewall: true })).toEqual([{ kind: 'stopHeld' }])
    expect(todoItems({ ...clean, firewallOn: false, stopped: true })).toEqual([])
    expect(todoItems({ ...clean, stopped: true, missingManagement: [8006] })).toEqual([])
  })

  it('adds no line for what is not known', () => {
    expect(todoItems({ ...clean, unprotected: null, unzoned: null, pendingFlows: null })).toEqual([])
  })
})

describe('dashboardPhase', () => {
  const ready = { firewallLoading: false, loadError: false, coverageIn: true, coverageFailed: false, stopStateIn: true, microsegListsIn: true }

  it('shows everything once every read is in', () => {
    expect(dashboardPhase(ready)).toEqual({ cluster: 'ready', coverage: 'ready', score: 'ready', todo: 'ready' })
  })

  it('keeps one skeleton per block while its reads are not in', () => {
    expect(dashboardPhase({ ...ready, firewallLoading: true })).toEqual({ cluster: 'loading', coverage: 'ready', score: 'loading', todo: 'loading' })
    expect(dashboardPhase({ ...ready, coverageIn: false })).toEqual({ cluster: 'ready', coverage: 'loading', score: 'loading', todo: 'loading' })
  })

  it('waits for the stop state and the micro-segmentation lists before the "To do" list', () => {
    expect(dashboardPhase({ ...ready, stopStateIn: false }).todo).toBe('loading')
    expect(dashboardPhase({ ...ready, microsegListsIn: false }).todo).toBe('loading')
    expect(dashboardPhase({ ...ready, stopStateIn: false }).score).toBe('ready')
  })

  it('computes no score on a failed load or a failed coverage, and lists nothing on a failed load', () => {
    expect(dashboardPhase({ ...ready, loadError: true })).toEqual({ cluster: 'unavailable', coverage: 'ready', score: 'unavailable', todo: 'unavailable' })
    expect(dashboardPhase({ ...ready, coverageIn: false, coverageFailed: true })).toEqual({ cluster: 'ready', coverage: 'unavailable', score: 'unavailable', todo: 'ready' })
  })
})
