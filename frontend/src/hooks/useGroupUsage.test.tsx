/**
 * The browser side of the security group usage: one read when the tab is shown, a poll only while the server
 * computes, and the check asked before a deletion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

import { readGroupUsage, useGroupUsage } from './useGroupUsage'

const USAGE = { total: 2, measured: 2, unread: 0, partial: false, computedAt: '2026-11-24T10:00:00.000Z', groups: { web: [{ type: 'qemu', vmid: '100', node: 'pve1', name: 'web-01' }] } }
const answer = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => answer({ ...USAGE, computing: false }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const urls = () => fetchMock.mock.calls.map(c => String(c[0]))

describe('readGroupUsage', () => {
  it('asks again while the server computes, without forcing a second read', async () => {
    fetchMock.mockResolvedValueOnce(answer({ computing: true })).mockResolvedValueOnce(answer({ computing: true }))

    const usage = await readGroupUsage('c 1', { force: true, all: true, pollMs: 1 })

    expect(usage.groups.web).toHaveLength(1)
    expect(urls()).toEqual([
      '/api/v1/firewall/group-usage/c%201?all=1&refresh=1',
      '/api/v1/firewall/group-usage/c%201?all=1',
      '/api/v1/firewall/group-usage/c%201?all=1',
    ])
  })

  it('throws what the server answered', async () => {
    fetchMock.mockResolvedValueOnce(answer({ error: 'no such connection' }, 404))
    await expect(readGroupUsage('c1')).rejects.toThrow('no such connection')

    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 502 }))
    await expect(readGroupUsage('c1')).rejects.toThrow('HTTP 502')
  })
})

describe('useGroupUsage', () => {
  it('reads nothing until the tab is shown, then once each time it is shown', async () => {
    const { result, rerender } = renderHook(({ enabled }) => useGroupUsage('c1', enabled), { initialProps: { enabled: false } })

    expect(fetchMock).not.toHaveBeenCalled()
    rerender({ enabled: true })
    await waitFor(() => expect(result.current.usage?.groups.web).toHaveLength(1))
    expect(urls()).toEqual(['/api/v1/firewall/group-usage/c1'])
    // Coming back to the tab reads again: the server answers from what it keeps unless something wrote meanwhile.
    rerender({ enabled: false })
    rerender({ enabled: true })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.loading).toBe(false))
  })

  it('starts again from nothing on another connection', async () => {
    const { result, rerender } = renderHook(({ id }) => useGroupUsage(id, true), { initialProps: { id: 'c1' as string | null } })
    await waitFor(() => expect(result.current.usage).not.toBeNull())

    rerender({ id: 'c2' })
    expect(result.current.usage).toBeNull()
    await waitFor(() => expect(result.current.usage).not.toBeNull())
    expect(urls()).toEqual(['/api/v1/firewall/group-usage/c1', '/api/v1/firewall/group-usage/c2'])

    rerender({ id: null })
    expect(result.current.usage).toBeNull()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('forces a new read on reload(true), and reads every guest again for the check', async () => {
    const { result } = renderHook(() => useGroupUsage('c1', true))
    await waitFor(() => expect(result.current.usage).not.toBeNull())

    await act(async () => { await result.current.reload(true) })
    let checked: unknown
    await act(async () => { checked = await result.current.check() })

    expect(urls().slice(1)).toEqual(['/api/v1/firewall/group-usage/c1?refresh=1', '/api/v1/firewall/group-usage/c1?all=1&refresh=1'])
    expect(checked).toMatchObject({ unread: 0 })
  })

  it('keeps no usage and says why when the read fails; the check throws', async () => {
    fetchMock.mockImplementation(async () => answer({ error: 'pve down' }, 500))
    const { result } = renderHook(() => useGroupUsage('c1', true))

    await waitFor(() => expect(result.current.error).toBe('pve down'))
    expect(result.current.usage).toBeNull()
    await act(async () => { await expect(result.current.check()).rejects.toThrow('pve down') })
  })

  it('does not let a reload abort the check running, and shows what the check read', async () => {
    const { result } = renderHook(() => useGroupUsage('c1', true))
    await waitFor(() => expect(result.current.usage).not.toBeNull())
    let release: () => void = () => undefined
    fetchMock.mockImplementationOnce(async () => {
      await new Promise<void>(resolve => { release = resolve })

      return answer({ ...USAGE, groups: { gone: [] }, computing: false })
    })

    let checking: Promise<unknown> = Promise.resolve()
    await act(async () => {
      checking = result.current.check()
      await result.current.reload()
    })
    release()
    await act(async () => { await expect(checking).resolves.toMatchObject({ groups: { gone: [] } }) })

    expect(result.current.usage?.groups).toEqual({ gone: [] })
  })

  it('refuses a check without a connection', async () => {
    const { result } = renderHook(() => useGroupUsage(null, true))

    await act(async () => { await expect(result.current.check()).rejects.toThrow() })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
