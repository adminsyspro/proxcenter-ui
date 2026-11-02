import { describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'

let lic = { isEnterprise: true, loading: true }

vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => lic }))

import { useCockpitLicense } from './useCockpitLicense'

describe('useCockpitLicense', () => {
  it('is fail-closed while loading', () => {
    lic = { isEnterprise: true, loading: true }
    expect(renderHook(() => useCockpitLicense()).result.current).toEqual({ enterprise: false, resolved: false })
  })

  it('follows the license once resolved', () => {
    lic = { isEnterprise: true, loading: false }
    expect(renderHook(() => useCockpitLicense()).result.current).toEqual({ enterprise: true, resolved: true })
    lic = { isEnterprise: false, loading: false }
    expect(renderHook(() => useCockpitLicense()).result.current.enterprise).toBe(false)
  })
})
