import { describe, expect, it } from 'vitest'

import { toggleBalanceType } from './balanceTypes'

describe('toggleBalanceType', () => {
  it('adds ct when only vm is selected', () => {
    expect(toggleBalanceType(['vm'], 'ct')).toEqual(['vm', 'ct'])
  })

  it('adds vm when only ct is selected', () => {
    expect(toggleBalanceType(['ct'], 'vm')).toEqual(['ct', 'vm'])
  })

  it('removes ct when both are selected', () => {
    expect(toggleBalanceType(['vm', 'ct'], 'ct')).toEqual(['vm'])
  })

  it('removes vm when both are selected', () => {
    expect(toggleBalanceType(['vm', 'ct'], 'vm')).toEqual(['ct'])
  })

  it('ignores the click that would empty the list (only vm) — min 1', () => {
    expect(toggleBalanceType(['vm'], 'vm')).toEqual(['vm'])
  })

  it('ignores the click that would empty the list (only ct) — min 1', () => {
    expect(toggleBalanceType(['ct'], 'ct')).toEqual(['ct'])
  })

  it('does not mutate the input array', () => {
    const input: ('vm' | 'ct')[] = ['vm', 'ct']
    const result = toggleBalanceType(input, 'vm')
    expect(input).toEqual(['vm', 'ct'])
    expect(result).not.toBe(input)
  })
})
