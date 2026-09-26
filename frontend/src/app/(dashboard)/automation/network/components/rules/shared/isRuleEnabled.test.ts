import { describe, expect, it } from 'vitest'

import { isRuleEnabled } from './isRuleEnabled'

describe('isRuleEnabled', () => {
  it('reads only an explicit 1 as enabled', () => {
    expect(isRuleEnabled({ enable: 1 })).toBe(true)
    expect(isRuleEnabled({ enable: 0 })).toBe(false)
  })

  it('reads a rule without enable as disabled, the shape the orchestrator sends for a disabled rule', () => {
    expect(isRuleEnabled({})).toBe(false)
  })
})
