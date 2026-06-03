import { describe, expect, it } from 'vitest'
import {
  putSingleUse,
  takeSingleUse,
  putMultiUse,
  readMultiUse,
} from './session'

describe('console session store', () => {
  it('single-use: first take returns the data, second returns null', () => {
    const id = putSingleUse({ kind: 'vnc', ticket: 't1' })
    expect(takeSingleUse(id)).toMatchObject({ kind: 'vnc', ticket: 't1' })
    expect(takeSingleUse(id)).toBeNull()
  })

  it('single-use: unknown id returns null', () => {
    expect(takeSingleUse('nope')).toBeNull()
  })

  it('single-use: expired entry returns null', () => {
    const realNow = Date.now
    const t0 = realNow()
    Date.now = () => t0
    try {
      const id = putSingleUse({ kind: 'vnc' }, 30_000)
      Date.now = () => t0 + 60_000
      expect(takeSingleUse(id)).toBeNull()
    } finally {
      Date.now = realNow
    }
  })

  it('multi-use: readable more than once within TTL, then expires', () => {
    const realNow = Date.now
    const t0 = realNow()
    Date.now = () => t0
    try {
      const id = putMultiUse({ kind: 'spice', proxyticket: 'pt' }, 30_000)
      expect(readMultiUse(id)).toMatchObject({ kind: 'spice' })
      expect(readMultiUse(id)).toMatchObject({ kind: 'spice' }) // not deleted
      Date.now = () => t0 + 60_000
      expect(readMultiUse(id)).toBeNull()
    } finally {
      Date.now = realNow
    }
  })
})
