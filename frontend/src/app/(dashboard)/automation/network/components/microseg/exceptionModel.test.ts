import { describe, expect, it } from 'vitest'

import type { MicrosegException, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import {
  EXCEPTION_SERVICES,
  MAX_EXCEPTION_RULES,
  draftBody,
  draftChanged,
  draftException,
  draftMatches,
  draftOverlap,
  draftRuleCount,
  draftServices,
  exceptionCovered,
  exceptionDraft,
  exceptionFromSuggestion,
  exceptionLabel,
  exceptionRuleCount,
  exceptionServiceFlows,
  exceptionServicePorts,
  exceptionStatus,
  exceptionsOfZone,
  isExceptionService,
  isExceptionServiceText,
  namedGuests,
  servicesToChoices,
  shownExceptionStatus,
} from './exceptionModel'
import type { PolicyGuest, ZoneMember } from './zoneModel'

const guest = (vmid: number, name: string, over: Partial<PolicyGuest> = {}): PolicyGuest => ({
  vmid, name, node: 'pve1', type: 'qemu', status: 'running', tags: [], ips: [`10.0.0.${vmid % 250}`], ...over,
})

const member = (g: PolicyGuest, pending = false): ZoneMember => ({
  ref: { node: g.node, type: g.type, vmid: g.vmid }, guest: g, pending,
})

const zone = (over: Partial<MicrosegZone> = {}): MicrosegZone => ({
  id: 'z-db', policy_id: 'p1', name: 'db', label: '', color: '', enforcement: 'guest', vnet_id: '',
  state: 'enforce', isolate_members: false, observe_since: null, ...over,
})

const exception = (over: Partial<MicrosegException> = {}): MicrosegException => ({
  id: 'e1', policy_id: 'p1', zone_id: 'z-db',
  sources: [{ type: 'qemu', vmid: 101, name: 'app-01' }, { type: 'qemu', vmid: 102, name: 'app-02' }],
  destinations: [{ type: 'qemu', vmid: 201, name: 'db-01' }],
  services: [{ proto: 'tcp', dport: '5432' }],
  comment: '', created_by: 'admin', ...over,
})

const app1 = guest(101, 'app-01')
const app2 = guest(102, 'app-02')
const db1 = guest(201, 'db-01')
const inventory = [app1, app2, db1]
const members = [member(db1)]

describe('exception services', () => {
  it('lists the catalog in the order the dialog offers it', () => {
    expect(EXCEPTION_SERVICES).toEqual([
      'postgresql', 'mysql', 'redis', 'mongodb', 'http', 'https', 'ssh', 'rdp', 'smb', 'ldap', 'ldaps', 'ping', 'all',
    ])
  })

  it.each([
    ['postgresql', '5432'], ['mysql', '3306'], ['redis', '6379'], ['mongodb', '27017'], ['http', '80'], ['https', '443'],
    ['ssh', '22'], ['rdp', '3389'], ['smb', '445'], ['ldap', '389'], ['ldaps', '636'],
  ])('%s is tcp/%s', (choice, port) => {
    expect(exceptionServiceFlows(choice)).toEqual([{ proto: 'tcp', dport: port }])
  })

  it('ping is ICMP and ICMPv6, all is any protocol', () => {
    expect(exceptionServiceFlows('ping')).toEqual([{ proto: 'icmp', dport: '' }, { proto: 'icmpv6', dport: '' }])
    expect(exceptionServiceFlows('all')).toEqual([{ proto: 'any', dport: '' }])
  })

  it('takes a typed service like the gateway list, and a whole protocol', () => {
    expect(exceptionServiceFlows('tcp/8443')).toEqual([{ proto: 'tcp', dport: '8443' }])
    expect(exceptionServiceFlows('UDP 5000:5010')).toEqual([{ proto: 'udp', dport: '5000:5010' }])
    expect(exceptionServiceFlows('icmp')).toEqual([{ proto: 'icmp', dport: '' }])
    expect(exceptionServiceFlows('tcp')).toEqual([{ proto: 'tcp', dport: '' }])
    expect(exceptionServiceFlows(' UDP ')).toEqual([{ proto: 'udp', dport: '' }])
    expect(exceptionServiceFlows('')).toEqual([])
    expect(exceptionServiceFlows('  ')).toEqual([])
  })

  it('gives back as it is a stored service the dialog would not write', () => {
    expect(exceptionServiceFlows('sctp/9000')).toEqual([{ proto: 'sctp', dport: '9000' }])
    expect(exceptionServiceFlows('gre')).toEqual([{ proto: 'gre', dport: '' }])
    expect(exceptionServiceFlows('tcp/99999')).toEqual([{ proto: 'tcp', dport: '99999' }])
    expect(exceptionServiceFlows('icmp/8')).toEqual([{ proto: 'icmp', dport: '8' }])
  })

  it('tells what the dialog may take from what only a stored service can be', () => {
    for (const text of ['redis', 'ping', 'tcp/8443', 'udp 53', 'icmpv6', 'any']) expect(isExceptionServiceText(text)).toBe(true)
    // A whole protocol is refused as typed input (Enter before the ports would open every port), and still read back when stored.
    for (const text of ['', 'nonsense', 'sctp/9000', 'tcp/99999', 'tcp/', 'icmp/8', 'tcp', 'UDP']) expect(isExceptionServiceText(text)).toBe(false)
    expect(exceptionServiceFlows('tcp')).toEqual([{ proto: 'tcp', dport: '' }])
    expect(exceptionServiceFlows('UDP')).toEqual([{ proto: 'udp', dport: '' }])
  })

  it('maps every choice back to its services, whatever was stored', () => {
    const stored = [
      { proto: 'tcp', dport: '' }, { proto: 'udp', dport: '' }, { proto: 'tcp', dport: '8443' }, { proto: 'udp', dport: '5000:5010' },
      { proto: 'tcp', dport: '80,443' }, { proto: 'icmp', dport: '' }, { proto: 'sctp', dport: '9000' }, { proto: 'gre', dport: '' },
      { proto: 'tcp', dport: '99999' }, { proto: 'icmp', dport: '8' }, { proto: 'tcp', dport: '5432' }, { proto: 'any', dport: '' },
    ]
    for (const s of stored) expect(servicesToChoices([s]).flatMap(exceptionServiceFlows)).toEqual([s])
    expect(servicesToChoices(stored)).toEqual(['tcp', 'udp', 'tcp/8443', 'udp/5000:5010', 'tcp/80,443', 'icmp', 'sctp/9000', 'gre', 'tcp/99999', 'icmp/8', 'postgresql', 'all'])
    expect(servicesToChoices(stored).flatMap(exceptionServiceFlows)).toEqual(stored)
  })

  it('tells a catalog entry from a typed service', () => {
    expect(isExceptionService('redis')).toBe(true)
    expect(isExceptionService('tcp/8443')).toBe(false)
  })

  it('shows the ports of a choice', () => {
    expect(exceptionServicePorts('postgresql')).toBe('tcp/5432')
    expect(exceptionServicePorts('ping')).toBe('icmp, icmpv6')
    expect(exceptionServicePorts('all')).toBe('any')
  })

  it('every catalog entry comes back from its own flows', () => {
    for (const choice of EXCEPTION_SERVICES) expect(servicesToChoices(exceptionServiceFlows(choice))).toEqual([choice])
  })

  it('reads services back as choices, in the order of the input', () => {
    const choices = ['tcp/8443', 'ping', 'postgresql', 'udp/5000:5010', 'all']
    const services = choices.flatMap(exceptionServiceFlows)
    expect(servicesToChoices(services)).toEqual(choices)
  })

  it('gives ping at the place of its first flow when the two are apart', () => {
    expect(servicesToChoices([
      { proto: 'icmpv6', dport: '' }, { proto: 'tcp', dport: '22' }, { proto: 'icmp', dport: '' },
    ])).toEqual(['ping', 'ssh'])
  })

  it('keeps one ICMP family alone as a typed service', () => {
    expect(servicesToChoices([{ proto: 'icmp', dport: '' }])).toEqual(['icmp'])
    expect(servicesToChoices([{ proto: 'icmpv6', dport: '' }, { proto: 'tcp', dport: '8443' }])).toEqual(['icmpv6', 'tcp/8443'])
  })

  it('gives a service listed twice once', () => {
    expect(servicesToChoices([{ proto: 'tcp', dport: '8443' }, { proto: 'tcp', dport: '8443' }, { proto: 'tcp', dport: '443' }, { proto: 'tcp', dport: '443' }]))
      .toEqual(['tcp/8443', 'https'])
  })

  it('reads no service as no choice', () => {
    expect(servicesToChoices([])).toEqual([])
  })
})

describe('exceptionRuleCount', () => {
  it('multiplies sources, destinations and services', () => {
    expect(exceptionRuleCount(2, 1, 1)).toBe(2)
    expect(exceptionRuleCount(5, 5, 2)).toBe(50)
    expect(exceptionRuleCount(0, 3, 2)).toBe(0)
  })

  it('is bounded at 50', () => {
    expect(MAX_EXCEPTION_RULES).toBe(50)
    expect(exceptionRuleCount(5, 5, 2) <= MAX_EXCEPTION_RULES).toBe(true)
    expect(exceptionRuleCount(17, 3, 1) > MAX_EXCEPTION_RULES).toBe(true)
  })
})

describe('exceptionStatus', () => {
  it('is active when the zone filters and every guest is known with its name', () => {
    expect(exceptionStatus(exception(), zone(), members, inventory)).toBe('active')
    expect(exceptionStatus(exception(), zone({ state: 'observe' }), members, inventory)).toBe('active')
  })

  it('is inactive in a disabled zone, before anything else', () => {
    expect(exceptionStatus(exception(), zone({ state: 'disabled' }), [], [])).toBe('inactive_zone')
  })

  it('has no destination when none is a member of the zone any more', () => {
    expect(exceptionStatus(exception(), zone(), [member(app1)], inventory)).toBe('no_destination')
    expect(exceptionStatus(exception({ destinations: [] }), zone(), members, inventory)).toBe('no_destination')
  })

  it('counts a pending member as a destination', () => {
    expect(exceptionStatus(exception(), zone(), [member(db1, true)], inventory)).toBe('active')
  })

  it('matches a member by type and vmid, not by vmid alone', () => {
    const ct = guest(201, 'db-01', { type: 'lxc' })
    expect(exceptionStatus(exception(), zone(), [member(ct)], [...inventory, ct])).toBe('no_destination')
  })

  it('keeps going with one destination left among several', () => {
    const e = exception({ destinations: [{ type: 'qemu', vmid: 201, name: 'db-01' }, { type: 'qemu', vmid: 202, name: 'db-02' }] })
    expect(exceptionStatus(e, zone(), members, [...inventory, guest(202, 'db-02')])).toBe('active')
  })

  it('misses a guest absent from the inventory, source or destination', () => {
    expect(exceptionStatus(exception(), zone(), members, [app1, db1])).toBe('missing_guest')
    const gone: ZoneMember = { ref: { node: 'pve1', type: 'qemu', vmid: 201 }, guest: null, pending: true }
    expect(exceptionStatus(exception(), zone(), [gone], [app1, app2])).toBe('missing_guest')
  })

  it('waits for the address of a source that has none', () => {
    expect(exceptionStatus(exception(), zone(), members, [app1, guest(102, 'app-02', { ips: [] }), db1])).toBe('waiting_address')
    expect(exceptionStatus(exception(), zone(), members, [guest(101, 'app-01', { ips: undefined }), app2, db1])).toBe('waiting_address')
  })

  it('does not wait for an address when the guest list carries none at all (the list read without the inventory)', () => {
    const bare = [app1, app2, db1].map(g => ({ ...g, ips: [] }))
    expect(exceptionStatus(exception(), zone(), members, bare)).toBe('active')
    // The other statuses still read on such a list.
    expect(exceptionStatus(exception(), zone(), members, bare.slice(1))).toBe('missing_guest')
  })

  it('does not wait for the address of a destination', () => {
    const noIp = guest(201, 'db-01', { ips: [] })
    expect(exceptionStatus(exception(), zone(), [member(noIp)], [app1, app2, noIp])).toBe('active')
  })

  it('says renamed when the inventory name is not the recorded one (renamed, or VMID reused)', () => {
    expect(exceptionStatus(exception(), zone(), members, [app1, guest(102, 'batch-07'), db1])).toBe('renamed')
    const other = guest(201, 'web-09')
    expect(exceptionStatus(exception(), zone(), [member(other)], [app1, app2, other])).toBe('renamed')
  })

  it('does not say renamed for a guest recorded without a name', () => {
    const e = exception({ sources: [{ type: 'qemu', vmid: 101, name: '' }], destinations: [{ type: 'qemu', vmid: 201, name: '' }] })
    expect(exceptionStatus(e, zone(), members, inventory)).toBe('active')
    const mixed = exception({ sources: [{ type: 'qemu', vmid: 101, name: '' }, { type: 'qemu', vmid: 102, name: 'old-name' }] })
    expect(exceptionStatus(mixed, zone(), members, inventory)).toBe('renamed')
  })

  it('gives the first status that applies, in the documented order', () => {
    const renamedNoIp = guest(102, 'batch-07', { ips: [] })
    // Missing guest wins over a source without address and over a new name.
    expect(exceptionStatus(exception(), zone(), members, [renamedNoIp, db1])).toBe('missing_guest')
    // A source without address wins over a new name.
    expect(exceptionStatus(exception(), zone(), members, [app1, renamedNoIp, db1])).toBe('waiting_address')
    // No destination wins over a missing guest.
    expect(exceptionStatus(exception(), zone(), [], [db1])).toBe('no_destination')
  })
})

describe('exceptionsOfZone', () => {
  it('keeps the exceptions of the zone, in their order', () => {
    const all = [exception({ id: 'a' }), exception({ id: 'b', zone_id: 'z-web' }), exception({ id: 'c' })]
    expect(exceptionsOfZone('z-db', all).map(e => e.id)).toEqual(['a', 'c'])
    expect(exceptionsOfZone('z-none', all)).toEqual([])
  })
})

describe('exceptionLabel', () => {
  it('names sources, destinations and service choices', () => {
    expect(exceptionLabel(exception(), inventory)).toBe('app-01, app-02 → db-01 · postgresql')
  })

  it('lets the caller name the services', () => {
    const names: Record<string, string> = { postgresql: 'PostgreSQL', ping: 'Ping' }
    const e = exception({ services: [...exceptionServiceFlows('postgresql'), ...exceptionServiceFlows('ping'), { proto: 'tcp', dport: '8443' }] })
    expect(exceptionLabel(e, inventory, c => names[c] ?? c)).toBe('app-01, app-02 → db-01 · PostgreSQL, Ping, tcp/8443')
  })

  it('uses the inventory name, and the recorded one for a guest that is gone', () => {
    expect(exceptionLabel(exception(), [guest(101, 'front-01'), db1])).toBe('front-01, app-02 → db-01 · postgresql')
  })

  it('falls back on the VMID of a guest recorded without a name', () => {
    const e = exception({ sources: [{ type: 'lxc', vmid: 300, name: '' }] })
    expect(exceptionLabel(e, inventory)).toBe('300 → db-01 · postgresql')
  })
})

describe('exception drafts', () => {
  const stored = exception({ services: [{ proto: 'icmp', dport: '' }, { proto: 'icmpv6', dport: '' }, { proto: 'tcp', dport: '' }, { proto: 'tcp', dport: '5432' }] })

  it('reads a stored exception as a draft and writes it back unchanged, guests and services in the stored order', () => {
    const draft = exceptionDraft(stored)
    expect(draft).toMatchObject({ id: stored.id, services: ['ping', 'tcp', 'postgresql'], comment: stored.comment })
    expect(draftBody(draft)).toEqual({ sources: stored.sources, destinations: stored.destinations, services: stored.services, comment: stored.comment })
    expect(draftChanged(draft, stored)).toBe(false)
  })

  it('sees a change of order, of a name, of a service or of the comment', () => {
    const draft = exceptionDraft(stored)
    expect(draftChanged({ ...draft, sources: [...draft.sources].reverse() }, stored)).toBe(true)
    expect(draftChanged({ ...draft, destinations: draft.destinations.map(d => ({ ...d, name: 'other' })) }, stored)).toBe(true)
    expect(draftChanged({ ...draft, services: [...draft.services, 'ssh'] }, stored)).toBe(true)
    expect(draftChanged({ ...draft, comment: 'why' }, stored)).toBe(true)
    // A typed service a listed one already names changes nothing.
    expect(draftChanged({ ...draft, services: [...draft.services, 'tcp/5432'] }, stored)).toBe(false)
  })

  it('stores each service once, in the order of the choices', () => {
    expect(draftServices(['postgresql', 'tcp/5432', 'ping', 'icmp', 'tcp/8443'])).toEqual([
      { proto: 'tcp', dport: '5432' }, { proto: 'icmp', dport: '' }, { proto: 'icmpv6', dport: '' }, { proto: 'tcp', dport: '8443' },
    ])
  })

  it('counts the rules on the stored services: a ping is two, a service named twice is one', () => {
    const one = { type: 'qemu' as const, vmid: 1, name: 'a' }
    expect(draftRuleCount({ sources: [one], destinations: [{ ...one, vmid: 2 }], services: ['ping', 'postgresql', 'tcp/5432'] })).toBe(3)
  })

  it('names the guests picked on both sides', () => {
    const a = { type: 'qemu' as const, vmid: 1, name: 'a' }
    const b = { type: 'lxc' as const, vmid: 1, name: 'b' }
    expect(draftOverlap({ sources: [a, b], destinations: [{ ...a, name: '' }] })).toEqual([a])
    expect(draftOverlap({ sources: [a], destinations: [b] })).toEqual([])
  })

  it('reads a draft as an exception of the zone', () => {
    expect(draftException({ sources: stored.sources, destinations: stored.destinations, services: ['ssh'], comment: '' }, 'z-db')).toMatchObject({
      id: '', zone_id: 'z-db', services: [{ proto: 'tcp', dport: '22' }],
    })
  })
})

describe('exceptionFromSuggestion', () => {
  const app = guest(101, 'app-01', { ips: ['10.0.1.5', 'fd00::5'] })
  const db = guest(201, 'db-01', { type: 'lxc', ips: ['10.0.2.9'] })
  const other = guest(202, 'db-02', { ips: ['10.0.2.10'] })
  const guests = [app, db, other]
  const memberOf = (g: PolicyGuest, pending = false): ZoneMember => ({ ref: { node: g.node, type: g.type, vmid: g.vmid }, guest: g, pending })
  const members = [memberOf(db)]
  const observed = (over: Partial<MicrosegSuggestion> = {}): MicrosegSuggestion => ({
    id: 's1', policy_id: 'p1', kind: 'would_block', src_key: 'k', src_ip: '10.0.1.5', src_zone_id: 'z-app', dst_ip: '10.0.2.9', dst_zone_id: 'z-db',
    proto: 'tcp', dport: '8443', hits: 3, first_seen: '2026-11-01T10:00:00Z', last_seen: '2026-11-02T10:00:00Z', status: 'pending', ...over,
  })

  it('makes the draft of an inbound flow between two known guests: the two guests by their inventory name, the observed service', () => {
    expect(exceptionFromSuggestion(observed(), guests, members)).toEqual({
      sources: [{ type: 'qemu', vmid: 101, name: 'app-01' }],
      destinations: [{ type: 'lxc', vmid: 201, name: 'db-01' }],
      services: ['tcp/8443'],
      comment: '',
    })
    expect(exceptionFromSuggestion(observed({ direction: 'in', src_zone_id: '' }), guests, members)).not.toBeNull()
  })

  it('names a listed service by its id, and reads the protocol whatever its case', () => {
    expect(exceptionFromSuggestion(observed({ dport: '5432' }), guests, members)?.services).toEqual(['postgresql'])
    expect(exceptionFromSuggestion(observed({ proto: 'TCP', dport: '443' }), guests, members)?.services).toEqual(['https'])
    expect(exceptionFromSuggestion(observed({ proto: 'udp', dport: '53' }), guests, members)?.services).toEqual(['udp/53'])
    expect(exceptionFromSuggestion(observed({ proto: 'icmp', dport: '' }), guests, members)?.services).toEqual(['icmp'])
  })

  it('takes a destination queued for the zone as a member', () => {
    expect(exceptionFromSuggestion(observed(), guests, [memberOf(db, true)])).not.toBeNull()
  })

  it('gives nothing for an outbound flow', () => {
    expect(exceptionFromSuggestion(observed({ direction: 'out' }), guests, members)).toBeNull()
  })

  it('gives nothing when an address is missing, unknown, or carried by two guests', () => {
    expect(exceptionFromSuggestion(observed({ src_ip: '' }), guests, members)).toBeNull()
    expect(exceptionFromSuggestion(observed({ src_ip: '192.168.1.50' }), guests, members)).toBeNull()
    expect(exceptionFromSuggestion(observed({ dst_ip: '10.9.9.9' }), guests, members)).toBeNull()
    expect(exceptionFromSuggestion(observed(), [...guests, guest(102, 'clone', { ips: ['10.0.1.5'] })], members)).toBeNull()
    // A guest list read without the inventory carries no address.
    expect(exceptionFromSuggestion(observed(), guests.map(g => ({ ...g, ips: [] })), members)).toBeNull()
    expect(exceptionFromSuggestion(observed(), guests.map(({ ips: _ips, ...g }) => g), members)).toBeNull()
  })

  it('gives nothing when the destination is not a member of the zone, or the flow has no destination zone', () => {
    expect(exceptionFromSuggestion(observed(), guests, [memberOf(other)])).toBeNull()
    expect(exceptionFromSuggestion(observed(), guests, [])).toBeNull()
    expect(exceptionFromSuggestion(observed({ dst_zone_id: '' }), guests, members)).toBeNull()
  })

  it('gives nothing when both addresses are of one guest', () => {
    expect(exceptionFromSuggestion(observed({ src_ip: '10.0.2.9' }), guests, members)).toBeNull()
  })

  it('gives nothing for a service the dialog would not take: a whole protocol, an unknown one', () => {
    expect(exceptionFromSuggestion(observed({ dport: '' }), guests, members)).toBeNull()
    expect(exceptionFromSuggestion(observed({ proto: 'gre', dport: '' }), guests, members)).toBeNull()
  })
})

describe('exceptionCovered', () => {
  const draft = { sources: [{ type: 'qemu' as const, vmid: 101, name: 'app-01' }], destinations: [{ type: 'qemu' as const, vmid: 201, name: 'db-01' }], services: ['postgresql'] }
  const stored = (over: Partial<MicrosegException> = {}): MicrosegException => ({
    id: 'e1', policy_id: 'p1', zone_id: 'z-db', created_by: 'me', comment: '',
    sources: [{ type: 'qemu', vmid: 101, name: 'old-name' }, { type: 'qemu', vmid: 102, name: 'app-02' }],
    destinations: [{ type: 'qemu', vmid: 201, name: 'db-01' }],
    services: [{ proto: 'tcp', dport: '22' }, { proto: 'tcp', dport: '5432' }],
    ...over,
  })

  it('is true when one exception of the zone holds the source, the destination and the service, whatever the recorded names and the rest', () => {
    expect(exceptionCovered(draft, 'z-db', [stored()])).toBe(true)
    expect(exceptionCovered({ ...draft, services: ['tcp/5432'] }, 'z-db', [stored()])).toBe(true)
  })

  it('is false for another zone, another guest (the same vmid of the other type included), another service, or parts spread over two exceptions', () => {
    expect(exceptionCovered(draft, 'z-web', [stored()])).toBe(false)
    expect(exceptionCovered(draft, 'z-db', [])).toBe(false)
    expect(exceptionCovered(draft, 'z-db', [stored({ sources: [{ type: 'lxc', vmid: 101, name: 'app-01' }] })])).toBe(false)
    expect(exceptionCovered(draft, 'z-db', [stored({ destinations: [{ type: 'qemu', vmid: 202, name: 'db-02' }] })])).toBe(false)
    expect(exceptionCovered(draft, 'z-db', [stored({ services: [{ proto: 'tcp', dport: '22' }] })])).toBe(false)
    expect(exceptionCovered({ ...draft, services: ['ping'] }, 'z-db', [stored({ services: [{ proto: 'icmp', dport: '' }] })])).toBe(false)
    expect(exceptionCovered(draft, 'z-db', [
      stored({ id: 'a', services: [{ proto: 'tcp', dport: '22' }] }),
      stored({ id: 'b', sources: [{ type: 'qemu', vmid: 102, name: 'app-02' }] }),
    ])).toBe(false)
  })
})

describe('namedGuests', () => {
  it('names each guest by the inventory, then by what was recorded, then by its VMID, in the order given', () => {
    const app = guest(101, 'front-01')
    const named = namedGuests([{ type: 'qemu', vmid: 101, name: 'app-01' }, { type: 'lxc', vmid: 300, name: 'batch' }, { type: 'qemu', vmid: 999, name: '' }], [app])
    expect(named).toEqual([
      { key: 'qemu/101', vmid: 101, name: 'front-01', guest: app },
      { key: 'lxc/300', vmid: 300, name: 'batch', guest: undefined },
      { key: 'qemu/999', vmid: 999, name: '999', guest: undefined },
    ])
  })
})

describe('shownExceptionStatus', () => {
  it('says nothing of an active exception', () => {
    expect(shownExceptionStatus('active', true)).toBeNull()
    expect(shownExceptionStatus('active', false)).toBeNull()
  })

  it('says every other status once the guest list is known', () => {
    for (const status of ['inactive_zone', 'no_destination', 'missing_guest', 'waiting_address', 'renamed'] as const) {
      expect(shownExceptionStatus(status, true)).toBe(status)
    }
  })

  it('says only the zone that is not applied while the guest list is unknown', () => {
    expect(shownExceptionStatus('inactive_zone', false)).toBe('inactive_zone')
    for (const status of ['no_destination', 'missing_guest', 'waiting_address', 'renamed'] as const) {
      expect(shownExceptionStatus(status, false)).toBeNull()
    }
  })
})

describe('draftMatches', () => {
  const draft = {
    sources: [{ type: 'qemu' as const, vmid: 101, name: 'old-name' }, { type: 'lxc' as const, vmid: 300, name: 'Batch' }],
    destinations: [{ type: 'qemu' as const, vmid: 201, name: 'db-01' }],
    services: ['postgresql', 'tcp/8443'],
  }
  const inventory = [guest(101, 'app-01'), guest(201, 'db-01')]
  const name = (choice: string) => (choice === 'postgresql' ? 'PostgreSQL' : choice)
  const matches = (text: string) => draftMatches(draft, inventory, name, text)

  it('matches every draft on an empty text', () => {
    expect(matches('')).toBe(true)
    expect(matches('   ')).toBe(true)
  })

  it('reads the names shown (inventory first, recorded for a guest that is gone), on both sides, whatever the case', () => {
    expect(matches('APP-0')).toBe(true)
    expect(matches('batch')).toBe(true)
    expect(matches(' db-01 ')).toBe(true)
    // The recorded name of a guest the inventory names otherwise is not shown, so not searched.
    expect(matches('old-name')).toBe(false)
  })

  it('reads the VMIDs', () => {
    expect(matches('300')).toBe(true)
    expect(matches('20')).toBe(true)
    expect(matches('777')).toBe(false)
  })

  it('reads the services by their display name, their text and their ports', () => {
    expect(matches('postgres')).toBe(true)
    expect(matches('5432')).toBe(true)
    expect(matches('TCP/8443')).toBe(true)
    expect(matches('ssh')).toBe(false)
  })
})
