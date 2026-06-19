import { describe, it, expect } from 'vitest'
import { evaluateRatchet } from './coverage-ratchet.mjs'

describe('evaluateRatchet', () => {
  it('passes when coverage >= floor', () => {
    expect(evaluateRatchet({ coverage: 7.3, floor: 7.0 }).ok).toBe(true)
  })
  it('passes when coverage equals floor', () => {
    expect(evaluateRatchet({ coverage: 7.0, floor: 7.0 }).ok).toBe(true)
  })
  it('fails when coverage < floor', () => {
    const r = evaluateRatchet({ coverage: 6.9, floor: 7.0 })
    expect(r.ok).toBe(false)
    expect(r.message).toMatch(/below/i)
  })
})
