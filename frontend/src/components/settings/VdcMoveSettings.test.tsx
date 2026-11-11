import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'
import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

import VdcMoveSettings from './VdcMoveSettings'

const fetchMock = vi.fn()

afterEach(() => { cleanup() })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async (_u: string, init?: any) => ({
    ok: true,
    status: 200,
    json: async () => ({ data: init?.body ? JSON.parse(init.body) : { tenantSelfService: true, maxConcurrentPerTenant: 1, bwlimitMiBps: 0 } }),
  }))
})

describe('VdcMoveSettings', () => {
  it('saves the switch as soon as it changes', async () => {
    renderWithProviders(<VdcMoveSettings />)
    const toggle = await screen.findByRole('checkbox', { name: 'Tenants move their VMs themselves' })
    fireEvent.click(toggle)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/settings/vdc-moves', expect.objectContaining({ method: 'PUT' })))
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ tenantSelfService: false, maxConcurrentPerTenant: 1, bwlimitMiBps: 0 })
    expect(await screen.findByText('Move settings saved')).toBeTruthy()
  })

  it('saves a number on blur and not an invalid one', async () => {
    renderWithProviders(<VdcMoveSettings />)
    const max = await screen.findByRole('spinbutton', { name: 'Moves at once per tenant' })
    fireEvent.change(max, { target: { value: '0' } })
    fireEvent.blur(max)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const bw = screen.getByRole('spinbutton', { name: 'Copy bandwidth limit (MiB/s)' })
    fireEvent.change(max, { target: { value: '3' } })
    fireEvent.blur(max)
    fireEvent.change(bw, { target: { value: '250' } })
    fireEvent.blur(bw)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ tenantSelfService: true, maxConcurrentPerTenant: 3, bwlimitMiBps: 250 })
  })

  it('shows a load error', async () => {
    fetchMock.mockImplementation(async () => ({ ok: false, status: 403, json: async () => ({ error: 'Forbidden' }) }))
    renderWithProviders(<VdcMoveSettings />)
    expect(await screen.findByText('Forbidden')).toBeTruthy()
  })
})
