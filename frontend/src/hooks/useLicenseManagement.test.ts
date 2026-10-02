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

describe('license key actions', () => {
  it('sends a cleaned key and returns the binding mismatch details without reloading', async () => {
    const { result } = await mount()
    fetchMock.mockResolvedValueOnce(response({
      success: false, error: 'bound elsewhere', code: 'LICENSE_BINDING_MISMATCH', expected_fingerprint: 'fp-a', actual_fingerprint: 'fp-b',
    }, 409))
    await act(async () => {
      expect(await result.current.handleActivate('  LINE1   \nLINE2  \n')).toEqual({
        success: false, error: 'bound elsewhere', code: 'LICENSE_BINDING_MISMATCH', expected: 'fp-a', actual: 'fp-b',
      })
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ license: 'LINE1\nLINE2' })
    expect(result.current.activating).toBe(false)
  })

  it('returns the activation error, or a default one', async () => {
    const { result } = await mount()
    fetchMock.mockResolvedValueOnce(response({ success: false, error: 'expired' }, 400))
      .mockResolvedValueOnce(response({ success: false }))
    await act(async () => {
      expect(await result.current.handleActivate('KEY')).toEqual({ success: false, error: 'expired' })
      expect(await result.current.handleActivate('KEY')).toEqual({ success: false, error: 'Activation failed' })
    })
  })

  it('reloads status, features and the page after a successful activation', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    const { result } = await mount()
    fetchMock.mockResolvedValueOnce(response({ success: true }))
    await act(async () => { expect(await result.current.handleActivate('KEY')).toEqual({ success: true }) })
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['/api/v1/license/activate', '/api/v1/license/status', '/api/v1/license/features'])
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('deactivates and refreshes, or returns the error', async () => {
    const { result } = await mount()
    fetchMock.mockResolvedValueOnce(response({ success: true }))
    await act(async () => { expect(await result.current.handleDeactivate()).toEqual({ success: true }) })
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual(['/api/v1/license/deactivate', '/api/v1/license/status', '/api/v1/license/features'])
    fetchMock.mockResolvedValueOnce(response({ success: false }, 500)).mockResolvedValueOnce(response({ success: false, error: 'locked' }, 409))
    await act(async () => {
      expect(await result.current.handleDeactivate()).toEqual({ success: false, error: 'Deactivation failed' })
      expect(await result.current.handleDeactivate()).toEqual({ success: false, error: 'locked' })
    })
  })
})

describe('license request and install identity', () => {
  function blobResponse(disposition: string | null) {
    return { ok: true, status: 200, blob: async () => new Blob(['{}']), headers: { get: () => disposition } }
  }

  it.each([
    ['attachment; filename="proxcenter-license-request-abcd1234.json"', 'proxcenter-license-request-abcd1234.json'],
    [null, 'proxcenter-license-request.json'],
  ])('downloads the request file (%s)', async (disposition, filename) => {
    const { result } = await mount()
    const createObjectURL = vi.fn(() => 'blob:req')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.download).toBe(filename)
      expect(this.href).toBe('blob:req')
    })
    fetchMock.mockResolvedValueOnce(blobResponse(disposition))
    await act(async () => { expect(await result.current.downloadLicenseRequest()).toEqual({ success: true }) })
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/license/request', { cache: 'no-store' })
    expect(click).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:req')
    expect(document.querySelector('a[download]')).toBeNull()
  })

  it('returns the request error with its code, the HTTP status, or the network error', async () => {
    const { result } = await mount()
    fetchMock.mockResolvedValueOnce(response({ error: 'cannot sign', code: 'IDENTITY_SIGNING_UNAVAILABLE' }, 409))
      .mockResolvedValueOnce({ ok: false, status: 502, json: async () => { throw new Error('not JSON') } })
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce({})
    await act(async () => {
      expect(await result.current.downloadLicenseRequest()).toEqual({ success: false, error: 'cannot sign', code: 'IDENTITY_SIGNING_UNAVAILABLE' })
      expect(await result.current.downloadLicenseRequest()).toEqual({ success: false, error: 'HTTP 502', code: undefined })
      expect(await result.current.downloadLicenseRequest()).toEqual({ success: false, error: 'offline' })
      expect(await result.current.downloadLicenseRequest()).toEqual({ success: false, error: 'Request failed' })
    })
    expect(result.current.activating).toBe(false)
  })

  it('resets the identity and reloads the status', async () => {
    const { result } = await mount()
    fetchMock.mockResolvedValueOnce(response({ success: true }))
    await act(async () => { expect(await result.current.resetInstallIdentity()).toEqual({ success: true }) })
    expect(fetchMock.mock.calls).toEqual([['/api/v1/license/identity/reset', { method: 'POST' }], ['/api/v1/license/status', { cache: 'no-store' }]])
  })

  it('returns the reset error, the HTTP status, or the network error', async () => {
    const { result } = await mount()
    fetchMock.mockResolvedValueOnce(response({ success: false, error: 'bound' }, 409))
      .mockResolvedValueOnce({ ok: false, status: 503, json: async () => { throw new Error('not JSON') } })
      .mockRejectedValueOnce(new Error('offline'))
      .mockRejectedValueOnce({})
    await act(async () => {
      expect(await result.current.resetInstallIdentity()).toEqual({ success: false, error: 'bound' })
      expect(await result.current.resetInstallIdentity()).toEqual({ success: false, error: 'HTTP 503' })
      expect(await result.current.resetInstallIdentity()).toEqual({ success: false, error: 'offline' })
      expect(await result.current.resetInstallIdentity()).toEqual({ success: false, error: 'Reset failed' })
    })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })
})
