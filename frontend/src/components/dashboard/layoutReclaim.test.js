import { describe, it, expect } from 'vitest'
import { mergeIntervals, computeReclaimedRows, yShiftFor } from './layoutReclaim'

describe('mergeIntervals', () => {
  it('merges overlapping and touching intervals', () => {
    expect(mergeIntervals([[4, 8], [0, 2], [2, 3], [6, 10]])).toEqual([[0, 3], [4, 10]])
  })

  it('keeps disjoint intervals apart', () => {
    expect(mergeIntervals([[5, 6], [0, 2]])).toEqual([[0, 2], [5, 6]])
  })

  it('handles an empty list', () => {
    expect(mergeIntervals([])).toEqual([])
  })
})

describe('computeReclaimedRows', () => {
  it('returns nothing when no widget is hidden', () => {
    expect(computeReclaimedRows([{ y: 0, h: 4 }], [])).toEqual([])
  })

  it('frees the rows of a fully hidden band (collapsed section)', () => {
    const visible = [{ y: 0, h: 1 }, { y: 9, h: 4 }]
    const hidden = [{ y: 1, h: 4 }, { y: 5, h: 4 }]

    expect(computeReclaimedRows(visible, hidden)).toEqual([[1, 9]])
  })

  it('does not free rows still occupied by a side-by-side visible widget', () => {
    const visible = [{ y: 4, h: 4 }]
    const hidden = [{ y: 4, h: 4 }]

    expect(computeReclaimedRows(visible, hidden)).toEqual([])
  })

  it('frees only the part of a hidden band no visible widget covers', () => {
    const visible = [{ y: 6, h: 2 }]
    const hidden = [{ y: 4, h: 6 }]

    expect(computeReclaimedRows(visible, hidden)).toEqual([[4, 6], [8, 10]])
  })
})

describe('yShiftFor', () => {
  const freed = [[1, 3], [6, 10]]

  it('does not move widgets above the first freed band', () => {
    expect(yShiftFor(freed, 0)).toBe(0)
    expect(yShiftFor(freed, 1)).toBe(0)
  })

  it('moves a widget up by the freed rows above it', () => {
    expect(yShiftFor(freed, 3)).toBe(2)
    expect(yShiftFor(freed, 6)).toBe(2)
    expect(yShiftFor(freed, 12)).toBe(6)
  })

  it('clamps a widget sitting inside a freed band', () => {
    expect(yShiftFor(freed, 8)).toBe(4)
  })

  it('preserves deliberate empty rows (not part of any freed band)', () => {
    expect(yShiftFor([], 7)).toBe(0)
  })
})
