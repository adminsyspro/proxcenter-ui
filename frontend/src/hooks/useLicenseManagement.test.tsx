import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

import { useLicenseManagement } from './useLicenseManagement'

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockImplementation(async (input: any) => {
    if (String(input) === '/api/v1/license/status') {
      return { ok: true, json: async () => ({ licensed: true, edition: 'enterprise' }) } as any
    }

    return { ok: true, json: async () => ({ features: [{ id: 'rolling_updates', enabled: true }] }) } as any
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useLicenseManagement', () => {
  it('loads the license status and the feature list on mount', async () => {
    const { result } = renderHook(() => useLicenseManagement())

    await waitFor(() => {
      expect(result.current.licenseStatus).toEqual({ licensed: true, edition: 'enterprise' })
      expect(result.current.features).toEqual([{ id: 'rolling_updates', enabled: true }])
    })
    expect(result.current.loading).toBe(false)
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/license/status', { cache: 'no-store' })
    expect(global.fetch).toHaveBeenCalledWith('/api/v1/license/features')
  })
})
