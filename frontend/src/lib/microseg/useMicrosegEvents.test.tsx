import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import type { ReactNode } from 'react'

import type { MicrosegEvent, MicrosegEventList } from './types'
import { EVENTS_LIMIT, mergeFresh, useMicrosegEvents } from './useMicrosegEvents'

const ev = (second: number): MicrosegEvent => ({
  seq: second, ts: new Date(Date.UTC(2026, 10, 3, 10, 0, second)).toISOString(), node: 'pve1', vmid: 101, type: 'qemu', guest: 'g', zone: 'web', src_zone: '',
  src_ip: '10.0.0.1', dst_ip: '10.0.0.2', proto: 'tcp', dport: 22, verdict: 'blocked',
})

const list = (seconds: number[], truncated = false): MicrosegEventList => {
  const events = seconds.map(ev)

  return { events, truncated, oldest: events.length ? events[events.length - 1].ts : null }
}

describe('mergeFresh', () => {
  it('takes the page as it is when nothing older was loaded', () => {
    const page = list([30, 20, 10], true)

    expect(mergeFresh(null, 'k', page)).toEqual({ key: 'k', rows: page.events, loadedOlder: false, more: true, truncated: true, epoch: 1 })
    expect(mergeFresh(null, 'k', list([30]))).toMatchObject({ more: false, truncated: false })
    // A full page may have older events behind it even when the orchestrator did not flag it.
    expect(mergeFresh(null, 'k', list(Array.from({ length: EVENTS_LIMIT }, (_, i) => 500 - i)))).toMatchObject({ more: true, truncated: false })
  })

  it('keeps the loaded older pages under a refreshed newest page, without a gap or a duplicate', () => {
    const before = { key: 'k', rows: list([30, 20, 10, 5, 4]).events, loadedOlder: true, more: true, truncated: true, epoch: 3 }
    // 2 new events, the page now stops at 20: 30, 20 are in the new page, 10..4 stay, the new ones are on top.
    const merged = mergeFresh(before, 'k', list([50, 40, 30, 20], true))

    expect(merged.rows.map(e => Date.parse(e.ts) / 1000 % 60)).toEqual([50, 40, 30, 20, 10, 5, 4])
    expect(merged).toMatchObject({ loadedOlder: true, more: true, truncated: true, epoch: 3 })
  })

  it('starts again from the page when the filters changed or the ring is no longer truncated', () => {
    const before = { key: 'k', rows: list([30, 20, 10]).events, loadedOlder: true, more: true, truncated: true, epoch: 3 }

    expect(mergeFresh(before, 'other', list([40, 30], true)).rows).toHaveLength(2)
    expect(mergeFresh(before, 'k', list([40, 30, 20, 10])).loadedOlder).toBe(false)
  })

  it('starts again from the new page when more came in than one page holds: no gap shown as if nothing happened', () => {
    const before = { key: 'k', rows: list([30, 20, 10]).events, loadedOlder: true, more: true, truncated: true, epoch: 3 }
    // The new page stops at 32: 31 was never read.
    const reset = mergeFresh(before, 'k', list([50, 40, 32], true))

    expect(reset.rows.map(e => e.seq)).toEqual([50, 40, 32])
    expect(reset).toMatchObject({ loadedOlder: false, epoch: 4 })
    // Its oldest right above the newest shown: still one list.
    expect(mergeFresh(before, 'k', list([50, 40, 31], true)).rows.map(e => e.seq)).toEqual([50, 40, 31, 30, 20, 10])
  })
})

describe('useMicrosegEvents Load older', () => {
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('drops an older page that comes back after a refresh started the list again', async () => {
    let olderRelease: (body: unknown) => void = () => {}
    const pages = [list([30, 20, 10], true), list([90, 80, 70], true)]
    let read = 0
    const reply = (body: unknown) => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body })
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('before_seq')) return new Promise(resolve => { olderRelease = body => resolve(reply(body)) })
      return reply(pages[Math.min(read++, pages.length - 1)])
    }))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, refreshInterval: 0 }}>{children}</SWRConfig>
    )
    const { result } = renderHook(() => useMicrosegEvents('conn-1', { zone: '', verdict: '', q: '' }), { wrapper })
    await waitFor(() => expect(result.current.events.map(e => e.seq)).toEqual([30, 20, 10]))

    let older: Promise<void> = Promise.resolve()
    act(() => { older = result.current.loadOlder() })
    await act(async () => { await result.current.reload() })
    await waitFor(() => expect(result.current.events.map(e => e.seq)).toEqual([90, 80, 70]))

    await act(async () => {
      olderRelease(list([5, 4], false))
      await older
    })

    expect(result.current.events.map(e => e.seq)).toEqual([90, 80, 70])
  })
})
