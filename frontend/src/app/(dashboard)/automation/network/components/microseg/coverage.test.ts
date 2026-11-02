import { describe, expect, it } from 'vitest'

import { coverage } from './coverage'
import type { MicrosegStatus } from '@/lib/microseg/types'

const status = (cov: Partial<MicrosegStatus['coverage']> | undefined): MicrosegStatus => ({
  engine: { paused_until: null, held: false, last_runs: {}, last_log: null },
  coverage: cov as MicrosegStatus['coverage'],
  zones_by_state: { disabled: 0, observe: 0, enforce: 0 },
  emergency_stop: false,
})

describe('coverage', () => {
  it('computes coverage: 3 zoned of 5 running, 2 of 3 protected', () => {
    expect(coverage(status({ running: 5, zoned: 3, members: 3, protected: 2 })))
      .toEqual({ running: 5, zoned: 3, members: 3, protected: 2 })
  })

  it('reads zeros before the first full run', () => {
    expect(coverage(status({ running: 0, zoned: 0, members: 0, protected: 0 })))
      .toEqual({ running: 0, zoned: 0, members: 0, protected: 0 })
  })

  it('never reports more zoned than running, nor more protected than members', () => {
    expect(coverage(status({ running: 2, zoned: 4, members: 1, protected: 3 })))
      .toEqual({ running: 2, zoned: 2, members: 1, protected: 1 })
  })

  it('degrades to zeros for a missing or malformed block', () => {
    expect(coverage(status(undefined))).toEqual({ running: 0, zoned: 0, members: 0, protected: 0 })
    expect(coverage(status({ running: -1, zoned: Number.NaN, members: 2, protected: 1 })))
      .toEqual({ running: 0, zoned: 0, members: 2, protected: 1 })
  })
})
