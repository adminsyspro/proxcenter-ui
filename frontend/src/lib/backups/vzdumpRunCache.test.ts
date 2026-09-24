import { describe, it, expect } from 'vitest'

import { LruCache, getVzdumpRunCaches, resetVzdumpRunCaches } from './vzdumpRunCache'

describe('LruCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new LruCache<number>(2)
    c.set('a', 1)
    c.set('b', 2)
    expect(c.get('a')).toBe(1) // a is now the most recent
    c.set('c', 3)
    expect(c.get('b')).toBeUndefined()
    expect(c.get('a')).toBe(1)
    expect(c.size).toBe(2)
  })
})

describe('getVzdumpRunCaches', () => {
  it('is one instance per process and can be reset', () => {
    const a = getVzdumpRunCaches()
    a.firstLines.set('k', 'v')
    expect(getVzdumpRunCaches().firstLines.get('k')).toBe('v')
    resetVzdumpRunCaches()
    expect(getVzdumpRunCaches().firstLines.get('k')).toBeUndefined()
  })
})
