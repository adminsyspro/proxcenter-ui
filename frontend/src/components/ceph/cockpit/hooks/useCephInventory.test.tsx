import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'
import { SWRConfig } from 'swr'
import React from 'react'

import { inventoryBody, jsonRes, swrWrapper } from './testUtils'
import { INVENTORY_FINGERPRINT_MIN_GAP_MS, useCephInventory } from './useCephInventory'

const fetchMock = vi.fn()
let tabVisible = true

// SWR ecoute visibilitychange avec un setTimeout.bind qui recoit l'evenement comme delai (TimeoutNaNWarning) :
// la visibilite est donc pilotee par un mock, sans evenement DOM.
vi.mock('@/hooks/usePageVisibility', () => ({ usePageVisible: () => tabVisible }))
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  tabVisible = true
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => jsonRes(inventoryBody()))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useCephInventory', () => {
  it('a 200 without the inventory shape is an error, never data', async () => {
    fetchMock.mockImplementation(async () => jsonRes({ hasCeph: true, managers: [] }))
    const { result } = renderHook(() => useCephInventory('c1', null), { wrapper: swrWrapper })

    await flush()
    expect(result.current.inventory).toBeNull()
    expect(result.current.error?.name).toBe('CockpitShapeError')
  })

  // R20: PVE hands the OSD id through as it read it, a string ("0") on Ceph 20. The hook turns it
  // into a number once, so every view compares numbers; an id that is not one is dropped.
  it('reads OSD ids as numbers and drops the unreadable ones', async () => {
    const osd = (id: unknown) => ({ id, name: `osd.${String(id)}`, host: 'pve1', up: true, in: true })

    fetchMock.mockImplementation(async () => jsonRes({ ...inventoryBody(), osds: { list: [osd('0'), osd(3), osd('x'), osd(null), osd('-1'), osd(1.5), osd(' 7 ')] } }))
    const { result } = renderHook(() => useCephInventory('c1', null), { wrapper: swrWrapper })

    await flush()
    expect(result.current.inventory?.osds.list.map(o => o.id)).toEqual([0, 3, 7])
  })

  it('inventory reloads when fingerprint changes, not on first render', async () => {
    const { result, rerender } = renderHook(({ fp }) => useCephInventory('c1', fp), { wrapper: swrWrapper, initialProps: { fp: null as string | null } })

    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.inventory).toEqual(inventoryBody())

    rerender({ fp: 'a' })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender({ fp: 'a' })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender({ fp: 'b' })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('exports a 20s minimum gap', () => {
    expect(INVENTORY_FINGERPRINT_MIN_GAP_MS).toBe(20_000)
  })

  it('bounds fingerprint reloads: fingerprint changing every 5s for 60s gives at most 3 reloads', async () => {
    const { rerender } = renderHook(({ fp }) => useCephInventory('c1', fp), { wrapper: swrWrapper, initialProps: { fp: 'f0' as string | null } })

    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (let i = 1; i <= 12; i++) {
      await flush(5000)
      rerender({ fp: `f${i}` })
    }
    await flush(0)
    // 60 s < 120 s : aucun sondage periodique, seuls les rechargements dus a l'empreinte comptent
    const reloads = fetchMock.mock.calls.length - 1

    expect(reloads).toBeGreaterThanOrEqual(2)
    expect(reloads).toBeLessThanOrEqual(3)
  })

  it('a change inside the window triggers ONE deferred reload at the end of the window', async () => {
    const { rerender } = renderHook(({ fp }) => useCephInventory('c1', fp), { wrapper: swrWrapper, initialProps: { fp: 'a' as string | null } })

    await flush()
    rerender({ fp: 'b' })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    rerender({ fp: 'c' })
    rerender({ fp: 'd' })
    await flush(19_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await flush(1500)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('makes no call while the tab is hidden and reloads once on resume', async () => {
    const { rerender } = renderHook(() => useCephInventory('c1', null), { wrapper: swrWrapper })

    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    tabVisible = false
    rerender()
    await flush(10 * 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    tabVisible = true
    rerender()
    await flush(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('inventory polls every 120s', async () => {
    renderHook(() => useCephInventory('c1', null), { wrapper: swrWrapper })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await flush(119_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await flush(2000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports absent on 404 without error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ hasCeph: false }) })
    const { result } = renderHook(() => useCephInventory('c1', null), { wrapper: swrWrapper })

    await flush()
    expect(result.current.absent).toBe(true)
    expect(result.current.error).toBeNull()
    expect(result.current.inventory).toBeNull()
  })

  it('keeps data and flags stale on a later error', async () => {
    const { result } = renderHook(() => useCephInventory('c1', null), { wrapper: swrWrapper })

    await flush()
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    await act(async () => { result.current.reload(); await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.stale).toBe(true)
    expect(result.current.inventory).toEqual(inventoryBody())
  })

  it('fingerprint change then tab hidden before the deadline: 0 call while hidden, exactly 1 on resume', async () => {
    const { rerender } = renderHook(({ fp }) => useCephInventory('c1', fp), { wrapper: swrWrapper, initialProps: { fp: 'a' as string | null } })

    await flush()
    rerender({ fp: 'b' })
    await flush()
    expect(fetchMock).toHaveBeenCalledTimes(2)

    rerender({ fp: 'c' })
    tabVisible = false
    rerender({ fp: 'c' })
    await flush(10 * 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    tabVisible = true
    rerender({ fp: 'c' })
    await flush(30_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('fingerprint change while hidden: no call until resume', async () => {
    const { rerender } = renderHook(({ fp }) => useCephInventory('c1', fp), { wrapper: swrWrapper, initialProps: { fp: 'a' as string | null } })

    await flush()
    tabVisible = false
    rerender({ fp: 'b' })
    await flush(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    tabVisible = true
    rerender({ fp: 'b' })
    await flush(60_000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('resume before the deadline replaces the deferred reload: exactly 1 reload until t+60s', async () => {
    const { rerender } = renderHook(({ fp }) => useCephInventory('c1', fp), { wrapper: swrWrapper, initialProps: { fp: 'a' as string | null } })

    await flush()
    rerender({ fp: 'b' })
    await flush()
    rerender({ fp: 'c' })
    expect(fetchMock).toHaveBeenCalledTimes(2)

    tabVisible = false
    rerender({ fp: 'c' })
    await flush(10_000)
    tabVisible = true
    rerender({ fp: 'c' })
    await flush(0)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    await flush(50_000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  // C1: another screen (site-recovery) caches the raw `{data}` body under the plain URL in the global SWR cache.
  it('never renders a raw {data} value cached by another screen under the plain URL', async () => {
    const cache = new Map<string, unknown>()

    cache.set('/api/v1/connections/c1/ceph', { data: { data: inventoryBody() }, isValidating: false })
    const wrapper = ({ children }: { children: React.ReactNode }) => <SWRConfig value={{ provider: () => cache as never }}>{children}</SWRConfig>
    const { result } = renderHook(() => useCephInventory('c1', null), { wrapper })

    expect(result.current.inventory).toBeNull()
    await flush()
    expect(result.current.inventory?.osds.list).toEqual([])
  })
})
