/**
 * A zone group rule maps back to the flow it is compiled from (proxcenter-backend internal/microseg/compile.go):
 * destination zone = the group's zone, source = the flow's zone (+pcz-<zone>) or CIDR, protocol ("" = any), port.
 */
import { describe, expect, it } from 'vitest'

import { toFields } from '@/lib/firewall/draft'
import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'

import { matchZoneRule } from './zoneRuleMatch'

const zone = (id: string, name: string, isolate = false) => ({ id, name, isolate_members: isolate } as MicrosegZone)
const flow = (id: string, f: Partial<MicrosegFlow>) => ({ id, src_zone_id: '', src_cidr: '', dst_zone_id: 'z-db', dst_cidr: '', proto: 'any', dport: '', ...f } as MicrosegFlow)
const ZONES = [zone('z-db', 'db'), zone('z-app', 'app'), zone('z-web', 'web', true)]
const FLOWS = [
  flow('f-app', { src_zone_id: 'z-app', proto: 'tcp', dport: '5432' }),
  flow('f-cidr', { src_cidr: '10.0.0.0/24', proto: 'any', dport: '' }),
  flow('f-ssh', { src_zone_id: 'z-app', proto: 'tcp', dport: '22' }),
  flow('f-db-db', { src_zone_id: 'z-db', proto: 'udp', dport: '53' }),
]
const rule = (source: string, proto = '', dport = '') => toFields({ type: 'in', action: 'ACCEPT', source, proto, dport, comment: '[pc-microseg] x' })

describe('matchZoneRule', () => {
  it('finds the flow by source zone, protocol and port', () => {
    expect(matchZoneRule(rule('+pcz-app', 'tcp', '5432'), 'db', ZONES, FLOWS)).toMatchObject({ kind: 'flow', flow: { id: 'f-app' } })
    expect(matchZoneRule(rule('+pcz-app', 'TCP', '22'), 'db', ZONES, FLOWS)).toMatchObject({ kind: 'flow', flow: { id: 'f-ssh' } })
  })

  it('a CIDR source and the "any" protocol (no proto in the rule)', () => {
    expect(matchZoneRule(rule('10.0.0.0/24'), 'db', ZONES, FLOWS)).toMatchObject({ kind: 'flow', flow: { id: 'f-cidr' } })
  })

  it('a flow from the zone to itself wins over the members rule; the members rule is the zone setting', () => {
    expect(matchZoneRule(rule('+pcz-db', 'udp', '53'), 'db', ZONES, FLOWS)).toMatchObject({ kind: 'flow', flow: { id: 'f-db-db' } })
    expect(matchZoneRule(rule('+pcz-db'), 'db', ZONES, FLOWS)).toEqual({ kind: 'intra', zone: ZONES[0] })
    // A zone isolating its members has no such rule: one would be a drift.
    expect(matchZoneRule(rule('+pcz-web'), 'web', ZONES, FLOWS)).toBeNull()
  })

  it('is null for a drift: another port, an unknown source, another destination, not an ACCEPT, an unknown zone', () => {
    expect(matchZoneRule(rule('+pcz-app', 'tcp', '5433'), 'db', ZONES, FLOWS)).toBeNull()
    expect(matchZoneRule(rule('+pcz-gone', 'tcp', '5432'), 'db', ZONES, FLOWS)).toBeNull()
    expect(matchZoneRule(rule('+pcz-app', 'tcp', '5432'), 'app', ZONES, FLOWS)).toBeNull()
    expect(matchZoneRule({ ...rule('+pcz-app', 'tcp', '5432'), action: 'DROP' }, 'db', ZONES, FLOWS)).toBeNull()
    expect(matchZoneRule(rule('+pcz-app', 'tcp', '5432'), 'nowhere', ZONES, FLOWS)).toBeNull()
  })
})
