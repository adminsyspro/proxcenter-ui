import { describe, expect, it } from 'vitest'

import { networkConnKey } from './networkConnKey'

describe('networkConnKey', () => {
  it('changes when a second cluster streams in after the first', () => {
    const first = networkConnKey([{ connId: 'conn-b' }])
    const both = networkConnKey([{ connId: 'conn-b' }, { connId: 'conn-a' }])
    expect(first).toBe('conn-b')
    expect(both).toBe('conn-a,conn-b')
    expect(both).not.toBe(first)
  })

  it('does not depend on the order the clusters arrived in', () => {
    expect(networkConnKey([{ connId: 'conn-a' }, { connId: 'conn-b' }]))
      .toBe(networkConnKey([{ connId: 'conn-b' }, { connId: 'conn-a' }]))
  })

  it('ignores clusters without a connection id', () => {
    expect(networkConnKey([{ connId: '' }, { connId: null }, { connId: 'conn-a' }])).toBe('conn-a')
    expect(networkConnKey([])).toBe('')
  })
})
