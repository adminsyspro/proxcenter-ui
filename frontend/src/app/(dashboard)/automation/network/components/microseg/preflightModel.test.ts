import { describe, expect, it } from 'vitest'

import { heldByStop, isTrafficRefusal, opensWizard, parseRate, preflightMessage, socleRefusalLines } from './preflightModel'

describe('parseRate', () => {
  it('splits the rate PVE writes into a count and a unit', () => {
    expect(parseRate('20/second')).toEqual({ count: 20, unit: 'second' })
    expect(parseRate(' 3 / day ')).toEqual({ count: 3, unit: 'day' })
    expect(parseRate('1/hour')).toEqual({ count: 1, unit: 'hour' })
  })

  it('gives up on anything else', () => {
    expect(parseRate(undefined)).toBeNull()
    expect(parseRate('')).toBeNull()
    expect(parseRate('20/fortnight')).toBeNull()
    expect(parseRate('fast')).toBeNull()
  })
})

describe('a cluster firewall the emergency stop holds off', () => {
  const held = { id: 'cluster_firewall', status: 'warn' as const, fix: 'enable_cluster_firewall', detail: { reason: 'emergency_stop', held_by_stop: true } }
  const off = { id: 'cluster_firewall', status: 'fail' as const, fix: 'enable_cluster_firewall' }

  it('is told apart from a firewall that is simply off, by held_by_stop alone', () => {
    expect(heldByStop(held)).toBe(true)
    expect(heldByStop({ ...held, detail: { reason: 'emergency_stop' } })).toBe(false)
    expect(heldByStop({ ...held, detail: { held_by_stop: true } })).toBe(true)
    expect(heldByStop(off)).toBe(false)
    expect(heldByStop({ ...held, status: 'pass' })).toBe(false)
    expect(heldByStop({ ...held, id: 'socle_rules' })).toBe(false)
  })

  it('says it is held by the stop and does not offer the wizard', () => {
    expect(preflightMessage(held).detail).toEqual({ key: 'checks.cluster_firewall.heldByStop' })
    expect(opensWizard(held)).toBe(false)
  })

  it('keeps the wizard for a firewall that is off', () => {
    expect(preflightMessage(off).detail).toEqual({ key: 'checks.cluster_firewall.off' })
    expect(opensWizard(off)).toBe(true)
  })
})

describe('the ProxCenter address check that could not look at every member', () => {
  const unchecked = (reason: string, n = 3) => ({ id: 'self_in_zone', status: 'warn' as const, detail: { unchecked: n, reason } })

  it('says how many members were not checked, and why', () => {
    expect(preflightMessage(unchecked('collect_timeout')).detail).toEqual({ key: 'checks.self_in_zone.uncheckedTimeout', values: { count: 3 } })
    expect(preflightMessage(unchecked('collect_cap', 1)).detail).toEqual({ key: 'checks.self_in_zone.uncheckedCap', values: { count: 1 } })
  })

  it('asks for the host address when the detected one is internal to Docker', () => {
    const docker = { id: 'self_in_zone', status: 'warn' as const, detail: { self_ip: '172.17.0.3', reason: 'docker_internal' } }
    expect(preflightMessage(docker).detail).toEqual({ key: 'checks.self_in_zone.dockerInternal', values: { self_ip: '172.17.0.3' } })
  })

  it('names the addresses the socle rules leave out, and the Docker reason', () => {
    const uncovered = { id: 'socle_rules', status: 'fail' as const, fix: 'socle', detail: { web: true, ssh: false, uncovered: ['192.168.5.1', 3] } }
    expect(preflightMessage(uncovered).detail).toEqual({ key: 'checks.socle_rules.missingFor', values: { ports: '22', ips: '192.168.5.1' } })
    const docker = { id: 'socle_rules', status: 'fail' as const, fix: 'socle', detail: { web: false, ssh: false, reason: 'docker_internal', self_ip: '172.17.0.3' } }
    expect(preflightMessage(docker).detail).toEqual({ key: 'checks.socle_rules.dockerInternal', values: { ports: '8006, 22' } })
    const plain = { id: 'socle_rules', status: 'fail' as const, fix: 'socle', detail: { web: false, ssh: true } }
    expect(preflightMessage(plain).detail).toEqual({ key: 'checks.socle_rules.missing', values: { ports: '8006' } })
  })

  it('keeps the zone wording when the address was found in a zone', () => {
    const hit = { id: 'self_in_zone', status: 'warn' as const, detail: { zone: 'web', self_ip: '10.0.0.5' } }
    expect(preflightMessage(hit).detail).toEqual({ key: 'checks.self_in_zone.inZone', values: { zone: 'web', self_ip: '10.0.0.5' } })
  })
})

describe('outbound checks', () => {
  it('names the egress_subnets check and its guests', () => {
    const check = { id: 'egress_subnets', status: 'warn' as const, detail: { guests: [{ node: 'pve1', type: 'qemu', vmid: 101 }, { node: 'pve2', type: 'lxc', vmid: 202 }] } }
    expect(preflightMessage(check)).toEqual({ title: 'egress_subnets', detail: { key: 'checks.egress_subnets.warn', values: { count: 2, guests: 'qemu/101, lxc/202' } } })
    expect(preflightMessage({ id: 'egress_subnets', status: 'pass' }).detail).toEqual({ key: 'checks.egress_subnets.pass' })
  })

  it('says the outbound variant of self_in_zone', () => {
    const check = { id: 'self_in_zone', status: 'warn' as const, detail: { zone: 'web', self_ip: '10.0.0.5', egress: true } }
    expect(preflightMessage(check).detail).toEqual({ key: 'checks.self_in_zone.inZoneEgress', values: { zone: 'web', self_ip: '10.0.0.5' } })
  })
})

describe('a SOCLE_MISSING refusal', () => {
  it('says the Docker reason and the addresses left out', () => {
    expect(socleRefusalLines({ reason: 'docker_internal', uncovered: ['10.0.0.1', 7, '10.0.0.2'] })).toEqual([
      { key: 'preflight.checks.self_in_zone.dockerInternal' },
      { key: 'stop.socleUncovered', values: { ips: '10.0.0.1, 10.0.0.2' } },
    ])
  })

  it('names the security group that could not be read', () => {
    expect(socleRefusalLines({ reason: 'group_unreadable', group: 'sg-gone' })).toEqual([
      { key: 'preflight.checks.socle_rules.groupUnreadable', values: { group: 'sg-gone' } },
    ])
    const check = { id: 'socle_rules', status: 'fail' as const, fix: 'socle', detail: { web: false, ssh: false, reason: 'group_unreadable', group: 'sg-gone' } }
    expect(preflightMessage(check).detail).toEqual({ key: 'checks.socle_rules.groupUnreadable', values: { group: 'sg-gone' } })
  })

  it('says every reason of the list, with the nodes left uncovered', () => {
    const detail = {
      web: false, ssh: true, reason: 'docker_internal',
      reasons: [{ reason: 'docker_internal', self_ip: '172.17.0.3' }, { reason: 'host_rules_unreadable', node: 'pve2' }, { reason: 'group_unreadable', group: 'sg-gone' }],
      uncovered: ['10.0.0.1'], uncovered_nodes: ['pve1', 'pve2'],
    }
    expect(socleRefusalLines(detail)).toEqual([
      { key: 'preflight.checks.self_in_zone.dockerInternal' },
      { key: 'preflight.checks.socle_rules.hostRulesUnreadable', values: { node: 'pve2' } },
      { key: 'preflight.checks.socle_rules.groupUnreadable', values: { group: 'sg-gone' } },
      { key: 'stop.socleUncoveredNodes', values: { ips: '10.0.0.1', nodes: 'pve1, pve2' } },
    ])
    const message = preflightMessage({ id: 'socle_rules', status: 'fail', fix: 'socle', detail })
    expect(message.detail).toEqual({ key: 'checks.socle_rules.dockerInternal', values: { ports: '8006' } })
    expect(message.more).toEqual([
      { key: 'checks.socle_rules.hostRulesUnreadable', values: { node: 'pve2' } },
      { key: 'checks.socle_rules.groupUnreadable', values: { group: 'sg-gone' } },
    ])
  })

  it('names the nodes the rules leave ProxCenter out on, without the unreadable ones twice', () => {
    const check = (detail: Record<string, unknown>) => preflightMessage({ id: 'socle_rules', status: 'fail', fix: 'socle', detail })
    expect(check({ web: false, ssh: true, uncovered: ['10.0.0.1'], uncovered_nodes: ['pve1'] }).detail)
      .toEqual({ key: 'checks.socle_rules.missingForNodes', values: { ports: '8006', ips: '10.0.0.1', nodes: 'pve1' } })
    const m = check({ web: false, ssh: false, uncovered: ['10.0.0.1'], uncovered_nodes: ['pve1', 'pve2'], reasons: [{ reason: 'host_rules_unreadable', node: 'pve2' }], reason: 'host_rules_unreadable' })
    expect(m.detail).toEqual({ key: 'checks.socle_rules.hostRulesUnreadable', values: { node: 'pve2' } })
    expect(m.more).toEqual([{ key: 'checks.socle_rules.missingForNodes', values: { ports: '8006, 22', ips: '10.0.0.1', nodes: 'pve1' } }])
    expect(check({ web: false, ssh: false, uncovered_nodes: ['pve3'] }).detail)
      .toEqual({ key: 'checks.socle_rules.missingOn', values: { ports: '8006, 22', nodes: 'pve3' } })
  })

  it('says nothing more without a detail', () => {
    expect(socleRefusalLines(undefined)).toEqual([])
    expect(socleRefusalLines({ web: false, ssh: true })).toEqual([])
  })
})

describe('the traffic between the nodes', () => {
  const blocked = [
    { kind: 'ceph_public', network: '10.250.250.0/24', ports: '3300, 6789, 6800-7300', nodes: ['pve1', 'pve2'] },
    { kind: 'ceph_cluster', network: '10.251.251.0/24', ports: '6800-7300', nodes: ['pve1'] },
  ]
  const unsure = [{ kind: 'migration', network: '10.51.51.0/24', ports: '22', nodes: ['pve3'] }]

  it('says why it passes', () => {
    expect(preflightMessage({ id: 'node_traffic', status: 'pass' })).toEqual({ title: 'node_traffic', detail: { key: 'checks.node_traffic.pass' } })
    expect(preflightMessage({ id: 'node_traffic', status: 'pass', detail: { node_firewalls: 'off' } }).detail).toEqual({ key: 'checks.node_traffic.nodesOff' })
    expect(preflightMessage({ id: 'node_traffic', status: 'pass', detail: { policy_in: 'ACCEPT' } }).detail).toEqual({ key: 'checks.node_traffic.policyAccept' })
  })

  it('names each network cut with its ports and nodes, then what to do, then what it could not check', () => {
    const m = preflightMessage({ id: 'node_traffic', status: 'fail', fix: 'node_traffic', detail: { blocked, unsure } })
    expect(m.detail).toEqual({ key: 'checks.node_traffic.cut.ceph_public', values: { network: '10.250.250.0/24', ports: '3300, 6789, 6800-7300', nodes: 'pve1, pve2' } })
    expect(m.more).toEqual([
      { key: 'checks.node_traffic.cut.ceph_cluster', values: { network: '10.251.251.0/24', ports: '6800-7300', nodes: 'pve1' } },
      { key: 'checks.node_traffic.fix' },
      { key: 'checks.node_traffic.doubt.migration', values: { network: '10.51.51.0/24', ports: '22', nodes: 'pve3' } },
      { key: 'checks.node_traffic.doubtWhy' },
    ])
  })

  it('only doubts on a warning, and keeps a kind it does not know', () => {
    const m = preflightMessage({ id: 'node_traffic', status: 'warn', detail: { unsure: [{ kind: 'storage', network: '10.9.0.0/24', ports: '2049', nodes: ['pve1'] }] } })
    expect(m.detail).toEqual({ key: 'checks.node_traffic.doubt.other', values: { network: '10.9.0.0/24', ports: '2049', nodes: 'pve1' } })
    expect(m.more).toEqual([{ key: 'checks.node_traffic.doubtWhy' }])
  })

  it('says a read failure as the other checks do', () => {
    expect(preflightMessage({ id: 'node_traffic', status: 'fail', detail: { error: 'boom' } }).detail).toEqual({ key: 'readFailed', values: { error: 'boom' } })
  })

  it('is what a refusal to turn the cluster firewall on names, instead of the socle lines', () => {
    expect(isTrafficRefusal({ blocked })).toBe(true)
    expect(isTrafficRefusal({ uncovered: ['10.0.0.1'] })).toBe(false)
    expect(isTrafficRefusal(undefined)).toBe(false)
    expect(socleRefusalLines({ blocked, unsure })).toEqual([
      { key: 'preflight.checks.node_traffic.fixShort' },
      { key: 'preflight.checks.node_traffic.short.ceph_public', values: { network: '10.250.250.0/24', nodes: 'pve1, pve2' } },
      { key: 'preflight.checks.node_traffic.short.ceph_cluster', values: { network: '10.251.251.0/24', nodes: 'pve1' } },
    ])
  })
})
