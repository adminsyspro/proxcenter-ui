/**
 * Coverage for the pure east-west firewall flow resolver.
 *
 * Reference expansion is the critical boundary here: PVE rules can name raw
 * addresses, aliases, IP sets, or security groups, while the graph needs
 * concrete guest endpoints and must retain unknown external references.
 * Flow direction, de-duplication, filtering, and default policies are asserted
 * without involving the React view.
 */

import { describe, expect, it } from 'vitest'

import type { Alias, FirewallRule, IPSet, SecurityGroup } from '@/lib/api/firewall'

import {
  buildEastWestFlows,
  buildResolveContext,
  expandGuestRules,
  flowsFromGuest,
  flowsToGuest,
  ipInCidr,
  isOpenByDefault,
  resolveRefEndpoints,
  type EastWestFlow,
  type EastWestGuest,
} from './eastWest'

const guest = (vmid: number, ip: string, overrides: Partial<EastWestGuest> = {}): EastWestGuest => ({
  vmid,
  name: `vm-${vmid}`,
  node: 'pve1',
  type: 'qemu',
  status: 'running',
  ips: ip ? [ip] : [],
  firewallEnabled: true,
  rules: [],
  ...overrides,
})

const rule = (overrides: Partial<FirewallRule> = {}): FirewallRule => ({
  pos: 0,
  type: 'out',
  action: 'ACCEPT',
  enable: 1,
  ...overrides,
})

describe('ipInCidr', () => {
  it('handles IPv4 containment, bare /32 addresses, and /0', () => {
    expect(ipInCidr('10.20.30.4', '10.20.0.0/16')).toBe(true)
    expect(ipInCidr('10.21.30.4', '10.20.0.0/16')).toBe(false)
    expect(ipInCidr('10.20.30.4', '10.20.30.4')).toBe(true)
    expect(ipInCidr('10.20.30.5', '10.20.30.4')).toBe(false)
    expect(ipInCidr('203.0.113.9', '0.0.0.0/0')).toBe(true)
  })

  it('rejects invalid prefixes and malformed addresses', () => {
    expect(ipInCidr('10.0.0.1', '10.0.0.0/33')).toBe(false)
    expect(ipInCidr('10.0.0.1', '10.0.0.0/-1')).toBe(false)
    expect(ipInCidr('999.0.0.1', '10.0.0.0/8')).toBe(false)
    expect(ipInCidr('not-an-ip', 'also-not-an-ip')).toBe(false)
  })

  it('uses exact string equality for IPv6', () => {
    expect(ipInCidr('2001:db8::1', '2001:db8::1')).toBe(true)
    expect(ipInCidr('2001:db8::1', '2001:db8::2')).toBe(false)
  })
})

describe('isOpenByDefault', () => {
  it('opens both sides when the firewall is disabled', () => {
    const vm = guest(100, '10.0.0.1', { firewallEnabled: false, policyIn: 'DROP', policyOut: 'DROP' })

    expect(isOpenByDefault(vm, 'in')).toBe(true)
    expect(isOpenByDefault(vm, 'out')).toBe(true)
  })

  it('uses PVE defaults and explicit policies', () => {
    const defaults = guest(100, '10.0.0.1')
    expect(isOpenByDefault(defaults, 'in')).toBe(false)
    expect(isOpenByDefault(defaults, 'out')).toBe(true)

    expect(isOpenByDefault(guest(101, '10.0.0.2', { policyIn: 'ACCEPT' }), 'in')).toBe(true)
    expect(isOpenByDefault(guest(102, '10.0.0.3', { policyOut: 'DROP' }), 'out')).toBe(false)
  })
})

describe('resolveRefEndpoints', () => {
  const guests = [guest(100, '10.0.0.10'), guest(101, '10.0.0.20'), guest(102, '10.0.1.10')]
  const aliases: Alias[] = [{ name: 'app-net', cidr: '10.0.0.0/24' }, { name: 'db-one', cidr: '10.0.1.10' }]
  const ipsets: IPSet[] = [{
    name: 'trusted',
    members: [
      { cidr: '10.0.0.10' },
      { cidr: 'db-one' },
      { cidr: '10.0.0.20', nomatch: true },
    ],
  }]
  const ctx = buildResolveContext(guests, aliases, ipsets)

  it('treats empty and undefined references as any', () => {
    expect(resolveRefEndpoints(undefined, ctx)).toEqual([{ kind: 'any' }])
    expect(resolveRefEndpoints('   ', ctx)).toEqual([{ kind: 'any' }])
  })

  it('resolves exact IPs and CIDRs to their owning guests', () => {
    expect(resolveRefEndpoints('10.0.0.20', ctx)).toEqual([{ kind: 'vm', vmid: 101 }])
    expect(resolveRefEndpoints('10.0.0.0/24', ctx)).toEqual([
      { kind: 'vm', vmid: 100 },
      { kind: 'vm', vmid: 101 },
    ])
  })

  it('resolves aliases with plain and dc-scoped names', () => {
    expect(resolveRefEndpoints('app-net', ctx)).toEqual([
      { kind: 'vm', vmid: 100 },
      { kind: 'vm', vmid: 101 },
    ])
    expect(resolveRefEndpoints('dc/app-net', ctx)).toEqual([
      { kind: 'vm', vmid: 100 },
      { kind: 'vm', vmid: 101 },
    ])
  })

  it('expands IP sets, skips nomatch members, and resolves alias members', () => {
    expect(resolveRefEndpoints('+trusted', ctx)).toEqual([
      { kind: 'vm', vmid: 100 },
      { kind: 'vm', vmid: 102 },
    ])
  })

  it('merges comma-list matches and folds misses into one reference endpoint', () => {
    expect(resolveRefEndpoints('10.0.0.10, db-one, outside-a, outside-b', ctx)).toEqual([
      { kind: 'vm', vmid: 100 },
      { kind: 'vm', vmid: 102 },
      { kind: 'ref', ref: 'outside-a, outside-b' },
    ])
  })
})

describe('expandGuestRules', () => {
  const direct = rule({ pos: 1 })
  const sgRule = rule({ pos: 2, type: 'in' })
  const groups: SecurityGroup[] = [{ group: 'web-to-db', rules: [sgRule] }]

  it('passes direct rules through and expands enabled group rows with their origin', () => {
    const vm = guest(100, '10.0.0.10', {
      rules: [direct, rule({ type: 'group', action: 'web-to-db' })],
    })

    expect(expandGuestRules(vm, groups)).toEqual([
      { rule: direct },
      { rule: sgRule, via: 'web-to-db' },
    ])
  })

  it('skips disabled group rows and unknown groups', () => {
    const vm = guest(100, '10.0.0.10', {
      rules: [
        rule({ type: 'group', action: 'web-to-db', enable: 0 }),
        rule({ type: 'group', action: 'missing' }),
      ],
    })

    expect(expandGuestRules(vm, groups)).toEqual([])
  })
})

describe('buildEastWestFlows', () => {
  it('builds an outgoing flow with its service and origin', () => {
    const guests = [
      guest(100, '10.0.0.10', { rules: [rule({ pos: 4, dest: '10.0.0.20', proto: 'tcp', dport: '443', macro: 'HTTPS' })] }),
      guest(101, '10.0.0.20'),
    ]

    expect(buildEastWestFlows(guests, [], [], [])).toEqual([{
      source: { kind: 'vm', vmid: 100 },
      dest: { kind: 'vm', vmid: 101 },
      proto: 'tcp',
      dport: '443',
      macro: 'HTTPS',
      origins: [{ vmid: 100, side: 'out', pos: 4 }],
    }])
  })

  it('builds the same shape from an incoming rule on the destination', () => {
    const guests = [
      guest(100, '10.0.0.10'),
      guest(101, '10.0.0.20', { rules: [rule({ pos: 7, type: 'in', source: '10.0.0.10', proto: 'udp', dport: '53' })] }),
    ]

    expect(buildEastWestFlows(guests, [], [], [])).toEqual([{
      source: { kind: 'vm', vmid: 100 },
      dest: { kind: 'vm', vmid: 101 },
      proto: 'udp',
      dport: '53',
      origins: [{ vmid: 101, side: 'in', pos: 7 }],
    }])
  })

  it('merges identical flows created on both sides', () => {
    const guests = [
      guest(100, '10.0.0.10', { rules: [rule({ pos: 2, dest: '10.0.0.20', proto: 'tcp', dport: '5432' })] }),
      guest(101, '10.0.0.20', { rules: [rule({ pos: 3, type: 'in', source: '10.0.0.10', proto: 'tcp', dport: '5432' })] }),
    ]
    const flows = buildEastWestFlows(guests, [], [], [])

    expect(flows).toHaveLength(1)
    expect(flows[0].origins).toEqual([
      { vmid: 100, side: 'out', pos: 2 },
      { vmid: 101, side: 'in', pos: 3 },
    ])
  })

  it('skips self-loops and inactive, denying, or unrelated rules', () => {
    const vm = guest(100, '10.0.0.10', { rules: [
      rule({ dest: '10.0.0.10' }),
      rule({ dest: '203.0.113.1', enable: 0 }),
      rule({ dest: '203.0.113.2', action: 'DROP' }),
      rule({ dest: '203.0.113.3', action: 'REJECT' }),
      rule({ dest: '203.0.113.4', type: 'group' }),
    ] })

    expect(buildEastWestFlows([vm], [], [], [])).toEqual([])
  })

  it('keeps any and unmatched destination endpoint kinds', () => {
    const vm = guest(100, '10.0.0.10', { rules: [
      rule({ pos: 0 }),
      rule({ pos: 1, dest: 'external-net' }),
    ] })

    expect(buildEastWestFlows([vm], [], [], [])).toEqual([
      {
        source: { kind: 'vm', vmid: 100 },
        dest: { kind: 'any' },
        origins: [{ vmid: 100, side: 'out', pos: 0 }],
      },
      {
        source: { kind: 'vm', vmid: 100 },
        dest: { kind: 'ref', ref: 'external-net' },
        origins: [{ vmid: 100, side: 'out', pos: 1 }],
      },
    ])
  })
})

describe('flow filters', () => {
  const flows: EastWestFlow[] = [
    { source: { kind: 'vm', vmid: 100 }, dest: { kind: 'vm', vmid: 101 }, origins: [] },
    { source: { kind: 'vm', vmid: 102 }, dest: { kind: 'vm', vmid: 100 }, origins: [] },
    { source: { kind: 'any' }, dest: { kind: 'vm', vmid: 100 }, origins: [] },
  ]

  it('filters flows by concrete source and destination guests', () => {
    expect(flowsFromGuest(flows, 100)).toEqual([flows[0]])
    expect(flowsToGuest(flows, 100)).toEqual([flows[1], flows[2]])
  })
})
