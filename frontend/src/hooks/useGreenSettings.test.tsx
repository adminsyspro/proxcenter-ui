import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

import { useGreenSettings } from './useGreenSettings'

beforeEach(() => {
  vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ data: { pue: 1.6, currency: 'USD' } }) } as any)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useGreenSettings', () => {
  it('loads the saved settings on mount over the defaults', async () => {
    const { result } = renderHook(() => useGreenSettings())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(global.fetch).toHaveBeenCalledWith('/api/v1/settings/green')
    expect(result.current.settings.pue).toBe(1.6)
    expect(result.current.settings.currency).toBe('USD')
    expect(result.current.settings.co2Country).toBe('france')
  })
})
