import { describe, it, expect } from 'vitest'
import { resolveSelectedRowIds } from './gridSelection'

const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]

describe('resolveSelectedRowIds', () => {
  it('returns the ids of a manual multi-select', () => {
    const ids = resolveSelectedRowIds({ type: 'include', ids: new Set(['a', 'c']) }, rows)

    expect(ids).toEqual(['a', 'c'])
  })

  it('returns an empty list when nothing is selected', () => {
    expect(resolveSelectedRowIds({ type: 'include', ids: new Set() }, rows)).toEqual([])
  })

  it('expands a "select all" model into every row id', () => {
    const ids = resolveSelectedRowIds({ type: 'exclude', ids: new Set() }, rows)

    expect(ids).toEqual(['a', 'b', 'c'])
  })

  it('excludes the rows unchecked after a "select all"', () => {
    const ids = resolveSelectedRowIds({ type: 'exclude', ids: new Set(['b']) }, rows)

    expect(ids).toEqual(['a', 'c'])
  })

  it('returns an empty list when every row was unchecked after a "select all"', () => {
    const ids = resolveSelectedRowIds({ type: 'exclude', ids: new Set(['a', 'b', 'c']) }, rows)

    expect(ids).toEqual([])
  })

  it('never reports rows filtered out of the grid', () => {
    const visible = [{ id: 'b' }]

    expect(resolveSelectedRowIds({ type: 'exclude', ids: new Set() }, visible)).toEqual(['b'])
  })

  it('handles numeric row ids in an include model', () => {
    expect(resolveSelectedRowIds({ type: 'include', ids: new Set([1, 2]) }, rows)).toEqual(['1', '2'])
  })
})
