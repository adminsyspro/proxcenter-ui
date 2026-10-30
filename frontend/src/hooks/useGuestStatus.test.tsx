import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

const { swrMock } = vi.hoisted(() => ({ swrMock: vi.fn() }))

vi.mock('./useSWRFetch', () => ({ useSWRFetch: (...args: unknown[]) => swrMock(...args) }))
vi.mock('./useRefreshInterval', () => ({ useRefreshInterval: () => 60000 }))

import { useGuestStatus } from './useGuestStatus'

describe('useGuestStatus', () => {
  it('keys each visible guest status by connection and VMID', () => {
    swrMock.mockReturnValue({
      data: { data: { vms: [
        { connId: 'c1', vmid: 100, status: 'running' },
        { connId: 'c1', vmid: '101', status: 'stopped' },
        { connId: 'c2', vmid: 100 },
        { vmid: 102, status: 'running' }
      ] } }
    })

    const { result } = renderHook(() => useGuestStatus())

    expect(result.current).toEqual({ 'c1:100': 'running', 'c1:101': 'stopped' })
    expect(swrMock).toHaveBeenCalledWith('/api/v1/vms', { refreshInterval: 60000 })
  })

  it('is empty before the first answer', () => {
    swrMock.mockReturnValue({ data: undefined })

    const { result } = renderHook(() => useGuestStatus())

    expect(result.current).toEqual({})
  })
})
