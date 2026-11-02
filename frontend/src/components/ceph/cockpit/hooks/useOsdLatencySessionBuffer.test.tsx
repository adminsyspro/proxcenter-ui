import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

import type { CephInventory } from '@/lib/ceph/types'

import { OSD_LATENCY_MAX_POINTS, useOsdLatencySessionBuffer } from './useOsdLatencySessionBuffer'

const osd = (id: number, over: Record<string, unknown> = {}) => ({ id, up: true, commitLatencyMs: 2, applyLatencyMs: 3, ...over })
const inv = (list: ReturnType<typeof osd>[]) => ({ osds: { list } }) as unknown as CephInventory

afterEach(cleanup)

describe('useOsdLatencySessionBuffer', () => {
  it('adds one point per OSD per reading: the larger of commit and apply, none without a latency or when down', () => {
    let p = { inventory: inv([osd(0), osd(1, { commitLatencyMs: undefined, applyLatencyMs: undefined }), osd(2, { up: false })]), at: 100 }
    const { result, rerender } = renderHook(() => useOsdLatencySessionBuffer('c1', p.inventory, p.at, true))

    expect(result.current).toEqual({ 0: [{ time: 100, avg: 3, max: 3 }] })
    p = { inventory: inv([osd(0, { commitLatencyMs: 9 }), osd(1)]), at: 220 }
    rerender()
    expect(result.current[0]).toEqual([{ time: 100, avg: 3, max: 3 }, { time: 220, avg: 9, max: 9 }])
    expect(result.current[1]).toEqual([{ time: 220, avg: 3, max: 3 }])
  })

  it('does not add twice for the same reading', () => {
    const p = { inventory: inv([osd(0)]), at: 100 }
    const { result, rerender } = renderHook(() => useOsdLatencySessionBuffer('c1', p.inventory, p.at, true))

    rerender()
    rerender()
    expect(result.current[0]).toHaveLength(1)
  })

  it('keeps at most 60 points per OSD', () => {
    let at = 1
    const stable = inv([osd(0)])
    const { result, rerender } = renderHook(() => useOsdLatencySessionBuffer('c1', stable, at, true))

    for (at = 2; at <= 75; at++) rerender()
    expect(result.current[0]).toHaveLength(OSD_LATENCY_MAX_POINTS)
    expect(result.current[0][0].time).toBe(16)
  })

  it('accumulates whichever tab is open: it lives in the cockpit, readings keep coming while the OSD tab is unmounted', () => {
    let at = 1
    const stable = inv([osd(0)])
    const { result, rerender } = renderHook(() => useOsdLatencySessionBuffer('c1', stable, at, true))

    at = 2
    rerender()
    at = 3
    rerender()
    expect(result.current[0].map(p => p.time)).toEqual([1, 2, 3])
  })

  it('is emptied when the cluster changes, and refills with the new one', () => {
    let p = { conn: 'c1', inventory: inv([osd(0)]) as CephInventory | null, at: 1 as number | null }
    const { result, rerender } = renderHook(() => useOsdLatencySessionBuffer(p.conn, p.inventory, p.at, true))

    p = { ...p, at: 2 }
    rerender()
    expect(result.current[0]).toHaveLength(2)
    p = { conn: 'c2', inventory: null, at: null }
    rerender()
    expect(result.current).toEqual({})
    p = { conn: 'c2', inventory: inv([osd(0)]), at: 3 }
    rerender()
    expect(result.current[0]).toEqual([{ time: 3, avg: 3, max: 3 }])
  })

  it('disabled (Enterprise, or licence not resolved): nothing accumulated and no render triggered by the buffer', () => {
    let renders = 0
    let at = 1
    const stable = inv([osd(0)])
    const { result, rerender } = renderHook(() => { renders++; return useOsdLatencySessionBuffer('c1', stable, at, false) })

    expect(result.current).toEqual({})
    const before = renders

    for (at = 2; at <= 6; at++) rerender()
    // One render per explicit rerender, none added by a state update of the hook.
    expect(renders - before).toBe(5)
    expect(result.current).toEqual({})
  })

  it('enabling it later starts with the current reading', () => {
    let enabled = false
    let at = 1
    const stable = inv([osd(0)])
    const { result, rerender } = renderHook(() => useOsdLatencySessionBuffer('c1', stable, at, enabled))

    at = 2
    rerender()
    expect(result.current).toEqual({})
    enabled = true
    rerender()
    expect(result.current[0]).toEqual([{ time: 2, avg: 3, max: 3 }])
  })

  it('a reactivation starts again from zero: the old points do not come back with a gap', () => {
    let enabled = true
    let at = 1
    const stable = inv([osd(0)])
    const { result, rerender } = renderHook(() => useOsdLatencySessionBuffer('c1', stable, at, enabled))

    at = 2
    rerender()
    expect(result.current[0].map(p => p.time)).toEqual([1, 2])
    enabled = false
    at = 3
    rerender()
    expect(result.current).toEqual({})
    at = 4
    rerender()
    enabled = true
    at = 5
    rerender()
    expect(result.current[0].map(p => p.time)).toEqual([5])
  })

  it('a reactivation never shows the old points, not even for one render', () => {
    let enabled = true
    let at = 1
    const stable = inv([osd(0)])
    const seen: unknown[] = []
    const { rerender } = renderHook(() => {
      const out = useOsdLatencySessionBuffer('c1', stable, at, enabled)

      seen.push(out)

      return out
    })

    at = 2
    rerender()
    enabled = false
    at = 3
    rerender()
    seen.length = 0
    enabled = true
    at = 4
    rerender()
    expect(seen.length).toBeGreaterThan(0)
    for (const out of seen) expect((out as Record<number, { time: number }[]>)[0]?.map(p => p.time) ?? [4]).toEqual([4])
    expect((seen.at(-1) as Record<number, { time: number }[]>)[0].map(p => p.time)).toEqual([4])
  })
})
