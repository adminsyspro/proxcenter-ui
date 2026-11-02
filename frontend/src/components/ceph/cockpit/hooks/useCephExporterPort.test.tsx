import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

import { jsonRes, swrWrapper } from './testUtils'
import { useCephExporterPort } from './useCephExporterPort'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useCephExporterPort', () => {
  it('reads cephExporterPort from the connection', async () => {
    fetchMock.mockResolvedValue(jsonRes({ id: 'c1', cephExporterPort: 9100 }))
    const { result } = renderHook(() => useCephExporterPort('c1', true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current).toBe(9100))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/connections/c1')
  })

  it('9926 by default: not enabled (no call), missing, invalid or unreadable', async () => {
    const off = renderHook(() => useCephExporterPort('c1', false), { wrapper: swrWrapper })

    expect(off.result.current).toBe(9926)
    expect(fetchMock).not.toHaveBeenCalled()

    for (const body of [{ id: 'x' }, { cephExporterPort: 0 }, { cephExporterPort: '9100' }, { cephExporterPort: 70000 }]) {
      fetchMock.mockResolvedValueOnce(jsonRes(body))
      const r = renderHook(() => useCephExporterPort('c-' + JSON.stringify(body), true), { wrapper: swrWrapper })

      await waitFor(() => expect(fetchMock).toHaveBeenCalled())
      expect(r.result.current).toBe(9926)
      fetchMock.mockClear()
    }

    fetchMock.mockResolvedValueOnce(jsonRes({}, 500))
    const e = renderHook(() => useCephExporterPort('c9', true), { wrapper: swrWrapper })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(e.result.current).toBe(9926)
  })
})
