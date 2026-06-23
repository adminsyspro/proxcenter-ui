import { describe, it, expect } from 'vitest'
import { FRAMEWORK_IDS } from './types'

describe('framework types', () => {
  it('lists all registered framework ids', () => {
    expect(FRAMEWORK_IDS).toEqual(['nist-800-53-r5', 'nist-800-171-r2', 'cmmc-l2', 'iso-27001-2022'])
  })
})
