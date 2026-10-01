import * as React from 'react'

import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const t = (key: string, values?: object) => key + (values && Object.keys(values).length ? ` ${JSON.stringify(values)}` : '')
const refreshContext = vi.fn()
let management: any
let multiLicense = false
let importsPayload: any[] = []

vi.mock('next-intl', () => ({ useTranslations: () => t, useLocale: () => 'en' }))
vi.mock('@/contexts/LicenseContext', () => ({ useLicense: () => ({ refresh: refreshContext }) }))
vi.mock('@/hooks/useLicenseManagement', () => ({ useLicenseManagement: () => management }))
vi.mock('@components/layout/shared/Logo', () => ({ LogoIcon: () => null }))

import LicenseTab from './LicenseTab'

const NOW = Date.parse('2030-01-01T00:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const at = (days: number) => new Date(NOW + days * DAY).toISOString()

const connected = {
  available: true, status: 'connected', portal_url: 'https://proxcenter.io', instance_name: 'Lab A', customer_name: 'Lab SAS',
  last_ok_at: at(-0.01), next_checkin_at: at(1), lease_until: at(30), held: [{ license_id: 'P1', kind: 'edition', lease_until: at(30) }],
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW)
  multiLicense = false
  importsPayload = []
  refreshContext.mockReset()
  management = {
    licenseStatus: {
      licensed: true, edition: 'enterprise', license_id: 'P1', customer: { company: 'Lab SAS' }, binding: 'connected',
      limits: { max_nodes: 8 }, node_status: { current_nodes: 6, max_nodes: 8 }, expires_at: at(365), options: [], connection: connected,
    },
    loading: false, activating: false, error: null, success: null,
    setError: vi.fn(), setSuccess: vi.fn(), loadLicenseStatus: vi.fn(), refreshLicenseStatus: vi.fn(),
    handleActivate: vi.fn().mockResolvedValue({ success: true }), handleDeactivate: vi.fn().mockResolvedValue({ success: true }),
    downloadLicenseRequest: vi.fn().mockResolvedValue({ success: true }), resetInstallIdentity: vi.fn().mockResolvedValue({ success: true }),
    startConnection: vi.fn().mockResolvedValue({ success: true }),
    cancelConnection: vi.fn().mockResolvedValue({ success: true }),
    checkinNow: vi.fn().mockResolvedValue({ success: true }),
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    status: url.endsWith('/imports') && !multiLicense ? 404 : 200,
    ok: true, json: async () => ({ imports: importsPayload, data: [] }),
  })))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })

const mountTab = async () => {
  let view!: ReturnType<typeof render>

  await act(async () => { view = render(React.createElement(LicenseTab)) })

  return view
}

const rerender = (view: ReturnType<typeof render>) => act(async () => view.rerender(React.createElement(LicenseTab)))
const button = (name: string) => screen.getByRole('button', { name })
const sync = () => button('settings.licenseTab.connection.sync')

describe('LicenseTab situations', () => {
  it('shows the partner name and logo on the Received from line, proxcenter.io as the channel', async () => {
    management.licenseStatus = { ...management.licenseStatus, connection: { ...connected, partner: { name: 'Partner SAS', has_logo: true, logo_sha256: 'a'.repeat(64) } } }
    const { container } = await mountTab()
    expect(container.textContent).toContain('Partner SAS')
    expect(container.textContent).toContain('settings.licenseTab.summary.viaPortal')
    const img = container.querySelector('img[alt="Partner SAS"]') as HTMLImageElement
    expect(img.getAttribute('src')).toBe(`/api/v1/license/partner-logo?v=${'a'.repeat(64)}`)
    fireEvent.error(img)
    expect(container.querySelector('img[alt="Partner SAS"]')).toBeNull()
    expect(container.textContent).toContain('Partner SAS')
  })

  it('retries a replaced logo after the previous one failed to load', async () => {
    management.licenseStatus = { ...management.licenseStatus, connection: { ...connected, partner: { name: 'Partner SAS', has_logo: true, logo_sha256: 'a'.repeat(64) } } }
    const view = await mountTab()
    fireEvent.error(view.container.querySelector('img[alt="Partner SAS"]') as HTMLImageElement)
    expect(view.container.querySelector('img[alt="Partner SAS"]')).toBeNull()
    management.licenseStatus = { ...management.licenseStatus, connection: { ...connected, partner: { name: 'Partner SAS', has_logo: true, logo_sha256: 'b'.repeat(64) } } }
    await rerender(view)
    const img = view.container.querySelector('img[alt="Partner SAS"]') as HTMLImageElement
    expect(img?.getAttribute('src')).toBe(`/api/v1/license/partner-logo?v=${'b'.repeat(64)}`)
  })

  it('keeps proxcenter.io as the source of a direct customer', async () => {
    const { container } = await mountTab()
    expect(container.textContent).toContain('proxcenter.io')
    expect(container.textContent).not.toContain('settings.licenseTab.summary.viaPortal')
  })

  it('shows the nominal connected license with one date, its source and no alert', async () => {
    const { container } = await mountTab()

    expect(container.textContent).toContain('settings.licenseTab.summary.enterprise')
    expect(container.textContent).toContain('settings.licenseTab.summary.validUntil')
    expect(container.textContent).toContain('settings.licenseTab.summary.receivedFrom')
    expect(container.textContent).toContain('settings.licenseTab.summary.pillActive')
    expect(screen.queryByRole('alert')).toBeNull()
    // Nothing about the lease outside an alert.
    expect(container.textContent).not.toMatch(/lease/i)
  })

  it('tells a failing sync on the source line, details in its tooltip, and syncs from the header', async () => {
    management.licenseStatus.connection = { ...connected, status: 'disconnected', consecutive_failures: 3 }
    const { container } = await mountTab()

    // No banner: the source it concerns carries it.
    expect(screen.queryByRole('alert')).toBeNull()
    expect(container.textContent).toContain('settings.licenseTab.summary.syncFailingShort {"failures":3}')
    expect(container.textContent).toContain('settings.licenseTab.alerts.syncFailing.pill')
    await act(async () => fireEvent.click(button('settings.licenseTab.connection.sync')))
    expect(management.checkinNow).toHaveBeenCalledOnce()
  })

  it('says a license moved to another instance and links to the account', async () => {
    management.licenseStatus.connection = { ...connected, held: [{ license_id: 'X9', label: 'Site B', lost: true, grace_until: at(2.5) }] }
    await mountTab()
    const alert = screen.getByRole('alert')

    expect(alert.textContent).toContain('settings.licenseTab.alerts.moved.title {"label":"Site B"')
    expect(within(alert).getByRole('link', { name: 'settings.licenseTab.actions.openAccount' }).getAttribute('href')).toBe('https://proxcenter.io/account/license')
  })

  it('never offers the customer of a partner an account it cannot open', async () => {
    management.licenseStatus.connection = { ...connected, partner: { name: 'Partner SAS', has_logo: false }, held: [{ license_id: 'X9', label: 'Site B', lost: true, grace_until: at(2.5) }] }
    await mountTab()
    const alert = screen.getByRole('alert')

    expect(alert.textContent).toContain('settings.licenseTab.alerts.movedPartner.body')
    expect(alert.textContent).toContain('"partner":"Partner SAS"')
    expect(screen.queryByRole('link', { name: 'settings.licenseTab.actions.openAccount' })).toBeNull()
  })

  it('offers the three ways in on Community, the key dialog included', async () => {
    management.licenseStatus = { licensed: false, edition: 'community', connection: { available: true, status: 'none' } }
    await mountTab()
    expect(button('settings.licenseTab.summary.connect')).toBeTruthy()
    // Community: the header keeps only the fingerprint, no second Connect.
    expect(screen.getAllByRole('button', { name: 'settings.licenseTab.summary.connect' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'settings.licenseGenerateRequest' })).toBeNull()
    fireEvent.click(button('settings.licenseTab.summary.noInternet'))
    expect(management.downloadLicenseRequest).toHaveBeenCalledOnce()
    fireEvent.click(button('settings.licenseTab.summary.haveKey'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'KEY' } })
    await act(async () => fireEvent.click(button('settings.activateLicense')))
    expect(management.handleActivate).toHaveBeenCalledWith('KEY')
  })

  it('shows the pairing code in place of the card, and cancels', async () => {
    management.licenseStatus = { licensed: false, connection: { available: true, status: 'pairing', user_code: 'NUKL-9735', verification_url: 'https://proxcenter.io/connect' } }
    const { container } = await mountTab()

    expect(container.textContent).toContain('NUKL-9735')
    expect(container.textContent).not.toContain('settings.licenseTab.summary.community')
    expect(screen.getByRole('link', { name: 'settings.licenseConnectionOpenPortal' }).getAttribute('href')).toBe('https://proxcenter.io/connect?code=NUKL-9735')
    await act(async () => fireEvent.click(button('settings.licenseConnectionCancel')))
    expect(management.cancelConnection).toHaveBeenCalledOnce()
  })

  it('shows a file-bound license as activated by a file, renewable with a new request', async () => {
    management.licenseStatus = { ...management.licenseStatus, binding: 'install', connection: null }
    const { container } = await mountTab()

    expect(container.textContent).toContain('settings.licenseTab.summary.fileSource')
    await act(async () => fireEvent.click(button('settings.licenseTab.summary.renewWithFile')))
    expect(management.downloadLicenseRequest).toHaveBeenCalledOnce()
  })

  it('never mentions proxcenter.io on an air-gapped instance', async () => {
    management.licenseStatus = { ...management.licenseStatus, offline: true, binding: 'install', connection: { ...connected, status: 'none' } }
    const { container } = await mountTab()

    expect(screen.queryByRole('button', { name: 'settings.licenseTab.connection.sync' })).toBeNull()
    expect(container.textContent).not.toContain('settings.licenseTab.summary.connect')
    expect(container.textContent).not.toContain('proxcenter.io')
  })

  it('lists each license on its own line for an MSP, clusters included', async () => {
    multiLicense = true
    importsPayload = [
      { id: 'imp-a', license_id: 'I1', edition: 'enterprise', max_nodes: 12, expires_at: at(200), state: 'active', connection_ids: ['c-a'], customer: 'Client Durand' },
      { id: 'opt-1', license_id: 'O1', type: 'option', capabilities: ['control_plane_ha'], expires_at: at(300), state: 'active', connection_ids: [] },
    ]
    management.licenseStatus.node_status = {
      current_nodes: 16, max_nodes: 20,
      per_license: [{ license_id: 'P1', max_nodes: 8, used_nodes: 6, is_primary: true }, { license_id: 'I1', max_nodes: 12, used_nodes: 10 }],
    }
    const { container } = await mountTab()
    const rows = screen.getAllByRole('row')

    expect(container.textContent).toContain('settings.licenseTab.licenses.colClusters')
    expect(container.textContent).toContain('settings.licenseTab.summary.nodesFleet')
    // Header + primary + import + option.
    expect(rows).toHaveLength(4)
    expect(rows[2].textContent).toContain('Client Durand')
    expect(rows[2].textContent).toContain('10 / 12')
  })

  it('keeps a held license the table does not list on its own line', async () => {
    multiLicense = true
    importsPayload = [{ id: 'imp-a', license_id: 'I1', edition: 'enterprise', max_nodes: 4, expires_at: at(200), state: 'active', connection_ids: [] }]
    management.licenseStatus.node_status = { current_nodes: 6, max_nodes: 12, per_license: [{ license_id: 'P1', max_nodes: 8, used_nodes: 6, is_primary: true }] }
    management.licenseStatus.connection = { ...connected, held: [...connected.held, { license_id: 'M1', label: 'Site B', lost: true, grace_until: at(2.5) }] }
    await mountTab()
    const last = screen.getAllByRole('row').at(-1)!

    expect(last.textContent).toContain('settings.licenseTab.licenses.moved {"days":2}')
    expect(within(last).queryByRole('button')).toBeNull()
  })

  it('opens Advanced with both fingerprints when an activation is refused for another server', async () => {
    management.licenseStatus = { licensed: false, edition: 'community', install: { fingerprint: 'fp-here', can_sign: true }, connection: { available: true, status: 'none' } }
    management.handleActivate.mockResolvedValue({ success: false, code: 'LICENSE_BINDING_MISMATCH', expected: 'fp-there', actual: 'fp-here' })
    const { container } = await mountTab()

    fireEvent.click(button('settings.licenseTab.summary.haveKey'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'KEY' } })
    await act(async () => fireEvent.click(button('settings.activateLicense')))
    // The closing dialog still hides the page from the accessibility tree.
    expect(container.textContent).toContain('settings.licenseTab.alerts.binding.title')
    expect(container.textContent).toContain('fp-there')
    expect(container.textContent).toContain('settings.licenseBindingExpected')
  })

  it('offers reset identity and reconnect on a refused copy', async () => {
    management.licenseStatus.connection = { ...connected, status: 'cloned' }
    await mountTab()
    const alert = screen.getByRole('alert')

    fireEvent.click(within(alert).getByRole('button', { name: 'settings.licenseTab.actions.resetIdentity' }))
    expect(screen.getByRole('dialog').textContent).toContain('settings.licenseResetIdentityConfirm')
  })

  it('reads the unknown state when the status could not be loaded, and retries', async () => {
    management.licenseStatus = null
    await mountTab()
    fireEvent.click(button('settings.licenseTab.actions.retry'))
    expect(management.loadLicenseStatus).toHaveBeenCalledOnce()
  })
})

describe('LicenseTab connection behaviour', () => {
  it.each(['none', 'revoked', 'identity_changed'])('does not refresh context on %s to connected', async status => {
    management.licenseStatus.connection = { ...connected, status }
    const view = await mountTab()

    management.licenseStatus = { ...management.licenseStatus, connection: connected }
    await rerender(view)
    expect(refreshContext).not.toHaveBeenCalled()
    expect(management.loadLicenseStatus).not.toHaveBeenCalled()
  })

  it.each(['pairing', 'disconnected'])('refreshes context only when %s transitions to connected', async previous => {
    management.licenseStatus = null
    const view = await mountTab()

    management.licenseStatus = { connection: connected }
    await rerender(view)
    expect(refreshContext).not.toHaveBeenCalled()
    management.licenseStatus = { connection: { ...connected, status: previous } }
    await rerender(view)
    management.licenseStatus = { connection: connected }
    await rerender(view)
    expect(refreshContext).toHaveBeenCalledOnce()
    // Silent: the tab keeps its content instead of flashing to a spinner.
    expect(management.refreshLicenseStatus).toHaveBeenCalledOnce()
    expect(management.loadLicenseStatus).not.toHaveBeenCalled()
    await rerender(view)
    expect(refreshContext).toHaveBeenCalledOnce()
  })

  it('polls pairing every 3 seconds and stops on state change and unmount', async () => {
    management.licenseStatus.connection = { ...connected, status: 'pairing' }
    const view = await mountTab()

    await act(async () => vi.advanceTimersByTime(6000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(2)
    management.licenseStatus = { ...management.licenseStatus, connection: connected }
    await rerender(view)
    // pairing -> connected reloads once, silently, then the polling stops.
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(3)
    await act(async () => vi.advanceTimersByTime(6000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(3)
    management.licenseStatus = { ...management.licenseStatus, connection: { ...connected, status: 'pairing' } }
    await rerender(view)
    view.unmount()
    await act(async () => vi.advanceTimersByTime(6000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(3)
  })

  it('polls every 5 seconds after a sync until last_checkin_at changes', async () => {
    management.licenseStatus.connection = { ...connected, last_checkin_at: '2030-01-01T00:00:00Z' }
    const view = await mountTab()

    const syncButton = sync()
    await act(async () => fireEvent.click(syncButton))
    expect(management.checkinNow).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTime(4999))
    expect(management.refreshLicenseStatus).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(1)
    // An HA follower: the leader runs the check-in at its next tick, later.
    await act(async () => vi.advanceTimersByTime(25000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(6)
    management.licenseStatus = { ...management.licenseStatus, connection: { ...connected, last_checkin_at: '2030-01-01T00:00:40Z' } }
    await rerender(view)
    await act(async () => vi.advanceTimersByTime(30000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(6)
  })

  it('gives up polling after about 75 seconds without a check-in', async () => {
    await mountTab()
    const syncButton = sync()
    await act(async () => fireEvent.click(syncButton))
    await act(async () => vi.advanceTimersByTime(75000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(15)
    await act(async () => vi.advanceTimersByTime(60000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(15)
  })

  it('does not poll when the sync request is refused', async () => {
    management.checkinNow.mockResolvedValue({ success: false, code: 'NOT_CONNECTED', error: 'not connected' })
    await mountTab()
    const syncButton = sync()
    await act(async () => fireEvent.click(syncButton))
    await act(async () => vi.advanceTimersByTime(30000))
    expect(management.refreshLicenseStatus).not.toHaveBeenCalled()
  })

  it('stops the sync polling on unmount', async () => {
    const view = await mountTab()

    const syncButton = sync()
    await act(async () => fireEvent.click(syncButton))
    await act(async () => vi.advanceTimersByTime(5000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledOnce()
    view.unmount()
    await act(async () => vi.advanceTimersByTime(30000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledOnce()
  })

  it('does not schedule a refresh if the sync finishes after unmount', async () => {
    let resolve!: (value: unknown) => void

    management.checkinNow.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const view = await mountTab()

    fireEvent.click(sync())
    view.unmount()
    await act(async () => { resolve({ success: true }) })
    await act(async () => vi.advanceTimersByTime(5000))
    expect(management.refreshLicenseStatus).not.toHaveBeenCalled()
  })

  it.each([
    ['CONNECT_DISABLED', 'settings.licenseConnectionUnavailable'],
    ['IDENTITY_SIGNING_UNAVAILABLE', 'settings.licenseSigningUnavailable'],
  ])('localizes %s', async (code, message) => {
    management.licenseStatus = { licensed: false, connection: { available: true, status: 'none' } }
    management.startConnection.mockResolvedValue({ success: false, code })
    await mountTab()
    await act(async () => fireEvent.click(button('settings.licenseTab.summary.connect')))
    expect(management.setError).toHaveBeenLastCalledWith(message)
  })

  it('names the portal failure with the server detail on PORTAL_UNREACHABLE', async () => {
    management.licenseStatus = { licensed: false, connection: { available: true, status: 'none' } }
    management.startConnection.mockResolvedValue({ success: false, code: 'PORTAL_UNREACHABLE', error: 'portal answered 503' })
    await mountTab()
    await act(async () => fireEvent.click(button('settings.licenseTab.summary.connect')))
    expect(management.setError).toHaveBeenLastCalledWith('settings.licenseConnectionFailed: portal answered 503')
  })

  it('requires the disconnect dialog before cancelling and refreshing context', async () => {
    await mountTab()
    fireEvent.click(button('settings.licenseConnectionDisconnect'))
    expect(management.cancelConnection).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').textContent).toContain('settings.licenseConnectionDisconnectConfirm')
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'settings.licenseConnectionDisconnect' }).at(-1)!))
    expect(management.cancelConnection).toHaveBeenCalledOnce()
    expect(refreshContext).toHaveBeenCalledOnce()
  })

  it('refreshes the license context and the imports when a sync brings a new key, not on mount', async () => {
    multiLicense = true
    const view = await mountTab()
    const importsCalls = () => (fetch as any).mock.calls.filter(([u]: [string]) => u === '/api/v1/license/imports').length

    expect(refreshContext).not.toHaveBeenCalled()
    expect(importsCalls()).toBe(1)
    management.licenseStatus = { ...management.licenseStatus, connection: { ...connected } }
    await rerender(view)
    expect(refreshContext).not.toHaveBeenCalled()
    management.licenseStatus = { ...management.licenseStatus, license_id: 'L2', connection: { ...connected, held: [{ license_id: 'L2', lost: false }] } }
    await rerender(view)
    expect(refreshContext).toHaveBeenCalledOnce()
    expect(importsCalls()).toBe(2)
    management.licenseStatus = { ...management.licenseStatus, connection: { ...connected, held: [{ license_id: 'L2', lost: true }] } }
    await rerender(view)
    expect(refreshContext).toHaveBeenCalledTimes(2)
    management.licenseStatus = { ...management.licenseStatus, lease_error: 'expired' }
    await rerender(view)
    expect(refreshContext).toHaveBeenCalledTimes(3)
    expect(importsCalls()).toBe(4)
  })

  it('does not treat the first status load as a license change', async () => {
    management.licenseStatus = null
    const view = await mountTab()

    management.licenseStatus = { licensed: true, license_id: 'L1', connection: connected }
    await rerender(view)
    expect(refreshContext).not.toHaveBeenCalled()
  })
})
