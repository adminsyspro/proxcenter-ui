import { describe, expect, it } from 'vitest'

import { parseRate } from './preflightModel'

describe('parseRate', () => {
  it('splits the rate PVE writes into a count and a unit', () => {
    expect(parseRate('20/second')).toEqual({ count: 20, unit: 'second' })
    expect(parseRate(' 3 / day ')).toEqual({ count: 3, unit: 'day' })
    expect(parseRate('1/hour')).toEqual({ count: 1, unit: 'hour' })
  })

  it('gives up on anything else', () => {
    expect(parseRate(undefined)).toBeNull()
    expect(parseRate('')).toBeNull()
    expect(parseRate('20/fortnight')).toBeNull()
    expect(parseRate('fast')).toBeNull()
  })
})
