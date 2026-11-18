import { describe, expect, it } from 'vitest'

import { clusterState, type ClusterStateInput } from './clustersOfPolicyModel'

const status = (over: { stop?: boolean; since?: string; firewall?: 'enabled' | 'disabled' | 'unknown' } = {}): ClusterStateInput['status'] => ({
  emergency_stop: !!over.stop,
  engine: { paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall: over.firewall ?? 'enabled', unreachable_since: over.since },
})

describe('clusterState', () => {
  const T = '2026-11-17T08:00:00Z'
  const cases: [string, ClusterStateInput, string][] = [
    ['unread status', { status: undefined, active: true, stopDisabled: false }, 'unknown'],
    ['unread status of an inactive link', { status: undefined, active: false, stopDisabled: false }, 'unknown'],
    ['stop beats unreachable and firewall off', { status: status({ stop: true, since: T, firewall: 'disabled' }), active: false, stopDisabled: true }, 'stop'],
    ['unreachable beats firewall off and pending', { status: status({ since: T, firewall: 'disabled' }), active: false, stopDisabled: false }, 'unreachable'],
    ['firewall off by hand beats pending', { status: status({ firewall: 'disabled' }), active: false, stopDisabled: false }, 'firewallOff'],
    ['firewall still off after a lift', { status: status({ firewall: 'disabled' }), active: true, stopDisabled: true }, 'firewallOff'],
    ['inactive link', { status: status(), active: false, stopDisabled: false }, 'pending'],
    ['applied', { status: status(), active: true, stopDisabled: false }, 'applied'],
    ['firewall state unknown reads as applied', { status: status({ firewall: 'unknown' }), active: true, stopDisabled: false }, 'applied'],
  ]
  it.each(cases)('%s', (_name, input, key) => {
    expect(clusterState(input).key).toBe(key)
  })

  it('carries the time of an unreachable cluster', () => {
    expect(clusterState({ status: status({ since: T }), active: true, stopDisabled: false })).toEqual({ key: 'unreachable', since: T })
  })
})
