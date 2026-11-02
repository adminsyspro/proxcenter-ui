import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

import { formatItem, parseItem, useCockpitUrlState } from './useCockpitUrlState'

const push = vi.fn()
const replace = vi.fn()
let search = ''
let license = { enterprise: true, resolved: true }

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
  usePathname: () => '/storage/ceph',
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('./useCockpitLicense', () => ({ useCockpitLicense: () => license }))

beforeEach(() => {
  push.mockReset()
  replace.mockReset()
  search = ''
  license = { enterprise: true, resolved: true }
})

afterEach(cleanup)

describe('useCockpitUrlState', () => {
  it('invalid url params fall back to defaults', () => {
    search = 'tab=nope&filter=zzz&range=9y&item=bogus'
    const { result } = renderHook(() => useCockpitUrlState())

    expect(result.current).toMatchObject({ conn: null, tab: 'overview', filter: 'all', range: 'live', item: null })
  })

  it('reads valid params', () => {
    search = 'conn=c1&tab=osd&filter=down&range=7d&item=osd.12'
    const { result } = renderHook(() => useCockpitUrlState())

    expect(result.current).toMatchObject({ conn: 'c1', tab: 'osd', filter: 'down', range: '7d', item: { kind: 'osd', id: 12 } })
  })

  it('tab change pushes history entry', () => {
    search = 'conn=c1'
    const { result } = renderHook(() => useCockpitUrlState())

    result.current.set({ tab: 'pools' })
    expect(push).toHaveBeenCalledWith('/storage/ceph?conn=c1&tab=pools')
    expect(replace).not.toHaveBeenCalled()
  })

  it('cluster change pushes, other changes replace', () => {
    const { result } = renderHook(() => useCockpitUrlState())

    result.current.set({ conn: 'c2' })
    expect(push).toHaveBeenCalledWith('/storage/ceph?conn=c2')
    result.current.set({ filter: 'out', item: { kind: 'pool', name: 'rbd' } })
    expect(replace).toHaveBeenCalledWith('/storage/ceph?conn=c2&item=pool%3Arbd&filter=out')
    result.current.set({ item: null })
    expect(replace).toHaveBeenLastCalledWith('/storage/ceph?conn=c2&filter=out')
  })

  it('coerces range to live when not enterprise', () => {
    search = 'conn=c1&range=7d'
    license = { enterprise: false, resolved: true }
    renderHook(() => useCockpitUrlState())

    expect(replace).toHaveBeenCalledWith('/storage/ceph?conn=c1&range=live')
  })

  it('keeps the range while the license is unresolved or Enterprise', () => {
    search = 'range=7d'
    license = { enterprise: false, resolved: false }
    renderHook(() => useCockpitUrlState())
    license = { enterprise: true, resolved: true }
    renderHook(() => useCockpitUrlState())

    expect(replace).not.toHaveBeenCalled()
  })

  it('formats and parses items', () => {
    for (const raw of ['osd.3', 'pool:rbd', 'svc:mds.a']) expect(formatItem(parseItem(raw)!)).toBe(raw)
    expect(parseItem('osd.x')).toBeNull()
    expect(parseItem('pool:')).toBeNull()
  })

  it('switching cluster clears item and filter of the previous one', () => {
    search = 'conn=c1&tab=osd&filter=down&item=osd.3'
    const { result } = renderHook(() => useCockpitUrlState())

    result.current.set({ conn: 'c2' })
    expect(push).toHaveBeenCalledWith('/storage/ceph?conn=c2&tab=osd')
  })

  it('builds the next URL from the query of the latest render, and chains two calls before the router answers', () => {
    search = 'conn=c1'
    const { result, rerender } = renderHook(() => useCockpitUrlState())

    search = 'conn=c1&tab=osd'
    rerender()
    result.current.set({ filter: 'down' })
    result.current.set({ range: '7d' })
    expect(replace).toHaveBeenNthCalledWith(1, '/storage/ceph?conn=c1&tab=osd&filter=down')
    expect(replace).toHaveBeenNthCalledWith(2, '/storage/ceph?conn=c1&tab=osd&filter=down&range=7d')
  })

  it('after an abandoned navigation (same search on the next render), the next set starts again from the real URL', () => {
    search = 'conn=c1&tab=osd'
    const { result, rerender } = renderHook(() => useCockpitUrlState())

    result.current.set({ filter: 'down' })
    expect(replace).toHaveBeenNthCalledWith(1, '/storage/ceph?conn=c1&tab=osd&filter=down')
    rerender()
    result.current.set({ range: '7d' })
    expect(replace).toHaveBeenNthCalledWith(2, '/storage/ceph?conn=c1&tab=osd&range=7d')
  })

  it('re-selecting the same cluster keeps item and filter', () => {
    search = 'conn=c1&filter=down&item=osd.3'
    const { result } = renderHook(() => useCockpitUrlState())

    result.current.set({ conn: 'c1' })
    expect(push).toHaveBeenCalledWith('/storage/ceph?conn=c1&filter=down&item=osd.3')
  })

  it('carries the problem hosts view in hosts=problem', () => {
    search = 'conn=c1&hosts=problem'
    const { result } = renderHook(() => useCockpitUrlState())

    expect(result.current.hosts).toBe('problem')
    result.current.set({ hosts: 'all' })
    expect(replace).toHaveBeenCalledWith('/storage/ceph?conn=c1')
    result.current.set({ hosts: 'problem' })
    expect(replace).toHaveBeenLastCalledWith('/storage/ceph?conn=c1&hosts=problem')
  })

  it('an unknown hosts value falls back to all', () => {
    search = 'hosts=zzz'
    expect(renderHook(() => useCockpitUrlState()).result.current.hosts).toBe('all')
  })

  it('carries the host map view in map=compact|dense and ignores any other value', () => {
    search = 'conn=c1&map=dense'
    expect(renderHook(() => useCockpitUrlState()).result.current.map).toBe('dense')
    search = 'conn=c1&map=compact'
    expect(renderHook(() => useCockpitUrlState()).result.current.map).toBe('compact')
    search = 'conn=c1&map=zzz'
    expect(renderHook(() => useCockpitUrlState()).result.current.map).toBeNull()
    search = ''
    expect(renderHook(() => useCockpitUrlState()).result.current.map).toBeNull()
  })

  it('writes the map view with replace, and clears it when null', () => {
    search = 'conn=c1&tab=overview'
    const { result } = renderHook(() => useCockpitUrlState())

    result.current.set({ map: 'dense' })
    expect(replace).toHaveBeenLastCalledWith('/storage/ceph?conn=c1&tab=overview&map=dense')
    search = 'conn=c1&tab=overview&map=dense'
    const again = renderHook(() => useCockpitUrlState()).result
    again.current.set({ map: null })
    expect(replace).toHaveBeenLastCalledWith('/storage/ceph?conn=c1&tab=overview')
    expect(push).not.toHaveBeenCalled()
  })

  it('changing cluster clears the map view like item, filter and hosts', () => {
    search = 'conn=c1&tab=overview&map=dense&hosts=problem&filter=down'
    const { result } = renderHook(() => useCockpitUrlState())

    result.current.set({ conn: 'c2' })
    expect(push).toHaveBeenLastCalledWith('/storage/ceph?conn=c2&tab=overview')
  })
})
