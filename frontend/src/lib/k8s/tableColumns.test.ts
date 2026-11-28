import { describe, it, expect } from 'vitest'
import { cellValue, formatGiB, sortItems } from './tableColumns'
import type { ResourceListItem } from './types'

const item = (over: Partial<ResourceListItem>): ResourceListItem => ({
  kind: 'pod', name: 'x', uid: 'u', namespace: 'ns', createdAt: '2026-06-29T10:00:00Z', summary: {}, ...over,
})

describe('table columns', () => {
  it('reads name/namespace/createdAt from top-level, others from summary', () => {
    const it1 = item({ name: 'web', summary: { restarts: '3' } })
    expect(cellValue(it1, { key: 'name', header: 'name', type: 'text' })).toBe('web')
    expect(cellValue(it1, { key: 'restarts', header: 'restarts', type: 'number' })).toBe('3')
  })

  it('reads namespace and createdAt from top-level', () => {
    const it1 = item({ namespace: 'production', createdAt: '2026-06-01T00:00:00Z' })
    expect(cellValue(it1, { key: 'namespace', header: 'namespace', type: 'text' })).toBe('production')
    expect(cellValue(it1, { key: 'createdAt', header: 'age', type: 'age' })).toBe('2026-06-01T00:00:00Z')
  })

  it('reads uid and kind from top-level', () => {
    const it1 = item({ uid: 'abc-123', kind: 'deployment' })
    expect(cellValue(it1, { key: 'uid', header: 'uid', type: 'text' })).toBe('abc-123')
    expect(cellValue(it1, { key: 'kind', header: 'kind', type: 'text' })).toBe('deployment')
  })

  it('returns empty string for missing summary key', () => {
    const it1 = item({ summary: {} })
    expect(cellValue(it1, { key: 'phase', header: 'phase', type: 'badge' })).toBe('')
  })

  it('number column sorts numerically, not lexically', () => {
    const items = [item({ name: 'a', summary: { restarts: '10' } }), item({ name: 'b', summary: { restarts: '2' } })]
    const sorted = sortItems(items, { key: 'restarts', header: 'restarts', type: 'number' }, 'asc')
    expect(sorted.map(i => i.summary.restarts)).toEqual(['2', '10'])
  })

  it('number column sorts desc', () => {
    const items = [item({ name: 'a', summary: { restarts: '2' } }), item({ name: 'b', summary: { restarts: '10' } })]
    const sorted = sortItems(items, { key: 'restarts', header: 'restarts', type: 'number' }, 'desc')
    expect(sorted.map(i => i.summary.restarts)).toEqual(['10', '2'])
  })

  it('age column sorts by timestamp', () => {
    const items = [item({ name: 'old', createdAt: '2026-06-01T00:00:00Z' }), item({ name: 'new', createdAt: '2026-06-29T00:00:00Z' })]
    const sorted = sortItems(items, { key: 'createdAt', header: 'age', type: 'age' }, 'desc')
    expect(sorted[0].name).toBe('new')
  })

  it('age column sorts asc: oldest first', () => {
    const items = [item({ name: 'new', createdAt: '2026-06-29T00:00:00Z' }), item({ name: 'old', createdAt: '2026-06-01T00:00:00Z' })]
    const sorted = sortItems(items, { key: 'createdAt', header: 'age', type: 'age' }, 'asc')
    expect(sorted[0].name).toBe('old')
  })

  it('text column sorts by locale', () => {
    const items = [item({ name: 'zebra' }), item({ name: 'apple' }), item({ name: 'mango' })]
    const sorted = sortItems(items, { key: 'name', header: 'name', type: 'text' }, 'asc')
    expect(sorted.map(i => i.name)).toEqual(['apple', 'mango', 'zebra'])
  })

  it('ratio column sorts numerically', () => {
    const items = [
      item({ name: 'a', summary: { ready: '3/10' } }),
      item({ name: 'b', summary: { ready: '1/2' } }),
    ]
    // parseFloat('3/10') = 3, parseFloat('1/2') = 1 → b < a
    const sorted = sortItems(items, { key: 'ready', header: 'ready', type: 'ratio' }, 'asc')
    expect(sorted[0].name).toBe('b')
  })

  it('age column guards against empty/invalid dates (NaN)', () => {
    const items = [
      item({ name: 'never-run-cronjob', summary: { lastSchedule: '' } }),
      item({ name: 'recent', summary: { lastSchedule: '2026-06-29T10:00:00Z' } }),
      item({ name: 'old', summary: { lastSchedule: '2026-06-01T00:00:00Z' } }),
    ]
    const sorted = sortItems(items, { key: 'lastSchedule', header: 'lastSchedule', type: 'age' }, 'asc')
    // Empty string (never-run) should sort to earliest (getTime() || 0 = 0)
    expect(sorted[0].name).toBe('never-run-cronjob')
    // Valid dates sort in chronological order
    expect(sorted[1].name).toBe('old')
    expect(sorted[2].name).toBe('recent')
  })

  it('handles missing values without throwing', () => {
    const items = [item({ name: 'a', summary: {} }), item({ name: 'b', summary: { restarts: '5' } })]
    expect(() => sortItems(items, { key: 'restarts', header: 'restarts', type: 'number' }, 'asc')).not.toThrow()
  })

  it('does not mutate the original array', () => {
    const items = [item({ name: 'b' }), item({ name: 'a' })]
    const copy = [...items]
    sortItems(items, { key: 'name', header: 'name', type: 'text' }, 'asc')
    expect(items[0].name).toBe(copy[0].name)
  })
})

describe('formatGiB', () => {
  it('formats a byte count as GB with one decimal', () => {
    expect(formatGiB(String(4015600 * 1024))).toBe('3.8 GB')
    expect(formatGiB(String(16 * 1024 ** 3))).toBe('16 GB')
  })
  it('is empty without a size', () => {
    expect(formatGiB('')).toBe('')
    expect(formatGiB('0')).toBe('')
  })
})

describe('sorting the node size columns', () => {
  const node = (name: string, cpuSize: string, memSize: string) => ({ name, summary: { cpuSize, memSize } } as unknown as ResourceListItem)
  const nodes = [node('a', '4', String(8 * 1024 ** 3)), node('b', '16', String(2 * 1024 ** 3)), node('c', '2', String(32 * 1024 ** 3))]
  it('sorts the cores and the memory as numbers', () => {
    expect(sortItems(nodes, { key: 'cpuSize', header: 'vcpu', type: 'number' }, 'asc').map(n => n.name)).toEqual(['c', 'a', 'b'])
    expect(sortItems(nodes, { key: 'memSize', header: 'ram', type: 'bytes' }, 'desc').map(n => n.name)).toEqual(['c', 'a', 'b'])
  })
})
