import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { resetTaskFailureReasonCache, useTaskFailureReasons } from './useTaskFailureReasons'

const A = { upid: 'UPID:pve1:1:2:3:qmigrate:100:root@pam:', connectionId: 'conn-1', node: 'pve1' }
const B = { upid: 'UPID:pve2:1:2:3:vzmigrate:200:root@pam:', connectionId: 'conn-1', node: 'pve2' }

const REASONS: Record<string, string | null> = {
  [A.upid]: "can't migrate VM which uses local devices: hostpci0",
  [B.upid]: null,
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  resetTaskFailureReasonCache()
  fetchMock = vi.fn(async (url: string) => {
    const upid = decodeURIComponent(url.split('/')[6].split('?')[0])
    return new Response(JSON.stringify({ status: 'stopped', exitstatus: 'migration aborted', failureReason: REASONS[upid] }))
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useTaskFailureReasons (#926)', () => {
  it('reads the reason of each failed task in summary mode', async () => {
    const { result } = renderHook(() => useTaskFailureReasons([A, B]))

    await waitFor(() => expect(result.current[A.upid]).toBe(REASONS[A.upid]))
    expect(result.current[B.upid]).toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`/api/v1/tasks/conn-1/pve1/${encodeURIComponent(A.upid)}?summary=1`)
  })

  it('asks a finished task once per session, even across new arrays and remounts', async () => {
    const first = renderHook(({ rows }) => useTaskFailureReasons(rows), { initialProps: { rows: [A] } })
    await waitFor(() => expect(first.result.current[A.upid]).toBeDefined())

    first.rerender({ rows: [{ ...A }] })
    first.unmount()
    const second = renderHook(() => useTaskFailureReasons([A]))

    expect(second.result.current[A.upid]).toBe(REASONS[A.upid])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks nothing for an empty list', () => {
    const { result } = renderHook(() => useTaskFailureReasons([]))

    expect(result.current).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
