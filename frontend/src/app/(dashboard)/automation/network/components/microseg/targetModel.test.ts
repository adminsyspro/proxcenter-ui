import { describe, expect, it } from 'vitest'

import { buildCompactGraph } from './compactGraph'
import { buildGuestView } from './guestViewModel'
import { buildMatrix } from './matrixModel'
import { demoInput, flow, seen, zone } from './mapViewsTestKit'
import {
  filterTargets, involvesTarget, matchesTarget, targetCandidates, targetFocus, targetNodeId, targetPeers, targetRibbons, targetRing, targetSankey, targetSuggestions,
  type TargetGuest,
} from './targetModel'
import { buildNodeView } from './nodeViewModel'
import { ALL_FLOWS, buildZoneGraph } from './zoneGraph'
import type { PolicyGuest, ZoneMember } from './zoneModel'

const guest = (vmid: number, name: string, ips: string[] = [], over: Partial<PolicyGuest> = {}): PolicyGuest => ({
  connectionId: 'c1', vmid, name, node: 'pve1', type: 'qemu', status: 'running', tags: [], ips, ...over,
})
const memberOf = (g: PolicyGuest, pending = false): ZoneMember => ({ connectionId: g.connectionId, ref: { node: g.node, type: g.type, vmid: g.vmid }, guest: g, pending })
const target = (over: Partial<TargetGuest> = {}): TargetGuest => ({
  id: 'c1/qemu/100', connectionId: 'c1', key: 'qemu/100', vmid: 100, name: 'web-1', type: 'qemu', node: 'pve1', status: 'running', ips: ['10.0.1.1'], zoneId: 'zw', ...over,
})

describe('the guests a VM target can pick', () => {
  const web1 = guest(100, 'web-1', ['10.0.1.1/24'])
  const db1 = guest(200, 'db-1', ['10.0.4.1'])
  const lost = guest(300, 'lost', ['10.9.0.1'])
  const stopped = guest(400, 'old', [], { status: 'stopped' })

  it('lists the flows of a guest pair by pair: only the pairs it is an end of, each with its own hits', () => {
    // One flow web → db counts three pairs; db-1 (10.0.4.1) is the destination of two of them.
    const s = seen('s1', { src_zone_id: 'zw', src_ip: '10.0.1.2', dst_zone_id: 'zd', dst_ip: '10.0.4.1', hits: 12, pairs: [
      { src_ip: '10.0.1.2', dst_ip: '10.0.4.1', hits: 6 }, { src_ip: '10.0.1.1', dst_ip: '10.0.4.1', hits: 4 }, { src_ip: '10.0.1.3', dst_ip: '10.0.4.2', hits: 2 },
    ] })
    const db = targetSuggestions([s], target({ ips: ['10.0.4.1'], zoneId: 'zd', key: 'qemu/200', vmid: 200 }))
    expect(db.map(f => [f.direction, f.peerIp, f.suggestion.hits, f.suggestion.id])).toEqual([['in', '10.0.1.2', 6, 's1'], ['in', '10.0.1.1', 4, 's1']])
    // web-1 (10.0.1.1) sends one of them, and is not given the pair of its neighbour.
    const web = targetSuggestions([s], target())
    expect(web.map(f => [f.direction, f.peerIp, f.suggestion.hits])).toEqual([['out', '10.0.4.1', 4]])
  })

  it('lists the running guests by name with the zone each one belongs to, or none', () => {
    const members = new Map([['zw', [memberOf(web1)]], ['zd', [memberOf(db1)]]])
    const list = targetCandidates([web1, stopped, lost, db1], members)
    expect(list.map(c => [c.name, c.zoneId])).toEqual([['db-1', 'zd'], ['lost', null], ['web-1', 'zw']])
  })

  it('prefers the zone a guest is tagged with over the one it is queued for', () => {
    const members = new Map([['za', [memberOf(web1, true)]], ['zw', [memberOf(web1)]]])
    expect(targetCandidates([web1], members)[0].zoneId).toBe('zw')
    expect(targetCandidates([web1], new Map([['za', [memberOf(web1, true)]]]))[0].zoneId).toBe('za')
  })

  it('matches a name anywhere, a VMID or an address from its start, whatever the case', () => {
    const t = target({ name: 'Web-Front', vmid: 1042, ips: ['10.0.1.1/24', 'fe80::1'] })
    expect(matchesTarget(t, 'front')).toBe(true)
    expect(matchesTarget(t, '104')).toBe(true)
    expect(matchesTarget(t, '042')).toBe(false)
    expect(matchesTarget(t, '10.0.1')).toBe(true)
    expect(matchesTarget(t, '0.1.1')).toBe(false)
    expect(matchesTarget(t, 'FE80')).toBe(true)
    expect(matchesTarget(t, '  ')).toBe(true)
    expect(matchesTarget(t, 'db')).toBe(false)
  })

  it('filters the list and caps it', () => {
    const many = Array.from({ length: 80 }, (_, i) => target({ key: `qemu/${i}`, vmid: i, name: `vm-${i}` }))
    expect(filterTargets(many, 'vm-7').map(c => c.vmid)).toEqual([7, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79])
    expect(filterTargets(many, '')).toHaveLength(50)
  })
})

describe('the observed flows of a targeted guest', () => {
  it('matches its addresses through their canonical text, as a source or as a destination', () => {
    const t = target({ ips: ['10.0.1.1/24', '2001:DB8:0:0::1'] })
    expect(involvesTarget(seen('a', { src_ip: '10.0.1.1' }), t)).toBe(true)
    expect(involvesTarget(seen('b', { dst_ip: '2001:db8::1' }), t)).toBe(true)
    expect(involvesTarget(seen('c', { src_ip: '::ffff:10.0.1.1' }), t)).toBe(true)
    expect(involvesTarget(seen('d', { src_ip: '10.0.1.10', dst_ip: '10.0.4.1' }), t)).toBe(false)
    expect(involvesTarget(seen('e', { src_ip: '', dst_ip: '' }), target({ ips: [] }))).toBe(false)
  })

  it('splits them in outgoing and incoming, pending only', () => {
    const t = target()
    const out = targetSuggestions([
      seen('in', { src_ip: '10.9.0.1', dst_ip: '10.0.1.1' }),
      seen('out', { src_ip: '10.0.1.1', dst_ip: '10.0.4.1' }),
      seen('done', { src_ip: '10.0.1.1', status: 'accepted' }),
      seen('other', { src_ip: '10.0.2.1', dst_ip: '10.0.4.1' }),
    ], t)
    expect(out.map(r => [r.suggestion.id, r.direction, r.peerIp])).toEqual([['out', 'out', '10.0.4.1'], ['in', 'in', '10.9.0.1']])
  })

  it('keeps the outbound flows of the emitting zone for a guest of it when their source address is not known, and names the emitting zone for the guest they reach', () => {
    const outbound = (id: string, over: Record<string, unknown> = {}) => seen(id, { direction: 'out', src_key: 'zw', src_zone_id: 'zw', src_ip: '', dst_zone_id: '', dst_key: '10.0.2.7', dst_ip: '10.0.2.7', ...over })
    const web1 = targetSuggestions([outbound('o1'), outbound('o2', { src_key: 'zd', src_zone_id: 'zd' })], target())
    expect(web1.map(r => [r.suggestion.id, r.direction, r.peerIp])).toEqual([['o1', 'out', '10.0.2.7']])
    const admin = targetSuggestions([outbound('o1')], target({ ips: ['10.0.2.7'], zoneId: null, key: 'lxc/300', vmid: 300 }))
    expect(admin.map(r => [r.suggestion.id, r.direction, r.peerIp, r.peerZoneId])).toEqual([['o1', 'in', '', 'zw']])
    const own = targetSuggestions([outbound('o3', { src_ip: '10.0.1.1' })], target())
    expect(own.map(r => [r.suggestion.id, r.direction])).toEqual([['o3', 'out']])
  })

  it('lists the outbound flows of its zone for each member whatever the sample source address, marking those another member emitted, its own first', () => {
    const outbound = (id: string, over: Record<string, unknown> = {}) => seen(id, { direction: 'out', src_key: 'zw', src_zone_id: 'zw', src_ip: '10.0.1.9', dst_zone_id: '', dst_key: '10.0.2.7', dst_ip: '10.0.2.7', hits: 1, ...over })
    const rows = targetSuggestions([
      outbound('other', { hits: 50 }),
      outbound('mine', { src_ip: '10.0.1.1', hits: 2 }),
      outbound('foreign', { src_key: 'zd', src_zone_id: 'zd' }),
    ], target())
    expect(rows.map(r => [r.suggestion.id, r.direction, r.fromZone ?? null])).toEqual([['mine', 'out', null], ['other', 'out', 'zw']])
    const unzoned = targetSuggestions([outbound('other')], target({ zoneId: null }))
    expect(unzoned).toEqual([])
  })

  it('names a peer by its guest when an address is known', () => {
    const peers = targetPeers([guest(200, 'db-1', ['10.0.4.1/24'])])
    expect(peers.get('10.0.4.1')).toBe('db-1')
  })
})

describe('the focus a target locks on the map', () => {
  const input = () => {
    const d = demoInput()
    return { ...d, members: d.members, unzoned: d.unzoned }
  }

  it('lights its guest in Groups and the observed edges it is an end of; keeps its zone and the zones of its pairs', () => {
    const graph = buildZoneGraph(input())
    // web-1 (10.0.1.1) sends s1 to db-1; web allows f03 to app and receives f01 from External and f06 from app.
    const focus = targetFocus(graph, target())!
    expect(focus.node).toBe('guest:zw:qemu/100')
    expect([...focus.edges].sort()).toEqual(['unprotected:guest:zw:qemu/100>guest:zd:qemu/400'])
    expect(focus.nodes.has('guest:zw:qemu/100')).toBe(true)
    expect(focus.nodes.has('zone:zw')).toBe(true)
    expect(focus.nodes.has('guest:zd:qemu/400')).toBe(true)
    expect(focus.nodes.has('guest:zw:qemu/101')).toBe(false)
    expect(focus.fit.sort()).toEqual(['zone:zd', 'zone:zw'])
  })

  it('draws the zones with no relation to the guest, and their edges, as a faint outline; the allowed flows between kept zones are only dimmed', () => {
    const graph = buildZoneGraph(input())
    const focus = targetFocus(graph, target())!
    // app and External have no pair with web-1: faint; web and db are kept.
    expect(focus.faintNodes.has('zone:za')).toBe(true)
    expect(focus.faintNodes.has('external')).toBe(true)
    expect(focus.faintNodes.has('zone:zw')).toBe(false)
    expect(focus.faintNodes.has('guest:zw:qemu/101')).toBe(false)
    expect(focus.faintEdges.has('allowed:zone:zw>zone:za')).toBe(true)
    expect(focus.faintEdges.has('allowed:external>zone:zw')).toBe(true)
    expect(focus.faintEdges.has('unprotected:guest:zw:qemu/100>guest:zd:qemu/400')).toBe(false)
    const between = graph.edges.filter(e => e.source.endsWith('zw') && e.target.endsWith('zd') && e.id.startsWith('allowed'))
    for (const e of between) expect(focus.faintEdges.has(e.id)).toBe(false)
  })

  it('lights its zone box in Compact, and only the observed edges its flows ride on', () => {
    const graph = buildCompactGraph(input())
    const focus = targetFocus(graph, target())!
    expect(focus.node).toBe('zone:zw')
    expect(focus.edges.has('unprotected:zone:zw>zone:zd')).toBe(true)
    // s5 (web-2 to db) is blocked: not web-1's.
    expect(focus.edges.has('blocked:zone:zw>zone:zd')).toBe(false)
    // The allowed edges are context now: not lit.
    expect(focus.edges.has('allowed:zone:zw>zone:za')).toBe(false)
  })

  it('falls back on the "+N" of its circle when the guest is not drawn', () => {
    const d = input()
    const many = Array.from({ length: 14 }, (_, i) => ({ ...d.members.get('zw')![0], key: `qemu/${500 + i}`, name: `w-${String(i).padStart(2, '0')}`, vmid: 500 + i, ips: [] }))
    const graph = buildZoneGraph({ ...d, members: new Map([...d.members, ['zw', many]]) })
    expect(targetNodeId(graph, target({ key: 'qemu/513', vmid: 513 }))).toBe('more:zw')
  })

  it('finds the guest in the circle of its Proxmox node on the node view, its "+N" past the guests drawn, and lights its node to node edges', () => {
    const d = input()
    const graph = buildNodeView({ ...d, members: new Map([...d.members].map(([id, list]) => [id, list.map(m => ({ ...m, node: id === 'zw' ? 'pve1' : 'pve2' }))])) })
    const focus = targetFocus(graph, target())!
    expect(focus.node).toBe('guest:pve:pve1:qemu/100')
    expect(focus.nodes.has('pve:pve1')).toBe(true)
    expect([...focus.edges].every(id => /^(unprotected|blocked):pve:pve1>pve:pve2$/.test(id))).toBe(true)
    expect(focus.edges.size).toBeGreaterThan(0)
    const many = Array.from({ length: 14 }, (_, i) => ({ ...d.members.get('zw')![0], key: `qemu/${500 + i}`, name: `w-${String(i).padStart(2, '0')}`, vmid: 500 + i, ips: [], node: 'pve7' }))
    const crowded = buildNodeView({ ...d, members: new Map([['zw', many]]), unzoned: [] })
    expect(targetNodeId(crowded, target({ key: 'qemu/513', vmid: 513, node: 'pve7' }))).toBe('more:pve:pve7')
  })

  it('finds a guest in no zone in the dashed circle', () => {
    const graph = buildZoneGraph(input())
    const t = target({ key: 'qemu/900', vmid: 900, name: 'lost-1', ips: ['10.9.0.1'], zoneId: null })
    const focus = targetFocus(graph, t)!
    expect(focus.node).toBe('guest:unzoned:qemu/900')
    expect(focus.edges.has('unprotected:guest:unzoned:qemu/900>guest:za:qemu/301')).toBe(true)
    expect([...focus.edges].some(id => id.startsWith('allowed'))).toBe(false)
  })

  it('is nothing without a target, and nothing when the canvas draws nothing of it', () => {
    expect(targetFocus(buildZoneGraph(input()), null)).toBeNull()
    // The guest view centred on cache: web-1 and the flows of web are not drawn, the map must not be dimmed.
    const graph = buildGuestView({ ...input(), centre: 'zc' })
    expect(graph.nodes.length).toBeGreaterThan(0)
    expect(targetFocus(graph, target())).toBeNull()
  })
})

describe('the ribbons a target lights in the Sankey diagram', () => {
  it('are the observed ribbons of the pairs its flows ride on, of their kind', () => {
    const model = buildMatrix({
      zones: [zone('zw', 'web'), zone('zd', 'db')],
      flows: [flow('f1')],
      suggestions: [seen('s1', { src_ip: '10.0.1.1', dst_ip: '10.0.4.1' }), seen('s2', { kind: 'blocked', src_ip: '10.0.1.2', dst_ip: '10.0.4.1' })],
    })
    expect([...targetRibbons(model, ALL_FLOWS, target())]).toEqual(['unprotected:cell:zone:zw>zone:zd'])
    expect([...targetRibbons(model, { ...ALL_FLOWS, unprotected: false }, target())]).toEqual([])
    expect(targetSankey(model, ALL_FLOWS, target())).toEqual({ zone: 'zone:zw', ribbons: new Set(['unprotected:cell:zone:zw>zone:zd']) })
    expect(targetSankey(model, ALL_FLOWS, target({ zoneId: null })).zone).toBeNull()
  })

  it('rings the guest in the colour of its zone, the theme colour without one', () => {
    const zones = new Map([['zw', zone('zw', 'web', { color: '#ff0000' })]])
    expect(targetRing(target(), zones)).toBe('#ff0000')
    expect(targetRing(target({ zoneId: null }), zones)).toBe('')
    expect(targetRing(null, zones)).toBe('')
  })
})
