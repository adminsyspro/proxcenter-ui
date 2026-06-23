import { describe, it, expect } from 'vitest'
import { ALL_CHECK_IDS, runAllChecks } from './hardening'

describe('ALL_CHECK_IDS', () => {
  it('matches the ids runAllChecks actually emits on empty data', () => {
    const emitted = runAllChecks({}).map(c => c.id).sort()
    expect([...ALL_CHECK_IDS].sort()).toEqual(emitted)
  })
})
