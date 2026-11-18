import { describe, expect, it } from 'vitest'

import { zone } from './microsegTestKit'
import { candidates, clusterNames, dissociationImpact, entryOf, selectionAfterDissociation, selectorEntries, sharedConnections } from './clusterModel'

const CONNECTIONS = [
  { id: 'c2', name: 'PVE-PROD' },
  { id: 'c1', name: 'PVE-DR' },
  { id: 'c3', name: 'LAB' },
]

describe('clusterNames', () => {
  it('joins the names sorted', () => {
    expect(clusterNames(['c2', 'c1'], CONNECTIONS)).toBe('PVE-DR + PVE-PROD')
  })

  it('keeps two clusters of the same name', () => {
    expect(clusterNames(['a', 'b'], [{ id: 'a', name: 'PVE' }, { id: 'b', name: 'PVE' }])).toBe('PVE + PVE')
  })

  it('leaves out a connection the user cannot see', () => {
    expect(clusterNames(['c1', 'hidden'], CONNECTIONS)).toBe('PVE-DR')
  })
})

describe('candidates', () => {
  it('lists the connections outside the group, by name', () => {
    expect(candidates(CONNECTIONS, ['c2'])).toEqual([{ id: 'c3', name: 'LAB' }, { id: 'c1', name: 'PVE-DR' }])
  })

  it('leaves out the connections that already share another policy', () => {
    expect(candidates(CONNECTIONS, ['c2'], ['c1'])).toEqual([{ id: 'c3', name: 'LAB' }])
  })

  it('is empty when every connection is in the group', () => {
    expect(candidates(CONNECTIONS, ['c1', 'c2', 'c3'])).toEqual([])
  })
})

describe('dissociationImpact', () => {
  const zones = [zone('web', { state: 'enforce' }), zone('db', { state: 'observe' }), zone('old', { state: 'disabled' })]
  const guest = (connectionId: string, ...tags: string[]) => ({ connectionId, tags })

  it('counts the members of active zones on the target and on the others', () => {
    const guests = [
      guest('c1', 'zone-web'), guest('c1', 'Zone-DB'), guest('c1', 'zone-old'), guest('c1'),
      guest('c2', 'zone-web'), guest('c3', 'zone-db', 'zone-web'),
    ]
    expect(dissociationImpact(guests, zones, 'c1', 'zone-')).toEqual({ leaving: 2, staying: 2 })
  })

  it('is zero on both sides without members', () => {
    expect(dissociationImpact([guest('c1', 'other'), guest('c2')], zones, 'c1', 'zone-')).toEqual({ leaving: 0, staying: 0 })
    expect(dissociationImpact([], [], 'c1', 'zone-')).toEqual({ leaving: 0, staying: 0 })
  })
})

describe('selectorEntries', () => {
  it('keeps one entry per connection without groups', () => {
    expect(selectorEntries(CONNECTIONS, {})).toEqual([
      { value: 'c2', label: 'PVE-PROD', ids: ['c2'] },
      { value: 'c1', label: 'PVE-DR', ids: ['c1'] },
      { value: 'c3', label: 'LAB', ids: ['c3'] },
    ])
  })

  it('collapses a group into one entry valued with its anchor, at the place of its first member', () => {
    const entries = selectorEntries(CONNECTIONS, { c2: ['c1', 'c2'], c1: ['c1', 'c2'], c3: ['c3'] })
    expect(entries).toEqual([
      { value: 'c1', label: 'PVE-DR + PVE-PROD', ids: ['c1', 'c2'] },
      { value: 'c3', label: 'LAB', ids: ['c3'] },
    ])
    expect(entryOf(entries, 'c2')?.value).toBe('c1')
  })

  it('leaves a hidden member out of the entry and values it with a visible one', () => {
    expect(selectorEntries(CONNECTIONS, { c3: ['a-hidden', 'c3'] })[2]).toEqual({ value: 'c3', label: 'LAB', ids: ['c3'] })
  })
})

describe('sharedConnections', () => {
  it('lists the connections of every group of two or more, once', () => {
    expect(sharedConnections({ c2: ['c1', 'c2'], c1: ['c1', 'c2'], c3: ['c3'] })).toEqual(['c1', 'c2'])
    expect(sharedConnections({})).toEqual([])
  })
})

describe('selectionAfterDissociation', () => {
  const ALL = [...CONNECTIONS, { id: 'c4', name: 'PVE-X' }]

  it('keeps the selection when another cluster leaves, even the anchor of the group it is not', () => {
    expect(selectionAfterDissociation('c1', 'c3', ['c1', 'c2'], ALL)).toBe('c1')
    expect(selectionAfterDissociation('c2', 'c3', ['c1', 'c2'], ALL)).toBe('c2')
  })

  it('moves to the new anchor of the group when the selected cluster is the one that leaves', () => {
    expect(selectionAfterDissociation('c3', 'c3', ['c1', 'c2'], ALL)).toBe('c1')
    expect(selectionAfterDissociation('c1', 'c1', ['c2', 'c3', 'c4'], ALL)).toBe('c2')
  })

  it('moves to the single cluster left of a group of two', () => {
    expect(selectionAfterDissociation('c2', 'c2', ['c1'], ALL)).toBe('c1')
  })

  it('takes a visible member only, and keeps the selection when none is visible', () => {
    expect(selectionAfterDissociation('c3', 'c3', ['a-hidden', 'c2'], ALL)).toBe('c2')
    expect(selectionAfterDissociation('c3', 'c3', ['a-hidden'], ALL)).toBe('c3')
  })
})
