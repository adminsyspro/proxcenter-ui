import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, waitFor, act } from '@testing-library/react'
import { server, http, HttpResponse } from '@/__tests__/setup/msw-server'
import { LicenseProvider, useLicense, Features } from './LicenseContext'

const LICENSE_STATUS_URL = '*/api/v1/license/status'

const ENTERPRISE_WITH_OPTION = {
  licensed: true,
  expired: false,
  edition: 'enterprise',
  features: ['drs'],
  options: ['control_plane_ha'],
}

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <LicenseProvider>{children}</LicenseProvider>
)

describe('LicenseContext', () => {
  beforeEach(() => {
    server.use(
      http.get(LICENSE_STATUS_URL, () => HttpResponse.json(ENTERPRISE_WITH_OPTION)),
    )
  })

  it('grants an option capability through hasFeature', async () => {
    const { result } = renderHook(() => useLicense(), { wrapper })
    await waitFor(() => expect(result.current.isLicensed).toBe(true))
    expect(result.current.hasFeature(Features.CONTROL_PLANE_HA)).toBe(true)
    expect(result.current.hasFeature(Features.DRS)).toBe(true)
  })

  it('falls back to community when a refresh fails after a valid status (P2)', async () => {
    const { result } = renderHook(() => useLicense(), { wrapper })
    await waitFor(() => expect(result.current.isLicensed).toBe(true))

    server.use(http.get(LICENSE_STATUS_URL, () => HttpResponse.error()))
    await act(async () => {
      await result.current.refresh()
    })

    await waitFor(() => expect(result.current.isLicensed).toBe(false))
    expect(result.current.hasFeature(Features.CONTROL_PLANE_HA)).toBe(false)
    expect(result.current.status?.edition).toBe('community')
  })

  it('falls back to community when the server responds non-ok', async () => {
    const { result } = renderHook(() => useLicense(), { wrapper })
    await waitFor(() => expect(result.current.isLicensed).toBe(true))

    server.use(http.get(LICENSE_STATUS_URL, () => HttpResponse.json({}, { status: 500 })))
    await act(async () => {
      await result.current.refresh()
    })

    await waitFor(() => expect(result.current.isLicensed).toBe(false))
    expect(result.current.status?.edition).toBe('community')
  })
})
