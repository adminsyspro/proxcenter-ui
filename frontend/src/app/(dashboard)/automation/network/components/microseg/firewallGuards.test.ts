/**
 * The firewall guards of a shared policy: what the checks say about a cluster whose firewall filters nothing, the
 * refusal of an apply over a switched-off firewall, and the cluster firewall state the banner reads.
 */

import { describe, expect, it } from 'vitest'

import type { PreflightCheck } from '@/lib/microseg/types'

import { clusterRunLine } from './ClusterRunRow'
import { status } from './microsegTestKit'
import { firewallFindings, firewallOffClusters, isFirewallOffRunError, preflightMessage } from './preflightModel'
import { clusterFirewallOff, firewallOffByHand } from './summaryModel'

const engine = (cluster_firewall: 'enabled' | 'disabled' | 'unknown') => ({ paused_until: null, held: false, last_runs: {}, last_log: null, cluster_firewall })
const stateOf = (stop: boolean, firewall: 'enabled' | 'disabled' | 'unknown') => status({ emergency_stop: stop, engine: engine(firewall) })

describe('firewallFindings', () => {
  const off: PreflightCheck = { id: 'cluster_firewall', status: 'fail', fix: 'enable_cluster_firewall' }

  it('says the cluster firewall is off when the check fails and the emergency stop does not hold it', () => {
    expect(firewallFindings([off, { id: 'firewall_service', status: 'pass' }])).toEqual({ off: true, serviceNodes: [] })
  })

  it('does not call it off when the stop holds it, when it passes, or when the read itself failed', () => {
    expect(firewallFindings([{ ...off, detail: { held_by_stop: true } }]).off).toBe(false)
    expect(firewallFindings([{ id: 'cluster_firewall', status: 'pass' }]).off).toBe(false)
    expect(firewallFindings([{ ...off, detail: { error: 'timeout' } }]).off).toBe(false)
  })

  it('names the nodes whose firewall service is stopped, and says nothing for a warning or a pass', () => {
    expect(firewallFindings([{ id: 'firewall_service', status: 'fail', detail: { nodes: ['pve1', 'pve2'] } }]).serviceNodes).toEqual(['pve1', 'pve2'])
    expect(firewallFindings([{ id: 'firewall_service', status: 'warn', detail: { unreadable: ['pve3'] } }]).serviceNodes).toEqual([])
    expect(firewallFindings([{ id: 'firewall_service', status: 'pass' }]).serviceNodes).toEqual([])
  })

  it('claims nothing about checks that could not be read', () => {
    expect(firewallFindings(undefined)).toEqual({ off: false, serviceNodes: [] })
    expect(firewallFindings([])).toEqual({ off: false, serviceNodes: [] })
  })
})

describe('the firewall service check', () => {
  it('has a title and says pass, the stopped nodes, and the nodes that could not be read', () => {
    expect(preflightMessage({ id: 'firewall_service', status: 'pass' })).toEqual({ title: 'firewall_service', detail: { key: 'checks.firewall_service.pass' } })
    expect(preflightMessage({ id: 'firewall_service', status: 'fail', detail: { nodes: ['pve1', 'pve2'] } }).detail)
      .toEqual({ key: 'checks.firewall_service.stopped', values: { nodes: 'pve1, pve2' } })
    expect(preflightMessage({ id: 'firewall_service', status: 'warn', detail: { unreadable: ['pve3'] } }).detail)
      .toEqual({ key: 'checks.firewall_service.unreadable', values: { nodes: 'pve3' } })
  })
})

describe('firewallOffClusters', () => {
  it('reads the connections the refusal lists', () => {
    expect(firewallOffClusters(['a', 'b'], 'cluster firewall disabled on connection x: enable it before applying')).toEqual(['a', 'b'])
  })

  it('falls back to the IDs of the text', () => {
    expect(firewallOffClusters(undefined, 'cluster firewall disabled on connection a,b: enable it before applying')).toEqual(['a', 'b'])
    expect(firewallOffClusters([], 'cluster firewall disabled on connection a: enable it before applying')).toEqual(['a'])
    expect(firewallOffClusters(undefined, 'something else')).toEqual([])
    expect(firewallOffClusters(undefined, undefined)).toEqual([])
  })
})

describe('a failed run of a cluster whose firewall was switched off', () => {
  it('is recognised by its error text', () => {
    expect(isFirewallOffRunError('cluster firewall disabled on connection c2: enable it')).toBe(true)
    expect(isFirewallOffRunError('request failed: dial tcp 10.0.0.2:8006')).toBe(false)
    expect(isFirewallOffRunError(undefined)).toBe(false)
  })

  it('gets its own line text instead of the raw error', () => {
    const run = { id: 'a2', status: 'failed', error: 'cluster firewall disabled on connection c2' } as never
    expect(clusterRunLine({ run, run_id: 'a2' }).key).toBe('cluster.firewallOffRun')
  })
})

describe('the cluster firewall of the banner', () => {
  it('is off by hand when the engine says disabled and no stop explains it', () => {
    expect(firewallOffByHand(stateOf(false, 'disabled'), false)).toBe(true)
    expect(firewallOffByHand(stateOf(true, 'disabled'), false)).toBe(false)
    expect(firewallOffByHand(stateOf(false, 'disabled'), true)).toBe(false)
    expect(firewallOffByHand(stateOf(false, 'enabled'), false)).toBe(false)
    expect(firewallOffByHand(stateOf(false, 'unknown'), false)).toBe(false)
    expect(firewallOffByHand(undefined, false)).toBe(false)
  })

  it('keeps the emergency stop wording only when the stop explains it', () => {
    const link = (stop_cluster_disabled: boolean) => ({ policy: { stop_cluster_disabled } as never })
    expect(clusterFirewallOff(stateOf(true, 'disabled'), link(false))).toBe(true)
    expect(clusterFirewallOff(stateOf(false, 'disabled'), link(true))).toBe(true)
    expect(clusterFirewallOff(stateOf(false, 'disabled'), link(false))).toBe(false)
    expect(clusterFirewallOff(stateOf(true, 'unknown'), link(true))).toBe(true)
    expect(clusterFirewallOff(stateOf(false, 'enabled'), link(true))).toBe(false)
  })
})
