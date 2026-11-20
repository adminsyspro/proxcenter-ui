import { describe, expect, it } from 'vitest'

import { buildConstellationGraph } from './constellationGraph'
import {
  clusterItemId, filterCentre, filterInput, filterItems, filterMarks, guestItemId, itemName, keepsFlow, mapFilter, matchesItem, nodeItemId, searchItems, trimMatrix, zoneItemId,
  type FilterItem,
} from './mapFilterModel'
import { buildMatrix } from './matrixModel'
import { demoInput, member, seen, zone } from './mapViewsTestKit'
import { buildNodeView } from './nodeViewModel'
import { MAX_OPTIONS, type TargetGuest } from './targetModel'
import { EXTERNAL_ID, OUTSIDE_ID, UNZONED_ID, buildZoneGraph, pveNodeId, zoneNodeId, type MapInput } from './zoneGraph'

const guest = (over: Partial<TargetGuest>): TargetGuest => ({
  id: 'c1:qemu/100', connectionId: 'c1', key: 'qemu/100', vmid: 100, name: 'web-1', type: 'qemu', node: 'pve1', status: 'running', ips: [], zoneId: 'zw', ...over,
})

/** The running guests of the demo draft, as the filter lists them (web-1 to web-8 on pve1, the others on pve2). */
function candidates(): TargetGuest[] {
  const input = demoInput()
  const zoned = [...input.members].flatMap(([zoneId, members]) => members.map(m => guest({
    id: `c1:${m.key}`, key: m.key, vmid: m.vmid, name: m.name, ips: m.ips, zoneId, node: zoneId === 'zw' ? 'pve1' : 'pve2',
  })))
  const lost = input.unzoned.map(m => guest({ id: `c1:${m.key}`, key: m.key, vmid: m.vmid, name: m.name, ips: m.ips, zoneId: null, node: 'pve2' }))
  return [...zoned, ...lost]
}

const byId = (items: FilterItem[], id: string) => items.find(i => i.id === id)!

describe('what the map can be filtered on', () => {
  it('lists the zones by name, the Proxmox nodes with their guests, the clusters of a shared policy, then the guests', () => {
    const input = demoInput()
    const items = filterItems(input.zones, candidates(), [{ id: 'c1', name: 'PVE-DR' }, { id: 'c2', name: 'PVE-PROD' }])
    expect(items.slice(0, 6).map(itemName)).toEqual(['admin', 'app', 'cache', 'db', 'monitoring', 'web'])
    expect(items.filter(i => i.kind === 'node').map(i => `${itemName(i)}:${i.kind === 'node' ? i.guests : 0}:${i.kind === 'node' ? i.cluster?.name : ''}`)).toEqual(['pve1:8:PVE-DR', 'pve2:27:PVE-DR'])
    expect(items.filter(i => i.kind === 'cluster').map(i => `${itemName(i)}:${i.kind === 'cluster' ? i.guests : 0}`)).toEqual(['PVE-DR:35', 'PVE-PROD:0'])
    expect(items.filter(i => i.kind === 'guest')).toHaveLength(35)
    expect(byId(items, zoneItemId('zw')).kind).toBe('zone')
    expect(byId(items, nodeItemId('c1', 'pve1')).kind).toBe('node')
    expect(byId(items, clusterItemId('c2')).kind).toBe('cluster')
    expect(byId(items, guestItemId({ id: 'c1:qemu/100' })).kind).toBe('guest')
  })

  it('offers no cluster on a policy of one cluster, and names a node without its cluster', () => {
    const items = filterItems([zone('zw', 'web')], [guest({})], null)
    expect(items.map(i => i.kind)).toEqual(['zone', 'node', 'guest'])
    expect(items[1]).not.toHaveProperty('cluster')
  })

  it('matches a guest on its name, VMID or address, the others on their name; every zone and node, the first guests only', () => {
    const items = filterItems(demoInput().zones, candidates(), null)
    expect(matchesItem(byId(items, zoneItemId('zd')), 'D')).toBe(true)
    expect(matchesItem(byId(items, zoneItemId('zd')), 'web')).toBe(false)
    expect(matchesItem(byId(items, 'c1:qemu/100'), '10.0.1.1')).toBe(true)
    expect(matchesItem(byId(items, nodeItemId('c1', 'pve2')), '')).toBe(true)
    expect(searchItems(items, 'db').map(itemName)).toEqual(['db', 'db-1', 'db-2', 'db-3', 'db-4'])
    const many = filterItems([zone('za', 'a')], Array.from({ length: 80 }, (_, i) => guest({ id: `c1:qemu/${i}`, key: `qemu/${i}`, vmid: i, name: `vm-${i}` })), null)
    expect(searchItems(many, 'vm').filter(i => i.kind === 'guest')).toHaveLength(MAX_OPTIONS)
  })
})

describe('the filter of the picked items', () => {
  const all = () => filterItems(demoInput().zones, candidates(), [{ id: 'c1', name: 'PVE-DR' }])

  it('is nothing without a pick, and the single target for one guest alone', () => {
    expect(mapFilter([], candidates(), false)).toBeNull()
    const one = mapFilter([byId(all(), 'c1:qemu/100')], candidates(), true)!
    expect(one.single?.name).toBe('web-1')
    // "Only between them" takes two picks.
    expect(one.between).toBe(false)
    expect(mapFilter([byId(all(), zoneItemId('zd'))], candidates(), false)!.single).toBeNull()
  })

  it('names the guests of a picked node or cluster, their addresses and zones', () => {
    const items = all()
    const f = mapFilter([byId(items, nodeItemId('c1', 'pve1')), byId(items, zoneItemId('zd'))], candidates(), true)!
    expect(f.guests.map(g => g.name)).toEqual(['web-1', 'web-2', 'web-3', 'web-4', 'web-5', 'web-6', 'web-7', 'web-8'])
    expect(f.ips.has('10.0.1.1')).toBe(true)
    expect([...f.guestZoneIds]).toEqual(['zw'])
    expect([...f.zoneIds]).toEqual(['zd'])
    expect(f.between).toBe(true)
    expect(mapFilter([byId(items, clusterItemId('c1'))], candidates(), false)!.guests).toHaveLength(35)
  })

  it('keeps an observed flow with one end picked, or both with "only between them", pair by pair', () => {
    const f = { ips: new Set(['10.0.1.1']), zoneIds: new Set(['zd']), between: false }
    expect(keepsFlow(f, seen('a', { src_ip: '10.0.1.1', src_zone_id: 'zw', dst_zone_id: 'za' }))).toBe(true)
    expect(keepsFlow(f, seen('b', { src_zone_id: 'zw', dst_zone_id: 'zd' }))).toBe(true)
    expect(keepsFlow(f, seen('c', { src_zone_id: 'zw', dst_zone_id: 'za' }))).toBe(false)
    const between = { ...f, between: true }
    expect(keepsFlow(between, seen('d', { src_ip: '10.0.1.1', src_zone_id: 'zw', dst_zone_id: 'zd' }))).toBe(true)
    expect(keepsFlow(between, seen('e', { src_ip: '10.0.1.2', src_zone_id: 'zw', dst_zone_id: 'zd' }))).toBe(false)
    // The sample pair is another guest's: one of the pairs it counts is the guest's.
    expect(keepsFlow(between, seen('g', { src_ip: '10.0.1.2', src_zone_id: 'zw', dst_zone_id: 'zd', pairs: [{ src_ip: '10.0.1.1/24', dst_ip: '10.0.4.1', hits: 3 }] }))).toBe(true)
  })
})

describe('the map reduced to what the filter keeps', () => {
  const pick = (ids: string[], between: boolean) => {
    const items = filterItems(demoInput().zones, candidates(), null)
    return mapFilter(ids.map(id => byId(items, id)), candidates(), between)!
  }
  const reduced = (ids: string[], between: boolean): MapInput => filterInput(demoInput(), pick(ids, between))

  it('keeps two zones and only the flows between them', () => {
    const input = reduced([zoneItemId('za'), zoneItemId('zd')], true)
    expect(input.zones.map(z => z.name).sort((a, b) => a.localeCompare(b))).toEqual(['app', 'db'])
    expect(input.flows.map(f => f.id)).toEqual(['f07'])
    expect(input.suggestions).toEqual([])
    expect([...input.members!.keys()].sort((a, b) => a.localeCompare(b))).toEqual(['za', 'zd'])
    expect(input.unzoned).toEqual([])
    // Each rendering lays out only that.
    expect(buildZoneGraph(input).nodes.filter(n => !n.parentId).map(n => n.id).sort((a, b) => a.localeCompare(b))).toEqual([zoneNodeId('za'), zoneNodeId('zd')])
    expect(buildConstellationGraph(input).edges).toHaveLength(1)
  })

  it('adds what they exchange with: the other zones, Outside and the guests in no zone at an end of a flow', () => {
    const input = reduced([zoneItemId('za'), zoneItemId('zd')], false)
    expect(input.zones.map(z => z.id).sort((a, b) => a.localeCompare(b))).toEqual(['za', 'zad', 'zc', 'zd', 'zm', 'zw'])
    expect(input.flows.some(f => f.dst_cidr)).toBe(true)
    expect(input.unzoned!.map(m => m.name)).toEqual(['lost-1'])
    const ids = buildZoneGraph(input).nodes.map(n => n.id)
    // No flow of app or db comes from an address in no zone: Unknown / External is not drawn.
    expect(ids).not.toContain(EXTERNAL_ID)
    expect(ids).toContain(OUTSIDE_ID)
    expect(ids).toContain(UNZONED_ID)
  })

  it('keeps a picked guest in its zone, with the zones of its observed flows', () => {
    const input = reduced(['c1:qemu/101', zoneItemId('zd')], true)
    expect(input.zones.map(z => z.id).sort((a, b) => a.localeCompare(b))).toEqual(['zd', 'zw'])
    expect(input.suggestions.map(s => s.id)).toEqual(['s5'])
    expect(input.flows).toEqual([])
  })

  it('keeps the Proxmox nodes that still hold a guest, and a node picked even empty', () => {
    const base = { ...demoInput(), pveNodes: [{ node: 'pve1', guests: 8 }, { node: 'pve2', guests: 27 }, { node: 'pve3', guests: 0 }] }
    const members = new Map([...base.members].map(([id, list]) => [id, list.map(m => member(m.vmid, m.name, m.ips, { node: id === 'zw' ? 'pve1' : 'pve2' }))]))
    const items = filterItems(base.zones, [...candidates(), guest({ id: 'c1:qemu/999', key: 'qemu/999', vmid: 999, name: 'idle', node: 'pve3', zoneId: null })], null)
    const f = mapFilter([byId(items, zoneItemId('zw')), byId(items, zoneItemId('zd'))], candidates(), true)!
    expect(filterInput({ ...base, members }, f).pveNodes!.map(n => n.node)).toEqual(['pve1', 'pve2'])
    const g = mapFilter([byId(items, nodeItemId('c1', 'pve3')), byId(items, zoneItemId('zw'))], candidates(), true)!
    expect(filterInput({ ...base, members }, g).pveNodes!.map(n => n.node)).toEqual(['pve1', 'pve3'])
  })

  it('rings what was picked among its peers: a zone in its colour, a guest in its zone colour, a Proxmox node in the theme colour', () => {
    const input = demoInput()
    const items = filterItems(input.zones, candidates(), null)
    const f = mapFilter([byId(items, zoneItemId('zd')), byId(items, 'c1:qemu/100'), byId(items, nodeItemId('c1', 'pve2'))], candidates(), false)!
    const ring = (zoneId: string | null) => (zoneId ? `#${zoneId}` : '')
    const marks = filterMarks(buildZoneGraph(input), f, ring)
    expect(marks.get(zoneNodeId('zd'))).toBe('#zd')
    expect(marks.get('guest:zw:qemu/100')).toBe('#zw')
    const nodeMarks = filterMarks(buildNodeView({ ...input, pveNodes: [{ node: 'pve2', guests: 27 }] }), f)
    expect(nodeMarks.get(pveNodeId('pve2'))).toBe('')
  })

  it('drops the Unknown / External row and the Outside column of a filtered matrix when no pair kept uses them', () => {
    const trimmed = trimMatrix(buildMatrix(reduced([zoneItemId('za'), zoneItemId('zd')], true)))
    expect(trimmed.rows.map(r => r.id)).toEqual([zoneNodeId('za'), zoneNodeId('zd')])
    expect(trimmed.cols.map(c => c.id)).toEqual([zoneNodeId('za'), zoneNodeId('zd')])
    const whole = trimMatrix(buildMatrix(demoInput()))
    expect(whole.rows.map(r => r.id)).toContain(EXTERNAL_ID)
    expect(whole.cols.map(c => c.id)).toContain(OUTSIDE_ID)
  })

  it('centres the guest view on the first zone picked, else on the zone of the first guest picked', () => {
    const items = filterItems(demoInput().zones, candidates(), null)
    expect(filterCentre([byId(items, 'c1:qemu/100'), byId(items, zoneItemId('zd'))])).toBe('zd')
    expect(filterCentre([byId(items, nodeItemId('c1', 'pve1')), byId(items, 'c1:qemu/100')])).toBe('zw')
    expect(filterCentre([byId(items, 'c1:qemu/900')])).toBeNull()
  })
})
