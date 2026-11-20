import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { collectMock, settingsMock } = vi.hoisted(() => ({ collectMock: vi.fn(), settingsMock: vi.fn() }))

vi.mock('@/lib/compliance/collectHardeningData', () => ({ collectHardeningData: collectMock }))
vi.mock('@/lib/compliance/collectionSettingsStore', () => ({ getCollectionSettings: settingsMock }))

import { collectionKey, getHardeningData, MAX_CACHED_COLLECTIONS, resetCollectionCache } from './collectionCache'

const BASE = { tenantId: 't1', connectionId: 'c1', conn: { id: 'c1' }, sshEnabled: true }

/** A collection that ends when the test says so. */
function deferred() {
  let resolve: (v: any) => void = () => {}
  let reject: (e: any) => void = () => {}
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

beforeEach(() => {
  resetCollectionCache()
  vi.clearAllMocks()
  settingsMock.mockResolvedValue({ cacheMinutes: 5, guestConcurrency: 4 })
  collectMock.mockImplementation(async () => ({ nodes: [], marker: Math.random() }))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getHardeningData', () => {
  it('collects with the tenant guest concurrency and reports when', async () => {
    settingsMock.mockResolvedValue({ cacheMinutes: 5, guestConcurrency: 2 })

    const r = await getHardeningData({ ...BASE, nodeFilter: 'pve1' })

    expect(collectMock).toHaveBeenCalledWith({ connectionId: 'c1', conn: { id: 'c1' }, nodeFilter: 'pve1', sshEnabled: true, guestConcurrency: 2 })
    expect(r.fromCache).toBe(false)
    expect(r.collectedAt).toBeInstanceOf(Date)
    expect(settingsMock).toHaveBeenCalledWith('t1')
  })

  it('reuses a recent collection, with its original date', async () => {
    const first = await getHardeningData(BASE)
    const second = await getHardeningData(BASE)

    expect(collectMock).toHaveBeenCalledTimes(1)
    expect(second.fromCache).toBe(true)
    expect(second.data).toBe(first.data)
    expect(second.collectedAt.getTime()).toBe(first.collectedAt.getTime())
  })

  it('makes a second request wait for the collection in flight instead of starting another', async () => {
    const d = deferred()
    collectMock.mockReturnValueOnce(d.promise)

    const a = getHardeningData(BASE)
    const b = getHardeningData(BASE)
    // Even the scan button joins a collection in flight: it is fresh by definition.
    const c = getHardeningData({ ...BASE, forceRefresh: true })
    await vi.waitFor(() => expect(collectMock).toHaveBeenCalledTimes(1))
    d.resolve({ nodes: ['x'] })

    const results = await Promise.all([a, b, c])
    expect(collectMock).toHaveBeenCalledTimes(1)
    expect(results.map(r => r.data)).toEqual([{ nodes: ['x'] }, { nodes: ['x'] }, { nodes: ['x'] }])
  })

  it('collects afresh when the scan button forces it', async () => {
    await getHardeningData(BASE)
    const fresh = await getHardeningData({ ...BASE, forceRefresh: true })

    expect(collectMock).toHaveBeenCalledTimes(2)
    expect(fresh.fromCache).toBe(false)
    // ...and the fresh result replaces the cached one.
    expect((await getHardeningData(BASE)).data).toBe(fresh.data)
    expect(collectMock).toHaveBeenCalledTimes(2)
  })

  it('collects again once the cache duration has passed', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'))
    await getHardeningData(BASE)

    vi.setSystemTime(new Date('2026-11-20T10:04:59Z'))
    await getHardeningData(BASE)
    expect(collectMock).toHaveBeenCalledTimes(1)

    vi.setSystemTime(new Date('2026-11-20T10:05:01Z'))
    await getHardeningData(BASE)
    expect(collectMock).toHaveBeenCalledTimes(2)
  })

  it('applies a shorter duration to what is already cached', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'))
    await getHardeningData(BASE)

    vi.setSystemTime(new Date('2026-11-20T10:01:30Z'))
    settingsMock.mockResolvedValue({ cacheMinutes: 1, guestConcurrency: 4 })
    await getHardeningData(BASE)
    expect(collectMock).toHaveBeenCalledTimes(2)

    settingsMock.mockResolvedValue({ cacheMinutes: 0, guestConcurrency: 4 })
    await getHardeningData(BASE)
    expect(collectMock).toHaveBeenCalledTimes(3)
  })

  it('drops entries older than the longest duration a tenant can set', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-20T10:00:00Z'))
    settingsMock.mockResolvedValue({ cacheMinutes: 30, guestConcurrency: 4 })
    await getHardeningData(BASE)

    vi.setSystemTime(new Date('2026-11-20T10:29:00Z'))
    expect((await getHardeningData(BASE)).fromCache).toBe(true)

    vi.setSystemTime(new Date('2026-11-20T10:31:00Z'))
    expect((await getHardeningData(BASE)).fromCache).toBe(false)
  })

  it('never reuses with a cache duration of 0', async () => {
    settingsMock.mockResolvedValue({ cacheMinutes: 0, guestConcurrency: 4 })

    await getHardeningData(BASE)
    await getHardeningData(BASE)

    expect(collectMock).toHaveBeenCalledTimes(2)
  })

  it('does not cache a failure: the next request collects again', async () => {
    collectMock.mockRejectedValueOnce(new Error('pve down'))

    await expect(getHardeningData(BASE)).rejects.toThrow('pve down')
    const r = await getHardeningData(BASE)

    expect(collectMock).toHaveBeenCalledTimes(2)
    expect(r.fromCache).toBe(false)
  })

  it.each([
    ['another tenant', { tenantId: 't2' }],
    ['another connection', { connectionId: 'c2' }],
    ['another node scope', { nodeFilter: 'pve2' }],
    ['SSH turned off', { sshEnabled: false }],
  ])('never hands a collection to %s', async (_label, other) => {
    await getHardeningData(BASE)
    const r = await getHardeningData({ ...BASE, ...other })

    expect(r.fromCache).toBe(false)
    expect(collectMock).toHaveBeenCalledTimes(2)
  })

  it('keeps at most MAX_CACHED_COLLECTIONS entries, dropping the oldest', async () => {
    for (let i = 0; i <= MAX_CACHED_COLLECTIONS; i++) await getHardeningData({ ...BASE, connectionId: `c${i}` })
    expect(collectMock).toHaveBeenCalledTimes(MAX_CACHED_COLLECTIONS + 1)

    // The newest is still there, the oldest was evicted.
    expect((await getHardeningData({ ...BASE, connectionId: `c${MAX_CACHED_COLLECTIONS}` })).fromCache).toBe(true)
    expect((await getHardeningData({ ...BASE, connectionId: 'c0' })).fromCache).toBe(false)
  })
})

describe('collectionKey', () => {
  it('treats no node filter and an empty one alike', () => {
    expect(collectionKey({ ...BASE, nodeFilter: null })).toBe(collectionKey({ ...BASE, nodeFilter: '' }))
    expect(collectionKey({ ...BASE, nodeFilter: undefined })).toBe(collectionKey({ ...BASE, nodeFilter: null }))
  })
})
