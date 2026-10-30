import { describe, expect, it } from 'vitest'

import { factKey, fieldKey, withKeys } from './keys'

describe('withKeys', () => {
  it('keys each item by its own key and tells repeats apart', () => {
    const keyed = withKeys(['a', 'b', 'a', 'a'], s => s)

    expect(keyed.map(k => k.key)).toEqual(['a', 'b', 'a#1', 'a#2'])
    expect(keyed.map(k => k.item)).toEqual(['a', 'b', 'a', 'a'])
  })

  it('reads a config line by field and values, a fact by kind and label', () => {
    expect(fieldKey({ field: 'memory', oldValue: '2048', newValue: '4096' })).not.toBe(fieldKey({ field: 'memory', oldValue: '4096', newValue: '2048' }))
    expect(factKey({ kind: 'changed', label: { key: 'memory' } })).toBe('changed:{"key":"memory"}')
    expect(factKey({ kind: 'recreated' })).toBe('recreated:null')
  })
})
