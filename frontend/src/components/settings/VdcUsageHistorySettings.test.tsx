/**
 * vDC settings, "Usage history" section (#902): loads the settings and the
 * sampler status, validates the cadence and retention, saves them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, waitFor } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'

import VdcUsageHistorySettings from './VdcUsageHistorySettings'

const fetchMock = vi.fn()
const settings = { enabled: true, intervalMinutes: 15, retentionDays: 400 }
const status = { samples: 12, lastSampledAt: '2026-10-14T10:00:00Z', samplerActive: true }

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (_url: string, init?: RequestInit) => {
    if (init?.method === 'PUT') return { ok: true, status: 200, json: async () => ({ data: JSON.parse(String(init.body)), status }) }

    return { ok: true, status: 200, json: async () => ({ data: settings, status }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('VdcUsageHistorySettings', () => {
  it('shows the settings and the sampler status', async () => {
    renderWithProviders(<VdcUsageHistorySettings />)

    expect(await screen.findByLabelText('Sampling interval (minutes)')).toHaveValue(15)
    expect(screen.getByLabelText('Retention (days)')).toHaveValue(400)
    expect(screen.getByText('Sampler running')).toBeInTheDocument()
    expect(screen.getByText(/12 samples stored/)).toBeInTheDocument()
  })

  it('saves a new cadence and retention', async () => {
    renderWithProviders(<VdcUsageHistorySettings />)
    const interval = await screen.findByLabelText('Sampling interval (minutes)')

    fireEvent.change(interval, { target: { value: '1' } })
    fireEvent.change(screen.getByLabelText('Retention (days)'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))

    await screen.findByText('Usage history settings saved')
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === 'PUT')!

    expect(put[0]).toBe('/api/v1/settings/vdc-usage-history')
    expect(JSON.parse(put[1].body)).toEqual({ enabled: true, intervalMinutes: 1, retentionDays: 30 })
  })

  it('blocks the save on an out of range value', async () => {
    renderWithProviders(<VdcUsageHistorySettings />)
    const interval = await screen.findByLabelText('Sampling interval (minutes)')

    fireEvent.change(interval, { target: { value: '0' } })
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled()
    fireEvent.change(interval, { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Retention (days)'), { target: { value: '9999' } })
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled()
  })

  it('shows a load or save error', async () => {
    fetchMock.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === 'PUT'
        ? { ok: false, status: 400, json: async () => ({ error: 'Invalid settings' }) }
        : { ok: true, status: 200, json: async () => ({ data: { ...settings, enabled: false }, status: { ...status, samplerActive: false, lastSampledAt: null } }) },
    )
    renderWithProviders(<VdcUsageHistorySettings />)

    expect(await screen.findByText('No process is sampling')).toBeInTheDocument()
    expect(screen.getByText(/No sample yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('switch'))
    fireEvent.click(screen.getByRole('button', { name: /Save/ }))
    await waitFor(() => expect(screen.getByText('Invalid settings')).toBeInTheDocument())
  })

  it('shows the error of a failed load', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) })
    renderWithProviders(<VdcUsageHistorySettings />)

    expect(await screen.findByText('Forbidden')).toBeInTheDocument()
  })
})
