import React from 'react'

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

import { RollingUpdateProvider, useRollingUpdates } from './RollingUpdateContext'

const licenseState = { hasFeature: vi.fn(() => true), loading: false }

vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => licenseState,
  Features: { ROLLING_UPDATES: 'rolling_updates' },
}))

vi.mock('@/contexts/RBACContext', () => ({
  useRBAC: () => ({ hasPermission: () => true }),
}))

vi.mock('@/components/RollingUpdateWizard', () => ({ default: () => null }))

const wrapper = ({ children }: { children: React.ReactNode }) => <RollingUpdateProvider>{children}</RollingUpdateProvider>

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  licenseState.loading = false
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({
      data: [
        { id: 'ru-1', connection_id: 'conn-1', status: 'running' },
        { id: 'ru-2', connection_id: 'conn-2', status: 'completed' },
        { id: 'ru-3', connection_id: 'conn-3', status: 'paused' },
      ],
    }),
  } as any)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('RollingUpdateProvider', () => {
  it('checks the orchestrator on mount and keeps only running/paused/pending updates', async () => {
    const { result } = renderHook(() => useRollingUpdates(), { wrapper })

    await waitFor(() => expect(result.current.activeUpdates).toHaveLength(2))
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/orchestrator/rolling-updates')
    expect(result.current.activeUpdates.map(u => u.id)).toEqual(['ru-1', 'ru-3'])
    expect(result.current.hasActiveUpdate('conn-1')).toBe('ru-1')
    expect(result.current.hasActiveUpdate('conn-2')).toBeNull()
  })

  it('does not poll while the license is still loading', () => {
    licenseState.loading = true

    renderHook(() => useRollingUpdates(), { wrapper })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
