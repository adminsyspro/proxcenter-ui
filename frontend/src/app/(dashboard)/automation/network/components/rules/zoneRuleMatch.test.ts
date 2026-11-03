/**
 * A zone group rule maps back to the flow it is compiled from (proxcenter-backend internal/microseg/compile.go):
 * destination zone = the group's zone, source = the flow's zone (+pcz-<zone>) or CIDR, protocol ("" = any), port as
 * written. The rules on Proxmox come from the last applied revision: matched there first, then resolved in the draft
 * by flow id (changed, or removed), the draft alone when there is no revision.
 */
import { describe, expect, it } from 'vitest'

import { toFields } from '@/lib/firewall/draft'
import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'

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
