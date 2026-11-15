/** The grouping of the Observation table, the share bar of the hits and the stored collapsed groups. */

import { describe, expect, it } from 'vitest'

import { cidrPreview, decodeCollapsed, destinationLabel, encodeCollapsed, groupByDestination, hitsShare, maxHits, prefixBounds } from './observationModel'

const row = (id: string, dst: string, hits: number) => ({ id, dst_zone_id: dst, hits })
const names: Record<string, string> = { za: 'app', zd: 'db', zw: 'web', '': 'Unknown destination' }
const nameOf = (id: string) => names[id] ?? 'Deleted zone'

describe('groupByDestination', () => {
  it('groups by destination zone, the most hits first, the unknown destination last, rows in page order', () => {
    const groups = groupByDestination([row('1', 'zw', 10), row('2', '', 900), row('3', 'zd', 5), row('4', 'zw', 1), row('5', 'zd', 20)], nameOf)
    expect(groups.map(g => [g.key, g.name, g.hits, g.rows.map(r => r.id)])).toEqual([
      ['zd', 'db', 25, ['3', '5']],
      ['zw', 'web', 11, ['1', '4']],
      ['', 'Unknown destination', 900, ['2']],
    ])
  })

  it('orders zones with the same hits by name, and names a zone that is gone', () => {
    const groups = groupByDestination([row('1', 'zw', 3), row('2', 'za', 3), row('3', 'zx', 1)], nameOf)
    expect(groups.map(g => g.name)).toEqual(['app', 'web', 'Deleted zone'])
  })

  it('ends a tie of hits and name on the zone id, whatever the order of the page', () => {
    const same = (id: string) => (id === 'zx' || id === 'zy' ? 'twin' : nameOf(id))
    const one = groupByDestination([row('1', 'zy', 4), row('2', 'zx', 4)], same).map(g => g.key)
    const two = groupByDestination([row('2', 'zx', 4), row('1', 'zy', 4)], same).map(g => g.key)
    expect(one).toEqual(['zx', 'zy'])
    expect(two).toEqual(one)
  })

  it('has no group for an empty page', () => {
    expect(groupByDestination([], nameOf)).toEqual([])
  })
})

describe('hitsShare', () => {
  it('is the share of the busiest flow in percent, at least 2 for a flow with hits', () => {
    expect(hitsShare(200, 200)).toBe(100)
    expect(hitsShare(50, 200)).toBe(25)
    expect(hitsShare(1, 10_000)).toBe(2)
    expect(hitsShare(0, 200)).toBe(0)
    expect(hitsShare(5, 0)).toBe(0)
    expect(hitsShare(300, 200)).toBe(100)
    expect(hitsShare(Number.NaN, 200)).toBe(0)
  })

  it('takes the most hits of the page', () => {
    expect(maxHits([{ hits: 3 }, { hits: 40 }, { hits: 7 }])).toBe(40)
    expect(maxHits([])).toBe(0)
  })
})

describe('collapsed groups storage', () => {
  it('reads back what it wrote and ignores anything else', () => {
    expect(decodeCollapsed(encodeCollapsed(['zd', '']))).toEqual(['zd', ''])
    expect(decodeCollapsed(null)).toEqual([])
    expect(decodeCollapsed('not json')).toEqual([])
    expect(decodeCollapsed('{"a":1}')).toEqual([])
    expect(decodeCollapsed('["zd",3,null]')).toEqual(['zd'])
  })
})

describe('groupByDestination on the destination key', () => {
  const out = (id: string, key: string, hits: number, zoneId = '') => ({ id, dst_key: key, dst_zone_id: zoneId, hits })
  it('groups an outbound flow by its destination key, the addresses outside any zone last', () => {
    const groups = groupByDestination([out('1', '203.0.113.10', 900), out('2', 'zd', 5, 'zd'), out('3', 'zd', 6, 'zd'), out('4', '203.0.113.10', 1)], (key, r) => (r.dst_zone_id ? nameOf(key) : key))
    expect(groups.map(g => [g.key, g.name, g.hits])).toEqual([['zd', 'db', 11], ['203.0.113.10', '203.0.113.10', 901]])
  })
  it('falls back on the destination zone for a flow of the first lot, which has no key', () => {
    const groups = groupByDestination([row('1', 'zw', 1), row('2', 'zw', 2)], nameOf)
    expect(groups.map(g => g.key)).toEqual(['zw'])
  })
})

describe('destinationLabel', () => {
  const zoneName = (id: string) => (id === 'zd' ? 'db' : 'Deleted zone')
  const guestName = (ip: string) => (ip === '10.0.0.7' ? 'legacy-vm' : undefined)
  const base = { dst_key: '', dst_ip: '', dst_zone_id: '' }
  it('names the zone first, then the guest that carries the address, then the address', () => {
    expect(destinationLabel({ ...base, dst_zone_id: 'zd', dst_ip: '10.0.0.9' }, zoneName, guestName)).toBe('db')
    expect(destinationLabel({ ...base, dst_key: '10.0.0.7', dst_ip: '10.0.0.7' }, zoneName, guestName)).toBe('legacy-vm')
    expect(destinationLabel({ ...base, dst_key: '203.0.113.10', dst_ip: '203.0.113.10' }, zoneName, guestName)).toBe('203.0.113.10')
  })
  it('says many destinations for the aggregate, whatever address it carries', () => {
    expect(destinationLabel({ ...base, dst_key: '0.0.0.0/0', dst_ip: '198.51.100.1' }, zoneName, guestName)).toBe('Many destinations')
    expect(destinationLabel({ ...base, dst_key: '::/0' }, zoneName, guestName, 'Nombreuses destinations')).toBe('Nombreuses destinations')
  })
})

describe('prefix lengths', () => {
  it('bounds an IPv4 address at /8../32 proposing /24 and an IPv6 one at /16../128 proposing /64', () => {
    expect(prefixBounds('203.0.113.10')).toEqual({ min: 8, max: 32, def: 24 })
    expect(prefixBounds('2001:db8::1')).toEqual({ min: 16, max: 128, def: 64 })
  })
  it('previews the network the prefix makes', () => {
    expect(cidrPreview('203.0.113.10', 24)).toBe('203.0.113.0/24')
    expect(cidrPreview('203.0.113.10', 8)).toBe('203.0.0.0/8')
    expect(cidrPreview('203.0.113.10', 32)).toBe('203.0.113.10/32')
    expect(cidrPreview('2001:db8:abcd:12::1', 64)).toBe('2001:db8:abcd:12::/64')
    expect(cidrPreview('2001:db8::1', 128)).toBe('2001:db8::1/128')
  })
})
