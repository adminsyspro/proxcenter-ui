// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLicenseManagement } from './useLicenseManagement'

const response = (body: unknown, status = 200) => ({ ok: status < 400, status, json: async () => body })
const initialStatus = { connection: { available: true, status: 'none', held: [] } }
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => response(url.endsWith('/features') ? { features: [] } : initialStatus))
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

async function mount() {
  const hook = renderHook(() => useLicenseManagement())
  await waitFor(() => expect(hook.result.current.loading).toBe(false))
  fetchMock.mockClear()
  return hook
}

describe('license connection actions', () => {
  it('refreshes silently without blanking the tab, bypassing the cache', async () => {
    const { result } = await mount()
    let resolve!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    let pending!: Promise<void>
    act(() => { pending = result.current.refreshLicenseStatus() })
    expect(result.current.loading).toBe(false)
    expect(result.current.licenseStatus).toEqual(initialStatus)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/license/status', { cache: 'no-store' })
    await act(async () => { resolve(response({ connection: { status: 'connected' } })); await pending })
    expect(result.current.licenseStatus.connection.status).toBe('connected')
  })

  it('keeps the last status on failed silent refreshes', async () => {
    const { result } = await mount()
    fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(response({}, 503))
    await act(async () => { await result.current.refreshLicenseStatus(); await result.current.refreshLicenseStatus() })
    expect(result.current.licenseStatus).toEqual(initialStatus)
    expect(result.current.loading).toBe(false)
  })

  it('retains the loading indicator for explicit non-silent reloads', async () => {
    const { result } = await mount()
    let resolve!: (value: unknown) => void
    fetchMock.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    let pending!: Promise<void>
    act(() => { pending = result.current.loadLicenseStatus() })
    expect(result.current.loading).toBe(true)
    await act(async () => { resolve(response(initialStatus)); await pending })
    expect(result.current.loading).toBe(false)
  })

  it.each([
    ['startConnection', '/api/v1/license/connect', 'POST', 200],
    ['cancelConnection', '/api/v1/license/connect', 'DELETE', 200],
    ['checkinNow', '/api/v1/license/checkin', 'POST', 202],
  ] as const)('%s sends the action and refreshes status once', async (action, url, method, status) => {
    const { result } = await mount()
    fetchMock.mockResolvedValueOnce(response({ success: true }, status))
    await act(async () => { expect(await result.current[action]()).toEqual({ success: true }) })
    expect(fetchMock.mock.calls).toEqual([[url, { method }], ['/api/v1/license/status', { cache: 'no-store' }]])
  })

  it.each(['CONNECT_DISABLED', 'IDENTITY_SIGNING_UNAVAILABLE', 'PORTAL_UNREACHABLE'])('preserves %s for the localized UI without refreshing', async code => {
    const { result } = await mount()
    fetchMock.mockResolvedValueOnce(response({ success: false, error: 'reason', code }, 409))
    await act(async () => {
      expect(await result.current.startConnection()).toEqual({ success: false, error: 'reason', code })
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('handles non-JSON, application-level and network failures', async () => {
    const { result } = await mount()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('not JSON') } })
      .mockResolvedValueOnce(response({ success: false, error: 'denied' }))
      .mockRejectedValueOnce(new Error('offline'))
    await act(async () => {
      expect(await result.current.startConnection()).toMatchObject({ success: false, error: 'HTTP 502' })
      expect(await result.current.cancelConnection()).toMatchObject({ success: false, error: 'denied' })
      expect(await result.current.checkinNow()).toEqual({ success: false, error: 'offline' })
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
