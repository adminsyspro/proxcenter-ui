import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

import { useConnectionsManagement } from './useConnectionsManagement'

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
    const type = new URL(String(input), 'http://localhost').searchParams.get('type')

    if (type === 'hyperv') {
      return { ok: false, status: 400, text: async () => JSON.stringify({ error: 'Invalid', details: { fieldErrors: { baseUrl: ['required'] } } }) } as any
    }

    return { ok: true, status: 200, text: async () => JSON.stringify({ data: [{ id: `${type}-1`, type }] }) } as any
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useConnectionsManagement', () => {
  it('loads every connection type on mount', async () => {
    const { result } = renderHook(() => useConnectionsManagement())

    await waitFor(() => {
      expect(result.current.pveLoading).toBe(false)
      expect(result.current.pbsLoading).toBe(false)
      expect(result.current.vmwareLoading).toBe(false)
      expect(result.current.xcpngLoading).toBe(false)
      expect(result.current.nutanixLoading).toBe(false)
      expect(result.current.hypervLoading).toBe(false)
    })

    expect(result.current.pveConnections).toEqual([{ id: 'pve-1', type: 'pve' }])
    expect(result.current.pbsConnections).toEqual([{ id: 'pbs-1', type: 'pbs' }])
    expect(result.current.vmwareConnections).toEqual([{ id: 'vmware-1', type: 'vmware' }])
    expect(result.current.xcpngConnections).toEqual([{ id: 'xcpng-1', type: 'xcpng' }])
    expect(result.current.nutanixConnections).toEqual([{ id: 'nutanix-1', type: 'nutanix' }])
    expect(result.current.hypervConnections).toEqual([])
    expect(result.current.hypervError).toBe('Invalid — baseUrl: required')
    expect(global.fetch).toHaveBeenCalledTimes(6)
  })
})
