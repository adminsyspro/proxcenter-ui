import { afterEach, describe, expect, it, vi } from 'vitest'

import { createReadingCache } from './readingCache'

type Reading = { text: string; aiFailed?: boolean }

const options = { ttlMs: 1000, fallbackTtlMs: 100, maxEntries: 2 }

afterEach(() => {
  vi.useRealTimers()
})

describe('createReadingCache', () => {
  it('serves a fresh reading without computing again, and recomputes on refresh', async () => {
    const cache = createReadingCache<Reading>(options)
    const compute = vi.fn(async () => ({ text: 'a' }))

    await cache.get('k', 'ollama:m', false, compute)
    await cache.get('k', 'ollama:m', false, compute)
    expect(compute).toHaveBeenCalledTimes(1)

    await cache.get('k', 'ollama:m', true, compute)
    expect(compute).toHaveBeenCalledTimes(2)
    expect(cache.peek('k')).toEqual({ text: 'a' })
  })

  it('does not reuse a reading made with another provider or model', async () => {
    const cache = createReadingCache<Reading>(options)
    const compute = vi.fn(async () => ({ text: 'a' }))

    await cache.get('k', 'ollama:m', false, compute)
    await cache.get('k', 'openai:gpt', false, compute)
    expect(compute).toHaveBeenCalledTimes(2)
  })

  it('shares the call in flight between concurrent requests', async () => {
    const cache = createReadingCache<Reading>(options)
    let release: (value: Reading) => void = () => {}
    const compute = vi.fn(() => new Promise<Reading>(resolve => { release = resolve }))

    const first = cache.get('k', 't', false, compute)
    const second = cache.get('k', 't', false, compute)
    release({ text: 'shared' })

    expect(await first).toEqual({ text: 'shared' })
    expect(await second).toEqual({ text: 'shared' })
    expect(compute).toHaveBeenCalledTimes(1)
  })

  it('keeps a rule fallback after a model failure for a short time only, and no null', async () => {
    vi.useFakeTimers()
    const cache = createReadingCache<Reading>(options)

    await cache.get('failed', 't', false, async () => ({ text: 'rules', aiFailed: true }))
    await cache.get('missing', 't', false, async () => null)
    expect(cache.peek('failed')).not.toBeNull()
    expect(cache.peek('missing')).toBeNull()

    vi.advanceTimersByTime(150)
    expect(cache.peek('failed')).toBeNull()
  })

  it('drops the oldest entry past its size', async () => {
    const cache = createReadingCache<Reading>(options)

    for (const key of ['a', 'b', 'c']) await cache.get(key, 't', false, async () => ({ text: key }))

    expect(cache.peek('a')).toBeNull()
    expect(cache.peek('c')).toEqual({ text: 'c' })
  })
})
