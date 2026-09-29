// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import * as React from 'react'
import * as mui from '@mui/material'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildLicenseTableRows, computePerTenantRollup } from '@/lib/license/view'
import { isMultiLicenseEnabled } from '@/lib/features'
import { leaseDaysLeft } from '@/components/settings/leaseDays'

// Exercise the page-local components without exporting unsupported Next.js page
// exports or loading unrelated settings tabs and their providers.
const source = readFileSync(join(__dirname, 'page.jsx'), 'utf8')
const section = source.slice(source.indexOf('const FEATURE_CATEGORIES'), source.indexOf('function AITab()'))
const t = (key: string, values?: object) => key + (values ? ` ${JSON.stringify(values)}` : '')
const refreshContext = vi.fn()
let management: any
let multiLicense = false
const dependencies = {
  React, useState: React.useState, useEffect: React.useEffect, useMemo: React.useMemo, useRef: React.useRef,
  Alert: mui.Alert, Box: mui.Box, Button: mui.Button, Card: mui.Card, CardContent: mui.CardContent,
  Chip: mui.Chip, Dialog: mui.Dialog, DialogActions: mui.DialogActions, DialogContent: mui.DialogContent,
  DialogTitle: mui.DialogTitle, Typography: mui.Typography, Tooltip: mui.Tooltip, IconButton: mui.IconButton,
  LinearProgress: mui.LinearProgress, TextField: mui.TextField, FormControl: mui.FormControl,
  InputLabel: mui.InputLabel, Select: mui.Select, MenuItem: mui.MenuItem, FormControlLabel: mui.FormControlLabel,
  Checkbox: mui.Checkbox, useTheme: mui.useTheme,
  buildLicenseTableRows, computePerTenantRollup, isMultiLicenseEnabled, leaseDaysLeft,
  useTranslations: () => t,
  useLicense: () => ({ refresh: refreshContext }),
  useLicenseManagement: () => management,
  DataGrid: () => null,
}
// Compile outside jsdom: its Uint8Array differs from Node's TextEncoder output.
const code = execFileSync(process.execPath, ['-e', `
  const source = require('node:fs').readFileSync(0, 'utf8')
  process.stdout.write(require('esbuild').transformSync(source, { loader: 'jsx', jsx: 'transform' }).code)
`], { input: section + '\nreturn { LicenseTab, ConnectionCard }', encoding: 'utf8' })
const { LicenseTab, ConnectionCard } = new Function(...Object.keys(dependencies), code)(...Object.values(dependencies))
const connected = { available: true, status: 'connected', held: [], instance_id: 'instance-1' }
const callbacks = () => ({ onConnect: vi.fn(), onCancel: vi.fn(), onDisconnect: vi.fn(), onCheckin: vi.fn() })

beforeEach(() => {
  multiLicense = false
  refreshContext.mockReset()
  management = {
    licenseStatus: { licensed: true, edition: 'enterprise', binding: 'connected', connection: connected },
    features: [], loading: false, activating: false,
    setError: vi.fn(), setSuccess: vi.fn(), loadLicenseStatus: vi.fn(), refreshLicenseStatus: vi.fn(),
    startConnection: vi.fn().mockResolvedValue({ success: true }),
    cancelConnection: vi.fn().mockResolvedValue({ success: true }),
    checkinNow: vi.fn().mockResolvedValue({ success: true }),
  }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    status: url.endsWith('/imports') && !multiLicense ? 404 : 200,
    ok: true, json: async () => ({ imports: [], data: [] }),
  })))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals() })
const mountTab = async () => { let view!: ReturnType<typeof render>; await act(async () => { view = render(React.createElement(LicenseTab)) }); return view }

describe('ConnectionCard', () => {
  it('renders nothing when disabled', () => {
    const { container } = render(React.createElement(ConnectionCard, { connection: { available: false, status: 'none' }, t }))
    expect(container.innerHTML).toBe('')
  })
  it('renders nothing on an air-gapped instance, even when the orchestrator offers the connection', () => {
    const { container } = render(React.createElement(ConnectionCard, { connection: { ...connected, status: 'none' }, offline: true, t }))
    expect(container.innerHTML).toBe('')
  })
  it('hides the portal link while the verification URL is unknown', () => {
    render(React.createElement(ConnectionCard, { t, ...callbacks(), connection: { ...connected, status: 'pairing', verification_url: '' } }))
    expect(screen.queryByRole('link')).toBeNull()
    expect(screen.getByRole('button', { name: 'settings.licenseConnectionCancel' })).toBeTruthy()
  })
  it('counts the grace days left like the backend, rounding down', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    const { container } = render(React.createElement(ConnectionCard, { t, connection: {
      ...connected, held: [{ license_id: 'lost-1', lost: true, grace_until: '2030-01-03T12:00:00Z' }],
    } }))
    expect(container.textContent).toContain('settings.licenseConnectionLost {"days":2}')
  })
  it('shows the ended copy, never "less than a day", once the lease or grace period has run out', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2030-01-01T00:00:00Z'))
    const { container } = render(React.createElement(ConnectionCard, { t, connection: {
      ...connected, lease_until: '2029-12-31T00:00:00Z',
      held: [{ license_id: 'lost-1', lost: true, grace_until: '2029-12-31T00:00:00Z' }],
    } }))
    expect(container.textContent).toContain('settings.licenseConnectionLeaseEnded')
    expect(container.textContent).toContain('settings.licenseConnectionLostEnded')
    expect(container.textContent).not.toContain('settings.licenseConnectionLeaseRemaining')
    expect(container.textContent).not.toContain('settings.licenseConnectionLost {')
    expect(container.textContent).not.toMatch(/"days":0/)
  })
  it('never nests a Chip div inside a Typography p in the held list (D4)', () => {
    const { container } = render(React.createElement(ConnectionCard, { t, connection: {
      ...connected, held: [{ license_id: 'lost-1', lost: true, grace_until: '2030-01-03T12:00:00Z' }],
    } }))
    expect(container.querySelector('li .MuiChip-root')).toBeTruthy()
    expect(container.querySelector('p div')).toBeNull()
  })
  it('shows the connected host in the chip, falling back to proxcenter.io when the portal URL is missing or invalid', () => {
    const { rerender, container } = render(React.createElement(ConnectionCard, {
      t, connection: { ...connected, status: 'connected', portal_url: 'https://portal.example.com:8443/foo' },
    }))
    expect(container.textContent).toContain('settings.licenseConnectionConnectedTo {"host":"portal.example.com:8443"}')
    rerender(React.createElement(ConnectionCard, { t, connection: { ...connected, status: 'connected', portal_url: 'not-a-url' } }))
    expect(container.textContent).toContain('settings.licenseConnectionConnectedTo {"host":"proxcenter.io"}')
    rerender(React.createElement(ConnectionCard, { t, connection: { ...connected, status: 'connected', portal_url: undefined } }))
    expect(container.textContent).toContain('settings.licenseConnectionConnectedTo {"host":"proxcenter.io"}')
  })
  it.each(['none', 'pairing', 'connected', 'disconnected', 'revoked', 'identity_changed'])('renders %s and the appropriate actions', status => {
    const actions = callbacks()
    render(React.createElement(ConnectionCard, {
      connection: { ...connected, status, user_code: 'ABCD-2345', verification_url: 'https://proxcenter.io/connect' }, t, ...actions,
    }))
    if (status === 'none' || status === 'revoked' || status === 'identity_changed') {
      fireEvent.click(screen.getByRole('button', { name: status === 'none' ? 'settings.licenseConnectionConnect' : 'settings.licenseConnectionReconnect' }))
      expect(actions.onConnect).toHaveBeenCalledOnce()
    } else if (status === 'pairing') {
      expect(screen.getByRole('link').getAttribute('href')).toBe('https://proxcenter.io/connect?code=ABCD-2345')
      expect(screen.getByRole('link').getAttribute('rel')).toBe('noopener noreferrer')
      fireEvent.click(screen.getByRole('button', { name: 'settings.licenseConnectionCancel' }))
      expect(actions.onCancel).toHaveBeenCalledOnce()
    } else {
      expect(screen.getByText('settings.licenseConnectionHeldNone')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: 'settings.licenseConnectionCheckinNow' }))
      fireEvent.click(screen.getByRole('button', { name: 'settings.licenseConnectionDisconnect' }))
      expect(actions.onCheckin).toHaveBeenCalledOnce()
      expect(actions.onDisconnect).toHaveBeenCalledOnce()
    }
  })
  it('handles omitted errors/grace, lost licenses, lease warnings and clock skew', () => {
    // The lease line is computed client-side from lease_until (A8), not read
    // off a possibly stale lease_days_remaining, so time is frozen 2 days
    // before it.
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2029-12-30T00:00:00Z'))
    const { container } = render(React.createElement(ConnectionCard, { t, connection: {
      ...connected, status: 'disconnected', consecutive_failures: 3, server_skew_seconds: -360,
      lease_until: '2030-01-01T00:00:00Z', lease_warn: true,
      held: [{ license_id: 'lost-1', lost: true }, { license_id: 'held-1', lease_until: '2030-01-01T00:00:00Z' }],
    } }))
    // No grace_until at all is null too (A8: "no date or ended"), so it
    // reads as the ended copy, never a false "0 days left".
    expect(container.textContent).toContain('settings.licenseConnectionLostEnded')
    expect(container.textContent).toContain('settings.licenseConnectionClockSkew {"minutes":6}')
    expect(container.textContent).toContain('settings.licenseConnectionLeaseRemaining {"days":2}')
    expect(container.textContent).toContain('settings.licenseConnectionLastError: —')
    expect(container.textContent).not.toMatch(/n\/a|Invalid Date|NaN/)
  })
  it('disables actions while busy and shows a pairing failure', () => {
    render(React.createElement(ConnectionCard, { t, busy: true, connection: { ...connected, status: 'none', last_error: 'PAIRING_EXPIRED' } }))
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('alert').textContent).toContain('PAIRING_EXPIRED')
  })
})

describe('LicenseTab connection integration', () => {
  it.each([false, true])('labels connected keys correctly with multi-license=%s', async enabled => {
    multiLicense = enabled
    await mountTab()
    expect(screen.getByText('settings.licenseBindingConnected')).toBeTruthy()
    expect(screen.queryByText('settings.licenseBindingFloating')).toBeNull()
  })
  it.each(['install', 'floating'])('preserves the %s binding label', async binding => {
    management.licenseStatus.binding = binding
    await mountTab()
    expect(screen.getByText(`settings.licenseBinding${binding === 'install' ? 'Install' : 'Floating'}`)).toBeTruthy()
  })
  it('shows the primary license lease date under the expiration date', async () => {
    management.licenseStatus.expires_at = '2031-01-01T00:00:00Z'
    management.licenseStatus.lease_until = '2030-01-01T00:00:00Z'
    await mountTab()
    expect(screen.getByText(`settings.licenseLeaseUntil: ${new Date(management.licenseStatus.lease_until).toLocaleDateString()}`)).toBeTruthy()
  })
  it.each(['none', 'revoked', 'identity_changed'])('does not refresh context on %s to connected', async status => {
    management.licenseStatus.connection = { ...connected, status }
    const view = await mountTab()
    management.licenseStatus.connection = connected
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    expect(refreshContext).not.toHaveBeenCalled()
    expect(management.loadLicenseStatus).not.toHaveBeenCalled()
  })
  it('shows lease expiry without relying on licensed=true and uses missing-value dashes', async () => {
    management.licenseStatus = { licensed: false, lease_error: 'expired', connection: connected }
    await mountTab()
    expect(screen.getByText('settings.licenseLeaseExpiredTitle')).toBeTruthy()
    expect(screen.getByText('settings.licenseLeaseExpiredBody {"licenseId":"—","leaseUntil":"—"}')).toBeTruthy()
  })
  it.each(['pairing', 'disconnected'])('refreshes context only when %s transitions to connected', async previous => {
    management.licenseStatus = null
    const view = await mountTab()
    management.licenseStatus = { connection: connected }
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    expect(refreshContext).not.toHaveBeenCalled()
    management.licenseStatus = { connection: { ...connected, status: previous } }
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    management.licenseStatus = { connection: connected }
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    expect(refreshContext).toHaveBeenCalledOnce()
    // Silent: the tab keeps its content instead of flashing to a spinner.
    expect(management.refreshLicenseStatus).toHaveBeenCalledOnce()
    expect(management.loadLicenseStatus).not.toHaveBeenCalled()
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    expect(refreshContext).toHaveBeenCalledOnce()
  })
  it('polls pairing every 3 seconds and stops on state change and unmount', async () => {
    vi.useFakeTimers()
    management.licenseStatus.connection = { ...connected, status: 'pairing' }
    const view = await mountTab()
    await act(async () => vi.advanceTimersByTime(6000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(2)
    management.licenseStatus.connection = connected
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    // pairing -> connected reloads once, silently, then the polling stops.
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(3)
    await act(async () => vi.advanceTimersByTime(6000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(3)
    management.licenseStatus.connection = { ...connected, status: 'pairing' }
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    view.unmount()
    await act(async () => vi.advanceTimersByTime(6000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(3)
  })
  it('polls every 5 seconds after a check-in until last_checkin_at changes', async () => {
    vi.useFakeTimers()
    management.licenseStatus.connection = { ...connected, last_checkin_at: '2030-01-01T00:00:00Z' }
    const view = await mountTab()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'settings.licenseConnectionCheckinNow' })))
    expect(management.checkinNow).toHaveBeenCalledOnce()
    await act(async () => vi.advanceTimersByTime(4999))
    expect(management.refreshLicenseStatus).not.toHaveBeenCalled()
    await act(async () => vi.advanceTimersByTime(1))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(1)
    // An HA follower: the leader runs the check-in at its next tick, later.
    await act(async () => vi.advanceTimersByTime(25000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(6)
    management.licenseStatus = { ...management.licenseStatus, connection: { ...connected, last_checkin_at: '2030-01-01T00:00:40Z' } }
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    await act(async () => vi.advanceTimersByTime(30000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(6)
  })
  it('gives up polling after about 75 seconds without a check-in', async () => {
    vi.useFakeTimers()
    await mountTab()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'settings.licenseConnectionCheckinNow' })))
    await act(async () => vi.advanceTimersByTime(75000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(15)
    await act(async () => vi.advanceTimersByTime(60000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledTimes(15)
  })
  it('does not poll when the check-in request is refused', async () => {
    vi.useFakeTimers()
    management.checkinNow.mockResolvedValue({ success: false, code: 'NOT_CONNECTED', error: 'not connected' })
    await mountTab()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'settings.licenseConnectionCheckinNow' })))
    await act(async () => vi.advanceTimersByTime(30000))
    expect(management.refreshLicenseStatus).not.toHaveBeenCalled()
  })
  it('stops the check-in polling on unmount', async () => {
    vi.useFakeTimers()
    const view = await mountTab()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'settings.licenseConnectionCheckinNow' })))
    await act(async () => vi.advanceTimersByTime(5000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledOnce()
    view.unmount()
    await act(async () => vi.advanceTimersByTime(30000))
    expect(management.refreshLicenseStatus).toHaveBeenCalledOnce()
  })
  it('does not schedule a refresh if the check-in finishes after unmount', async () => {
    vi.useFakeTimers()
    let resolve!: (value: unknown) => void
    management.checkinNow.mockImplementationOnce(() => new Promise(r => { resolve = r }))
    const view = await mountTab()
    fireEvent.click(screen.getByRole('button', { name: 'settings.licenseConnectionCheckinNow' }))
    view.unmount()
    await act(async () => { resolve({ success: true }) })
    await act(async () => vi.advanceTimersByTime(5000))
    expect(management.refreshLicenseStatus).not.toHaveBeenCalled()
  })
  it.each([
    ['CONNECT_DISABLED', 'settings.licenseConnectionUnavailable'],
    ['IDENTITY_SIGNING_UNAVAILABLE', 'settings.licenseSigningUnavailable'],
  ])('localizes %s', async (code, message) => {
    management.licenseStatus.connection = { ...connected, status: 'none' }
    management.startConnection.mockResolvedValue({ success: false, code })
    await mountTab()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'settings.licenseConnectionConnect' })))
    expect(management.setError).toHaveBeenLastCalledWith(message)
  })
  it('requires the disconnect dialog before cancelling and refreshing context', async () => {
    await mountTab()
    fireEvent.click(screen.getByRole('button', { name: 'settings.licenseConnectionDisconnect' }))
    expect(management.cancelConnection).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').textContent).toContain('settings.licenseConnectionDisconnectConfirm')
    await act(async () => fireEvent.click(screen.getAllByRole('button', { name: 'settings.licenseConnectionDisconnect' }).at(-1)!))
    expect(management.cancelConnection).toHaveBeenCalledOnce()
    expect(refreshContext).toHaveBeenCalledOnce()
  })
  it('refreshes the license context and the imports when a check-in brings a new key, not on mount', async () => {
    multiLicense = true
    const view = await mountTab()
    const importsCalls = () => (fetch as any).mock.calls.filter(([u]: [string]) => u === '/api/v1/license/imports').length
    expect(refreshContext).not.toHaveBeenCalled()
    expect(importsCalls()).toBe(1)
    management.licenseStatus = { ...management.licenseStatus, connection: { ...connected } }
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    expect(refreshContext).not.toHaveBeenCalled()
    management.licenseStatus = { ...management.licenseStatus, license_id: 'L2', connection: { ...connected, held: [{ license_id: 'L2', lost: false }] } }
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    expect(refreshContext).toHaveBeenCalledOnce()
    expect(importsCalls()).toBe(2)
    management.licenseStatus = { ...management.licenseStatus, connection: { ...connected, held: [{ license_id: 'L2', lost: true }] } }
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    expect(refreshContext).toHaveBeenCalledTimes(2)
    management.licenseStatus = { ...management.licenseStatus, lease_error: 'expired' }
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    expect(refreshContext).toHaveBeenCalledTimes(3)
    expect(importsCalls()).toBe(4)
  })
  it('does not treat the first status load as a license change', async () => {
    management.licenseStatus = null
    const view = await mountTab()
    management.licenseStatus = { licensed: true, license_id: 'L1', connection: connected }
    await act(async () => view.rerender(React.createElement(LicenseTab)))
    expect(refreshContext).not.toHaveBeenCalled()
  })
  it('hides the connection card on an air-gapped instance', async () => {
    management.licenseStatus = { ...management.licenseStatus, offline: true, connection: { ...connected, status: 'none' } }
    await mountTab()
    expect(screen.queryByText('settings.licenseConnectionTitle')).toBeNull()
  })
  it('names the portal failure with the server detail on PORTAL_UNREACHABLE', async () => {
    management.licenseStatus.connection = { ...connected, status: 'none' }
    management.startConnection.mockResolvedValue({ success: false, code: 'PORTAL_UNREACHABLE', error: 'portal answered 503' })
    await mountTab()
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'settings.licenseConnectionConnect' })))
    expect(management.setError).toHaveBeenLastCalledWith('settings.licenseConnectionFailed: portal answered 503')
  })
})
