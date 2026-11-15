/** The grouping of the Observation table, the share bar of the hits and the stored collapsed groups. */

import { describe, expect, it } from 'vitest'

import { decodeCollapsed, encodeCollapsed, groupByDestination, hitsShare, maxHits } from './observationModel'

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
