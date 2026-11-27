import { test, expect } from 'vitest'
import { packBoxes } from './packBoxes'

test('packs left to right and wraps when row exceeds maxRowWidth', () => {
  const out = packBoxes(
    [
      { id: 'g1', width: 300, height: 100 },
      { id: 'g2', width: 300, height: 100 },
      { id: 'g3', width: 300, height: 100 },
    ],
    { maxRowWidth: 700, gap: 20 },
  )
  const by = Object.fromEntries(out.map(b => [b.id, b]))
  expect(by.g1).toEqual({ id: 'g1', x: 0, y: 0 })
  expect(by.g2.x).toBeGreaterThan(by.g1.x)     // same row
  expect(by.g2.y).toBe(0)
  expect(by.g3.x).toBe(0)                        // wrapped to next row
  expect(by.g3.y).toBeGreaterThan(0)
})

test('empty input returns empty', () => {
  expect(packBoxes([])).toEqual([])
})
