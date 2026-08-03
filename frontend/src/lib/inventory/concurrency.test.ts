import { describe, expect, it } from 'vitest'

import { mapWithConcurrency, PVEPROXY_CONCURRENCY } from './concurrency'

describe('mapWithConcurrency', () => {
  it('caps parallelism at the given limit and preserves order', async () => {
    let inFlight = 0
    let peak = 0
    const items = Array.from({ length: 50 }, (_, i) => i)
    const out = await mapWithConcurrency(items, 16, async (item) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight--
      return item * 2
    })
    expect(peak).toBeLessThanOrEqual(16)
    expect(out).toEqual(items.map(i => i * 2))
  })

  it('handles an empty list and a limit larger than the list', async () => {
    expect(await mapWithConcurrency([], 16, async () => 1)).toEqual([])
    expect(await mapWithConcurrency([1, 2], 99, async (n) => n + 1)).toEqual([2, 3])
  })

  it('rejects when a worker throws', async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error('boom')
        return n
      }),
    ).rejects.toThrow('boom')
  })

  it('pins the pveproxy ceiling to 16 (measured, D9)', () => {
    expect(PVEPROXY_CONCURRENCY).toBe(16)
  })
})
