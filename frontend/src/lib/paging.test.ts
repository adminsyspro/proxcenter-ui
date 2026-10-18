import { describe, expect, it } from 'vitest'

import { pageOf } from './paging'

describe('pageOf', () => {
  it('pages the list and clamps a page past the end', () => {
    const items = Array.from({ length: 25 }, (_, i) => i)
    expect(pageOf(items, 1, 10)).toEqual({ rows: [10, 11, 12, 13, 14, 15, 16, 17, 18, 19], page: 1 })
    expect(pageOf(items, 9, 10)).toEqual({ rows: [20, 21, 22, 23, 24], page: 2 })
    expect(pageOf([], 3, 10)).toEqual({ rows: [], page: 0 })
  })
})
