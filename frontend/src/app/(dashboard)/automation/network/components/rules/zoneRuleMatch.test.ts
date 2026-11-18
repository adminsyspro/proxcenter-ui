/**
 * A zone group rule maps back to the flow it is compiled from (proxcenter-backend internal/microseg/compile.go):
 * destination zone = the group's zone, source = the flow's zone (+pcz-<zone>) or CIDR, protocol ("" = any), port as
 * written. The rules on Proxmox come from the last applied revision: matched there first, then resolved in the draft
 * by flow id (changed, or removed), the draft alone when there is no revision.
 */
import { describe, expect, it } from 'vitest'

import { toFields } from '@/lib/firewall/draft'
import type { MicrosegException, MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'

import { draftZoneOf, matchZoneRule, occurrences, type PolicyView } from './zoneRuleMatch'

const zone = (id: string, name: string, isolate = false) => ({ id, name, isolate_members: isolate } as MicrosegZone)
const flow = (id: string, f: Partial<MicrosegFlow>) => ({ id, src_zone_id: '', src_cidr: '', dst_zone_id: 'z-db', dst_cidr: '', proto: 'any', dport: '', ...f } as MicrosegFlow)
const ZONES = [zone('z-db', 'db'), zone('z-app', 'app'), zone('z-web', 'web', true)]
const FLOWS = [
  flow('f-app', { src_zone_id: 'z-app', proto: 'tcp', dport: '5432' }),
  flow('f-cidr', { src_cidr: '10.0.0.0/24', proto: 'any', dport: '' }),
  flow('f-range', { src_zone_id: 'z-app', proto: 'tcp', dport: '8000:8010' }),
  flow('f-list', { src_zone_id: 'z-app', proto: 'tcp', dport: '80,443' }),
  flow('f-icmp', { src_zone_id: 'z-app', proto: 'icmp', dport: '' }),
  flow('f-db-db', { src_zone_id: 'z-db', proto: 'udp', dport: '53' }),
]
const APPLIED: PolicyView = { zones: ZONES, flows: FLOWS }
const rule = (source: string, proto = '', dport = '') => toFields({ type: 'in', action: 'ACCEPT', source, proto, dport, comment: '[pc-microseg] x' })

describe('matchZoneRule against the applied revision, resolved in the draft', () => {
  it('finds the flow by source zone, protocol and port, as written (range, list, ICMP, any)', () => {
    const same = (r: ReturnType<typeof rule>) => matchZoneRule(r, 'db', APPLIED, APPLIED)
    expect(same(rule('+pcz-app', 'tcp', '5432'))).toMatchObject({ kind: 'flow', flow: { id: 'f-app' }, changed: false })
    expect(same(rule('+pcz-app', 'TCP', '8000:8010'))).toMatchObject({ kind: 'flow', flow: { id: 'f-range' } })
    expect(same(rule('+pcz-app', 'tcp', '80,443'))).toMatchObject({ kind: 'flow', flow: { id: 'f-list' } })
    expect(same(rule('+pcz-app', 'icmp'))).toMatchObject({ kind: 'flow', flow: { id: 'f-icmp' } })
    expect(same(rule('10.0.0.0/24'))).toMatchObject({ kind: 'flow', flow: { id: 'f-cidr' } })
  })

  it('a flow edited since the revision: the deployed rule edits the DRAFT flow, marked changed', () => {
    const draft = { zones: ZONES, flows: FLOWS.map(f => (f.id === 'f-app' ? { ...f, dport: '5433' } : f)) }
    expect(matchZoneRule(rule('+pcz-app', 'tcp', '5432'), 'db', draft, APPLIED)).toMatchObject({ kind: 'flow', flow: { id: 'f-app', dport: '5433' }, changed: true })
  })

  it('a flow deleted from the draft: its rule is a removal pending', () => {
    const draft = { zones: ZONES, flows: FLOWS.filter(f => f.id !== 'f-app') }
    expect(matchZoneRule(rule('+pcz-app', 'tcp', '5432'), 'db', draft, APPLIED)).toEqual({ kind: 'removed', flow: FLOWS[0] })
  })

  it('isolate members turned on in the draft: the applied members rule is still the zone setting', () => {
    const draft = { zones: ZONES.map(z => (z.id === 'z-db' ? { ...z, isolate_members: true } : z)), flows: FLOWS }
    expect(matchZoneRule(rule('+pcz-db'), 'db', draft, APPLIED)).toMatchObject({ kind: 'intra', zone: { id: 'z-db', isolate_members: true } })
  })

  it('a zone renamed in the draft: its section (named after the applied group) keeps its zone by id', () => {
    const draft = { zones: ZONES.map(z => (z.id === 'z-db' ? { ...z, name: 'databases' } : z)), flows: FLOWS }
    expect(draftZoneOf('db', draft, APPLIED)).toMatchObject({ id: 'z-db', name: 'databases' })
    expect(matchZoneRule(rule('+pcz-app', 'tcp', '5432'), 'db', draft, APPLIED)).toMatchObject({ kind: 'flow', zone: { name: 'databases' } })
  })

  it('identical flows map one to one, in order', () => {
    const twins = { zones: ZONES, flows: [flow('a', { src_zone_id: 'z-app', proto: 'tcp', dport: '22' }), flow('b', { src_zone_id: 'z-app', proto: 'tcp', dport: '22' })] }
    const rules = [rule('+pcz-app', 'tcp', '22'), rule('+pcz-app', 'tcp', '22')]
    const ranks = occurrences(rules)
    expect(ranks).toEqual([0, 1])
    expect(matchZoneRule(rules[1], 'db', twins, twins, ranks[1])).toMatchObject({ flow: { id: 'b' } })
  })

  it('without a revision the draft is matched directly; a self flow wins over the members rule', () => {
    expect(matchZoneRule(rule('+pcz-app', 'tcp', '5432'), 'db', APPLIED, null)).toMatchObject({ kind: 'flow', flow: { id: 'f-app' }, changed: false })
    expect(matchZoneRule(rule('+pcz-db', 'udp', '53'), 'db', APPLIED, null)).toMatchObject({ kind: 'flow', flow: { id: 'f-db-db' } })
    expect(matchZoneRule(rule('+pcz-db'), 'db', APPLIED, null)).toMatchObject({ kind: 'intra' })
    expect(matchZoneRule(rule('+pcz-web'), 'web', APPLIED, null)).toBeNull()
  })

  it('is null for a drift: another port, an unknown source, another destination, not an ACCEPT, an unknown zone', () => {
    expect(matchZoneRule(rule('+pcz-app', 'tcp', '5433'), 'db', APPLIED, APPLIED)).toBeNull()
    expect(matchZoneRule(rule('+pcz-gone', 'tcp', '5432'), 'db', APPLIED, APPLIED)).toBeNull()
    expect(matchZoneRule(rule('+pcz-app', 'tcp', '5432'), 'app', APPLIED, APPLIED)).toBeNull()
    expect(matchZoneRule({ ...rule('+pcz-app', 'tcp', '5432'), action: 'DROP' }, 'db', APPLIED, APPLIED)).toBeNull()
    expect(matchZoneRule(rule('+pcz-app', 'tcp', '5432'), 'nowhere', APPLIED, APPLIED)).toBeNull()
  })
})

describe('matchZoneRule: the rules of an exception (+pcz-_vm<source> to +pcz-_vm<destination>)', () => {
  const guest = (vmid: number, name: string) => ({ type: 'qemu' as const, vmid, name })
  const exception = (over: Partial<MicrosegException> = {}): MicrosegException => ({
    id: 'e1', policy_id: 'p1', connection_id: 'c1', zone_id: 'z-db', sources: [guest(101, 'app-01'), guest(103, '')], destinations: [guest(102, 'db-01')],
    services: [{ proto: 'tcp', dport: '5432' }, { proto: 'any', dport: '' }], comment: '', created_by: 'x', ...over,
  })
  const WITH: PolicyView = { ...APPLIED, exceptions: [exception()] }
  const vmRule = (src: number, dst: number, proto = 'tcp', dport = '5432', type = 'in') =>
    toFields({ type, action: 'ACCEPT', source: `+pcz-_vm${src}`, dest: `+pcz-_vm${dst}`, proto, dport, comment: `[pc-microseg] vm${src} -> vm${dst}` })

  it('finds the exception by its zone, the two guests and the service, with the guests as the exception names them', () => {
    expect(matchZoneRule(vmRule(101, 102), 'db', WITH, WITH)).toMatchObject({
      kind: 'exception', exception: { id: 'e1' }, source: { vmid: 101, name: 'app-01' }, destination: { vmid: 102, name: 'db-01' }, removed: false,
    })
    // A service on every protocol is a rule without protocol nor port.
    expect(matchZoneRule(vmRule(103, 102, '', ''), 'db', WITH, WITH)).toMatchObject({ kind: 'exception', source: { vmid: 103 } })
  })

  it('the outbound twin in the group of the source zone is the same exception', () => {
    expect(matchZoneRule(vmRule(101, 102, 'tcp', '5432', 'out'), 'app', WITH, WITH)).toMatchObject({ kind: 'exception', exception: { id: 'e1' }, removed: false })
  })

  it('an exception deleted from the draft, or that no longer opens the rule: a removal pending', () => {
    expect(matchZoneRule(vmRule(101, 102), 'db', APPLIED, WITH)).toMatchObject({ kind: 'exception', exception: { id: 'e1' }, removed: true })
    const narrowed: PolicyView = { ...APPLIED, exceptions: [exception({ services: [{ proto: 'tcp', dport: '5433' }] })] }
    expect(matchZoneRule(vmRule(101, 102), 'db', narrowed, WITH)).toMatchObject({ kind: 'exception', removed: true })
  })

  it('without a revision, or one taken before the exceptions existed, the draft is matched directly', () => {
    expect(matchZoneRule(vmRule(101, 102), 'db', WITH, null)).toMatchObject({ kind: 'exception', removed: false })
    expect(matchZoneRule(vmRule(101, 102), 'db', WITH, APPLIED)).toMatchObject({ kind: 'exception', removed: false })
  })

  it('is null for a drift: another port, a guest the exception does not name, another zone, no marker, not an ACCEPT', () => {
    expect(matchZoneRule(vmRule(101, 102, 'tcp', '22'), 'db', WITH, WITH)).toBeNull()
    expect(matchZoneRule(vmRule(104, 102), 'db', WITH, WITH)).toBeNull()
    expect(matchZoneRule(vmRule(101, 102), 'web', WITH, WITH)).toBeNull()
    expect(matchZoneRule({ ...vmRule(101, 102), comment: 'by hand' }, 'db', WITH, WITH)).toBeNull()
    expect(matchZoneRule({ ...vmRule(101, 102), action: 'DROP' }, 'db', WITH, WITH)).toBeNull()
    expect(matchZoneRule(vmRule(101, 102), 'db', APPLIED, APPLIED)).toBeNull()
  })
})

describe('matchZoneRule: the outbound rules of a zone that controls what its members send', () => {
  // Zone app sends to db (tcp/5432 and tcp/8000:8010), to a CIDR and to itself; web isolates its members.
  const OUT_FLOWS = [
    ...FLOWS,
    flow('f-out-cidr', { src_zone_id: 'z-app', dst_zone_id: '', dst_cidr: '192.0.2.0/24', proto: 'tcp', dport: '443' }),
    flow('f-out-web', { src_zone_id: 'z-app', dst_zone_id: 'z-web', proto: 'tcp', dport: '443' }),
  ]
  const VIEW: PolicyView = { zones: ZONES, flows: OUT_FLOWS }
  const out = (dest: string, proto = '', dport = '', comment = '[pc-microseg] app -> x') => toFields({ type: 'out', action: 'ACCEPT', dest, proto, dport, comment })

  it('finds the flow leaving the zone by its destination (zone or CIDR), protocol and port', () => {
    const same = (r: ReturnType<typeof out>) => matchZoneRule(r, 'app', VIEW, VIEW)
    expect(same(out('+pcz-db', 'tcp', '5432'))).toMatchObject({ kind: 'flow', flow: { id: 'f-app' }, zone: { id: 'z-app' }, changed: false })
    expect(same(out('+pcz-db', 'tcp', '8000:8010'))).toMatchObject({ kind: 'flow', flow: { id: 'f-range' } })
    expect(same(out('192.0.2.0/24', 'tcp', '443'))).toMatchObject({ kind: 'flow', flow: { id: 'f-out-cidr' } })
    expect(same(out('+pcz-web', 'tcp', '443'))).toMatchObject({ kind: 'flow', flow: { id: 'f-out-web' } })
  })

  it('resolves it in the draft as an inbound rule: changed, removed, or the draft alone without a revision', () => {
    const edited = { zones: ZONES, flows: OUT_FLOWS.map(f => (f.id === 'f-app' ? { ...f, dport: '5433' } : f)) }
    expect(matchZoneRule(out('+pcz-db', 'tcp', '5432'), 'app', edited, VIEW)).toMatchObject({ kind: 'flow', flow: { id: 'f-app', dport: '5433' }, changed: true })
    const dropped = { zones: ZONES, flows: OUT_FLOWS.filter(f => f.id !== 'f-app') }
    expect(matchZoneRule(out('+pcz-db', 'tcp', '5432'), 'app', dropped, VIEW)).toMatchObject({ kind: 'removed', flow: { id: 'f-app' } })
    expect(matchZoneRule(out('+pcz-db', 'tcp', '5432'), 'app', VIEW, null)).toMatchObject({ kind: 'flow', flow: { id: 'f-app' }, changed: false })
  })

  it('the outbound rule of the members among themselves is the zone setting, unless the zone isolates them', () => {
    expect(matchZoneRule(out('+pcz-app'), 'app', VIEW, VIEW)).toMatchObject({ kind: 'intra', zone: { id: 'z-app' } })
    expect(matchZoneRule(out('+pcz-web'), 'web', VIEW, VIEW)).toBeNull()
    // A flow of the zone to itself wins over the members rule.
    expect(matchZoneRule(out('+pcz-db', 'udp', '53'), 'db', VIEW, VIEW)).toMatchObject({ kind: 'flow', flow: { id: 'f-db-db' } })
  })

  it('inbound and outbound rules of the same service, and outbound ones to different destinations, each count on their own', () => {
    const rules = [
      rule('+pcz-app', 'tcp', '443'), out('+pcz-db', 'tcp', '443'), out('+pcz-web', 'tcp', '443'), out('+pcz-web', 'tcp', '443'),
    ]
    expect(occurrences(rules)).toEqual([0, 0, 0, 1])
  })

  it('is null for a drift: another port, an unknown destination, a rule with a source, the group of another zone', () => {
    expect(matchZoneRule(out('+pcz-db', 'tcp', '22'), 'app', VIEW, VIEW)).toBeNull()
    expect(matchZoneRule(out('+pcz-gone', 'tcp', '5432'), 'app', VIEW, VIEW)).toBeNull()
    expect(matchZoneRule({ ...out('+pcz-db', 'tcp', '5432'), source: '10.0.0.1' }, 'app', VIEW, VIEW)).toBeNull()
    expect(matchZoneRule(out('+pcz-db', 'tcp', '5432'), 'web', VIEW, VIEW)).toBeNull()
  })
})

describe('matchZoneRule: the group of the known zones (pcz-_known)', () => {
  const known = (zoneName: string) => toFields({ type: 'out', action: 'ACCEPT', dest: `+pcz-${zoneName}`, comment: `[pc-microseg] ${zoneName}` })

  it('each rule stands for a zone, of the applied revision first, by id in the draft', () => {
    expect(matchZoneRule(known('db'), '_known', APPLIED, APPLIED)).toMatchObject({ kind: 'known', zone: { id: 'z-db' } })
    const renamed = { zones: ZONES.map(z => (z.id === 'z-db' ? { ...z, name: 'databases' } : z)), flows: FLOWS }
    expect(matchZoneRule(known('db'), '_known', renamed, APPLIED)).toMatchObject({ kind: 'known', zone: { id: 'z-db', name: 'databases' } })
    expect(matchZoneRule(known('db'), '_known', APPLIED, null)).toMatchObject({ kind: 'known', zone: { id: 'z-db' } })
  })

  it('is null for a zone nobody knows, a rule with a service, or one not written by the engine', () => {
    expect(matchZoneRule(known('gone'), '_known', APPLIED, APPLIED)).toBeNull()
    expect(matchZoneRule({ ...known('db'), proto: 'tcp', dport: '22' }, '_known', APPLIED, APPLIED)).toBeNull()
    expect(matchZoneRule({ ...known('db'), comment: 'by hand' }, '_known', APPLIED, APPLIED)).toBeNull()
  })
})
