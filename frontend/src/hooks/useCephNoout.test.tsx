import React, { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'

import en from '@/messages/en.json'

import { cephNooutUrl, osdNames, useCephNoout } from './useCephNoout'

/*
   ui#1164: the hook every maintenance dialog shares. It reads the node's Ceph
   state when the dialog opens, holds the operator's choice and the
   acknowledgement of an unsafe precheck, and sets or removes the flag.
*/

const toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => toast }))

const wrapper = ({ children }: { children: ReactNode }) => (
  <NextIntlClientProvider locale="en" messages={en as any}>{children}</NextIntlClientProvider>
)

const SAFE = {
  hasCeph: true, crushHost: 'pve3', osds: [{ id: 2, status: 'up', in: true }, { id: 5, status: 'up', in: true }],
  noout: false, globalNoout: false, health: { status: 'HEALTH_OK', checks: [] }, otherHostsWithNoout: [],
  okToStop: { ok: true, osds: [2, 5], numOkPgs: 6, numNotOkPgs: 0, message: null },
}
const UNSAFE = { ...SAFE, okToStop: { ok: false, osds: [2, 5], numOkPgs: 0, numNotOkPgs: 33, message: null } }
const FLAGGED = { ...SAFE, noout: true, okToStop: undefined }

const fetchMock = vi.fn()
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })
const calls = () => fetchMock.mock.calls.map(([url, init]: [string, RequestInit | undefined]) => `${init?.method || 'GET'} ${url}${init?.body ? ` ${init.body}` : ''}`)

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(json({ data: SAFE }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('useCephNoout', () => {
  it('builds the route URL and the OSD names', () => {
    expect(cephNooutUrl('c 1', 'pve3', '?precheck=1')).toBe('/api/v1/connections/c%201/nodes/pve3/ceph/noout?precheck=1')
    expect(osdNames([2, 5])).toBe('osd.2, osd.5')
  })

  it('reads with the precheck when entering, on by default, and sets the flag before the dialog goes on', async () => {
    const { result } = renderHook(() => useCephNoout({ connId: 'c1', node: 'pve3', open: true, mode: 'enter' }), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(calls()).toEqual(['GET /api/v1/connections/c1/nodes/pve3/ceph/noout?precheck=1'])
    expect(result.current).toMatchObject({ available: true, active: true, blocked: false, wanted: true, acknowledged: false, osds: SAFE.osds })

    fetchMock.mockResolvedValueOnce(json({ success: true }))
    await act(() => result.current.setFlag())
    expect(calls().at(-1)).toBe('POST /api/v1/connections/c1/nodes/pve3/ceph/noout {"force":false}')
    expect(result.current.info?.noout).toBe(true)
  })

  it('blocks on an unsafe verdict until acknowledged, then posts force: true', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: UNSAFE }))
    const { result } = renderHook(() => useCephNoout({ connId: 'c1', node: 'pve3', open: true, mode: 'enter' }), { wrapper })
    await waitFor(() => expect(result.current.info).not.toBeNull())
    expect(result.current.blocked).toBe(true)

    act(() => result.current.setAcknowledged(true))
    expect(result.current.blocked).toBe(false)
    fetchMock.mockResolvedValueOnce(json({ success: true }))
    await act(() => result.current.setFlag())
    expect(calls().at(-1)).toBe('POST /api/v1/connections/c1/nodes/pve3/ceph/noout {"force":true}')

    // Unchecking the option lifts the block too: nothing will be set.
    act(() => { result.current.setAcknowledged(false); result.current.setWanted(false) })
    expect(result.current).toMatchObject({ blocked: false, active: false })
  })

  it('setFlag throws with the server message so the dialog stops there', async () => {
    const { result } = renderHook(() => useCephNoout({ connId: 'c1', node: 'pve3', open: true, mode: 'enter' }), { wrapper })
    await waitFor(() => expect(result.current.info).not.toBeNull())
    fetchMock.mockResolvedValueOnce(json({ error: 'Stopping the OSDs of this node would take 33 PG(s) offline', code: 'not_ok_to_stop' }, 409))
    await expect(result.current.setFlag()).rejects.toThrow(/33 PG/)
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('html') } })
    await expect(result.current.setFlag()).rejects.toThrow('HTTP 502')
  })

  it('leaving: available only while the host flag is set, remove reports the 409 and removeAfterExit says so', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: SAFE }))
    const { result, rerender } = renderHook(
      ({ open }) => useCephNoout({ connId: 'c1', node: 'pve3', open, mode: 'exit' }),
      { wrapper, initialProps: { open: true } },
    )
    await waitFor(() => expect(result.current.info).not.toBeNull())
    expect(calls()).toEqual(['GET /api/v1/connections/c1/nodes/pve3/ceph/noout'])
    expect(result.current.available).toBe(false)
    await act(() => result.current.removeAfterExit())
    expect(calls()).toHaveLength(1)

    // Reopened on a flagged node: the option is back on by default.
    rerender({ open: false })
    fetchMock.mockResolvedValueOnce(json({ data: FLAGGED }))
    rerender({ open: true })
    await waitFor(() => expect(result.current.available).toBe(true))
    expect(result.current.active).toBe(true)

    fetchMock.mockResolvedValueOnce(json({ error: 'osd.5 of this node are not up yet: noout kept', code: 'osds_down', osds: [5] }, 409))
    await act(() => result.current.removeAfterExit())
    expect(calls().at(-1)).toBe('DELETE /api/v1/connections/c1/nodes/pve3/ceph/noout')
    expect(toast.warning).toHaveBeenCalledWith('Ceph noout kept: osd.5 is not up yet. Remove it from the node once it is.', 10_000)
    expect(result.current.info?.noout).toBe(true)

    fetchMock.mockResolvedValueOnce(json({ error: 'ssh down' }, 500))
    await act(() => result.current.removeAfterExit())
    expect(toast.error).toHaveBeenCalledWith('Ceph noout could not be removed: ssh down')

    fetchMock.mockResolvedValueOnce(json({ success: true }))
    await act(() => result.current.removeAfterExit())
    expect(toast.success).toHaveBeenCalledWith('Ceph noout removed from pve3')
    expect(result.current.info?.noout).toBe(false)
  })

  it('remove forces through the query string and never throws', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: FLAGGED }))
    const { result } = renderHook(() => useCephNoout({ connId: 'c1', node: 'pve3', open: true, mode: 'exit' }), { wrapper })
    await waitFor(() => expect(result.current.available).toBe(true))

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    expect(await result.current.remove()).toEqual({ ok: false, error: 'offline' })
    fetchMock.mockResolvedValueOnce(json({ success: true }))
    expect(await result.current.remove({ force: true })).toEqual({ ok: true })
    expect(calls().at(-1)).toBe('DELETE /api/v1/connections/c1/nodes/pve3/ceph/noout?force=1')
  })

  it('hides on a payload that is not the route (demo mode), on an HTTP error and on a network error', async () => {
    fetchMock.mockResolvedValueOnce(json({ data: [] }))
    const { result, rerender } = renderHook(
      ({ node }) => useCephNoout({ connId: 'c1', node, open: true, mode: 'enter' }),
      { wrapper, initialProps: { node: 'pve1' } },
    )
    await waitFor(() => expect(result.current.info).toEqual({ hasCeph: false }))
    expect(result.current.available).toBe(false)

    fetchMock.mockResolvedValueOnce(json({ error: 'nope' }, 500))
    rerender({ node: 'pve2' })
    await waitFor(() => expect(calls()).toHaveLength(2))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.available).toBe(false)

    fetchMock.mockRejectedValueOnce(new Error('offline'))
    rerender({ node: 'pve3' })
    await waitFor(() => expect(calls()).toHaveLength(3))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.available).toBe(false)
  })

  it('does not read while closed or without a node, and rereads on refreshKey and refresh()', async () => {
    const { result, rerender } = renderHook(
      ({ open, key }) => useCephNoout({ connId: 'c1', node: 'pve3', open, mode: 'exit', refreshKey: key }),
      { wrapper, initialProps: { open: false, key: 'a' } },
    )
    expect(fetchMock).not.toHaveBeenCalled()
    rerender({ open: true, key: 'a' })
    await waitFor(() => expect(calls()).toHaveLength(1))
    rerender({ open: true, key: 'b' })
    await waitFor(() => expect(calls()).toHaveLength(2))
    await act(() => result.current.refresh())
    expect(calls()).toHaveLength(3)

    const bare = renderHook(() => useCephNoout({ connId: '', node: 'pve3', open: true, mode: 'exit' }), { wrapper })
    await act(() => bare.result.current.refresh())
    expect(calls()).toHaveLength(3)
  })
})
