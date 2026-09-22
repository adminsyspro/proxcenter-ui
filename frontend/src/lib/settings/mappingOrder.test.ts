import { describe, it, expect } from 'vitest'

import { moveMappingRow } from './mappingOrder'

const rows = [{ group: 'a' }, { group: 'b' }, { group: 'c' }]

describe('moveMappingRow', () => {
  it('swaps a row with the one above it', () => {
    expect(moveMappingRow(rows, 1, -1).map(r => r.group)).toEqual(['b', 'a', 'c'])
  })

  it('swaps a row with the one below it', () => {
    expect(moveMappingRow(rows, 1, 1).map(r => r.group)).toEqual(['a', 'c', 'b'])
  })

  it('moves a row several positions at once', () => {
    expect(moveMappingRow(rows, 2, -2).map(r => r.group)).toEqual(['c', 'a', 'b'])
  })

  it('leaves the list untouched at both ends', () => {
    expect(moveMappingRow(rows, 0, -1)).toBe(rows)
    expect(moveMappingRow(rows, 2, 1)).toBe(rows)
    expect(moveMappingRow(rows, 5, -1)).toBe(rows)
    expect(moveMappingRow(rows, -1, 1)).toBe(rows)
  })

  it('never mutates the array it was given', () => {
    const before = [...rows]
    moveMappingRow(rows, 1, -1)
    expect(rows).toEqual(before)
  })
})
