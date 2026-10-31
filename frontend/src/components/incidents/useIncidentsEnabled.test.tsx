import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useIncidentsEnabled } from './useIncidentsEnabled'

const { tenantMock, licenseMock } = vi.hoisted(() => ({ tenantMock: vi.fn(), licenseMock: vi.fn() }))

vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenantMock() }))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => licenseMock() }))

const setup = (tenantId: string | null, loading: boolean, licensed: boolean) => {
  tenantMock.mockReturnValue({ currentTenant: tenantId ? { id: tenantId } : null, loading })
  licenseMock.mockReturnValue({ hasFeature: (id: string) => licensed && id === 'incidents' })
}

beforeEach(() => {
  tenantMock.mockReset()
  licenseMock.mockReset()
})

describe('useIncidentsEnabled', () => {
  it('is false for another tenant', () => {
    setup('acme', false, true)

    expect(renderHook(() => useIncidentsEnabled()).result.current).toBe(false)
  })

  it('is false without the feature', () => {
    setup('default', false, false)

    expect(renderHook(() => useIncidentsEnabled()).result.current).toBe(false)
  })

  it('is false while the tenant loads', () => {
    setup('default', true, true)

    expect(renderHook(() => useIncidentsEnabled()).result.current).toBe(false)
  })

  it('is true for the Default tenant with the feature', () => {
    setup('default', false, true)

    expect(renderHook(() => useIncidentsEnabled()).result.current).toBe(true)
  })
})
