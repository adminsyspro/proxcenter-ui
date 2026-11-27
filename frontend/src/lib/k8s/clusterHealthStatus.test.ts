import { describe, it, expect } from 'vitest'
import { isIntegrating, pollClusterHealthUntilResolved } from './clusterHealthStatus'

describe('isIntegrating', () => {
  it('true when never checked (lastHealthAt null/undefined)', () => {
    expect(isIntegrating({ lastHealthAt: null })).toBe(true)
    expect(isIntegrating({})).toBe(true)
  })
  it('false once checked, whatever the state', () => {
    expect(isIntegrating({ lastHealthAt: '2026-07-04T15:21:14.388Z' })).toBe(false)
  })
})

describe('pollClusterHealthUntilResolved', () => {
  const noDelay = () => Promise.resolve()
  it('resolves immediately when already healthy', async () => {
    const r = await pollClusterHealthUntilResolved('c1', { fetchState: async () => 'healthy', delay: noDelay })
    expect(r).toBe('healthy')
  })
  it('keeps polling through transient unreachable, then resolves on healthy', async () => {
    const seq = ['unreachable', 'unreachable', 'healthy']; let i = 0
    const r = await pollClusterHealthUntilResolved('c1', { fetchState: async () => seq[i++], delay: noDelay })
    expect(r).toBe('healthy'); expect(i).toBe(3)
  })
  it('returns the last-seen state at the timeout ceiling', async () => {
    let t = 0
    const r = await pollClusterHealthUntilResolved('c1', {
      fetchState: async () => 'unreachable', delay: noDelay,
      now: () => { const v = t; t += 100000; return v }, intervalMs: 1, timeoutMs: 180000,
    })
    expect(r).toBe('unreachable')
  })
  it('tolerates a throwing fetch and still ends at the ceiling', async () => {
    let t = 0
    const r = await pollClusterHealthUntilResolved('c1', {
      fetchState: async () => { throw new Error('net') }, delay: noDelay,
      now: () => { const v = t; t += 100000; return v }, timeoutMs: 180000,
    })
    expect(r).toBeNull()
  })
})
