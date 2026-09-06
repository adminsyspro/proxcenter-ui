import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// The refresher's default probe reaches the settings table through
// catalogStore; stub both sides so the timer tests stay pure. Tests that care
// about the probe pass their own through options.
vi.mock('./catalogStore', () => ({
  refreshRemoteCatalog: vi.fn(async () => ({ result: 'unchanged', added: [], updated: [], removed: [], error: null })),
  getEffectiveCatalog: vi.fn(async () => ({ images: [], vendors: [], meta: {} })),
}))
vi.mock('./catalogBuilds', () => ({
  refreshCatalogBuilds: vi.fn(async () => ({ checkedAt: '2026-09-06T08:00:00.000Z', builds: {} })),
}))

import {
  startCatalogRefresher,
  CATALOG_REFRESH_INTERVAL_MS,
  CATALOG_REFRESH_INITIAL_DELAY_MS,
} from './catalogRefresher'

const ok = { result: 'unchanged' as const, added: [], updated: [], removed: [], error: null }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('startCatalogRefresher', () => {
  it('runs once after the initial delay, then once per interval', async () => {
    const refresh = vi.fn().mockResolvedValue(ok)
    const stop = startCatalogRefresher({ initialDelayMs: 100, intervalMs: 1000, refresh })
    await vi.advanceTimersByTimeAsync(99)
    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(refresh).toHaveBeenCalledTimes(4)
    stop()
  })

  it('defaults to a 30 s initial delay and a 24 h interval', async () => {
    const refresh = vi.fn().mockResolvedValue(ok)
    const stop = startCatalogRefresher({ refresh })
    expect(CATALOG_REFRESH_INITIAL_DELAY_MS).toBe(30_000)
    expect(CATALOG_REFRESH_INTERVAL_MS).toBe(24 * 60 * 60 * 1000)
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_INITIAL_DELAY_MS - 1)
    expect(refresh).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(CATALOG_REFRESH_INTERVAL_MS)
    expect(refresh).toHaveBeenCalledTimes(2)
    stop()
  })

  it('a rejected refresh does not throw and does not stop the timer', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('db down'))
    const stop = startCatalogRefresher({ initialDelayMs: 0, intervalMs: 1000, refresh })
    await vi.advanceTimersByTimeAsync(2500)
    expect(refresh).toHaveBeenCalledTimes(3)
    stop()
  })

  it('skips a tick while the previous refresh is still in flight', async () => {
    let release!: (v: typeof ok) => void
    const pending = new Promise<typeof ok>(r => { release = r })
    const refresh = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(ok)
    const stop = startCatalogRefresher({ initialDelayMs: 0, intervalMs: 1000, refresh })
    await vi.advanceTimersByTimeAsync(2500)
    expect(refresh).toHaveBeenCalledTimes(1)
    release(ok)
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(2)
    stop()
  })

  it('stop() halts further refreshes, also before the initial delay elapsed, and is idempotent', async () => {
    const refresh = vi.fn().mockResolvedValue(ok)
    const stop = startCatalogRefresher({ initialDelayMs: 500, intervalMs: 1000, refresh })
    stop()
    stop()
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).not.toHaveBeenCalled()
  })

  it('logs an updated catalog and a failed refresh, stays quiet when unchanged', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const refresh = vi.fn()
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({ ...ok, result: 'updated', added: ['ubuntu-2610'] })
      .mockResolvedValueOnce({ ...ok, result: 'error', error: 'HTTP 503' })
    const stop = startCatalogRefresher({ initialDelayMs: 0, intervalMs: 1000, refresh })
    await vi.advanceTimersByTimeAsync(2500)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toMatch(/updated/)
    expect(error).toHaveBeenCalledTimes(1)
    expect(error.mock.calls[0][0]).toMatch(/HTTP 503/)
    stop()
    log.mockRestore()
    error.mockRestore()
  })
})

describe('startCatalogRefresher build probe', () => {
  it('probes the image builds after every refresh, including an unchanged one', async () => {
    const refresh = vi.fn().mockResolvedValue(ok)
    const probeBuilds = vi.fn().mockResolvedValue(undefined)
    const stop = startCatalogRefresher({ initialDelayMs: 0, intervalMs: 1000, refresh, probeBuilds })
    await vi.advanceTimersByTimeAsync(0)
    expect(probeBuilds).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(2000)
    expect(probeBuilds).toHaveBeenCalledTimes(3)
    stop()
  })

  it('still probes when the catalog fetch itself failed', async () => {
    const refresh = vi.fn().mockRejectedValue(new Error('github down'))
    const probeBuilds = vi.fn().mockResolvedValue(undefined)
    const stop = startCatalogRefresher({ initialDelayMs: 0, intervalMs: 1000, refresh, probeBuilds })
    await vi.advanceTimersByTimeAsync(0)
    expect(probeBuilds).toHaveBeenCalledTimes(1)
    stop()
  })

  it('a rejected probe does not throw and does not stop the timer', async () => {
    const refresh = vi.fn().mockResolvedValue(ok)
    const probeBuilds = vi.fn().mockRejectedValue(new Error('mirror down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const stop = startCatalogRefresher({ initialDelayMs: 0, intervalMs: 1000, refresh, probeBuilds })
    await vi.advanceTimersByTimeAsync(2500)
    expect(probeBuilds).toHaveBeenCalledTimes(3)
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
    stop()
  })
})
