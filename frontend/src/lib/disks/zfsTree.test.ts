import { describe, it, expect } from 'vitest'

import { flattenVdevs } from './zfsTree'

// Shape measured on PVE 9.1: the detail call returns `children`, each entry
// carrying `leaf` and optionally nested `children`.
const TREE = [
  {
    name: 'mirror-0', leaf: 0, state: 'ONLINE', read: 0, write: 0, cksum: 0,
    children: [
      { name: 'sdb', leaf: 1, state: 'ONLINE', read: 0, write: 0, cksum: 0 },
      { name: 'sdc', leaf: 1, state: 'DEGRADED', read: 2, write: 0, cksum: 1 },
    ],
  },
]

describe('flattenVdevs', () => {
  it('returns an empty list for anything that is not an array', () => {
    expect(flattenVdevs(undefined)).toEqual([])
    expect(flattenVdevs(null)).toEqual([])
    expect(flattenVdevs({})).toEqual([])
    expect(flattenVdevs('sdb')).toEqual([])
  })

  it('flattens nested vdevs depth-first with a depth marker', () => {
    const rows = flattenVdevs(TREE)

    expect(rows.map(r => [r.name, r.depth])).toEqual([
      ['mirror-0', 0],
      ['sdb', 1],
      ['sdc', 1],
    ])
  })

  it('marks leaves', () => {
    const rows = flattenVdevs(TREE)

    expect(rows[0].isLeaf).toBe(false)
    expect(rows[1].isLeaf).toBe(true)
  })

  it('carries state and error counters', () => {
    const rows = flattenVdevs(TREE)

    expect(rows[2]).toMatchObject({ name: 'sdc', state: 'DEGRADED', read: 2, write: 0, cksum: 1 })
  })

  it('nulls out missing counters rather than defaulting them to zero', () => {
    const rows = flattenVdevs([{ name: 'sdb', leaf: 1 }])

    expect(rows[0]).toMatchObject({ state: null, read: null, write: null, cksum: null })
  })

  it('handles three levels of nesting', () => {
    const rows = flattenVdevs([
      { name: 'root', leaf: 0, children: [{ name: 'mid', leaf: 0, children: [{ name: 'leaf', leaf: 1 }] }] },
    ])

    expect(rows.map(r => r.depth)).toEqual([0, 1, 2])
  })

  it('skips entries with no usable name', () => {
    const rows = flattenVdevs([{ leaf: 1 }, { name: '', leaf: 1 }, { name: 'sdb', leaf: 1 }])

    expect(rows.map(r => r.name)).toEqual(['sdb'])
  })

  it('treats a missing leaf flag as a non-leaf', () => {
    expect(flattenVdevs([{ name: 'x' }])[0].isLeaf).toBe(false)
  })
})
