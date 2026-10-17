/**
 * Provider create flow: the owner selector lists the enabled MSP tenants,
 * and the tenants request is cancelled when the dialog unmounts, so its
 * answer never updates a component (or a test environment) that is gone.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => ({ hasFeature: () => false }),
  Features: { VMWARE_MIGRATION: 'vmware_migration' },
}))
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ isProvider: true, currentTenant: { id: 'default' }, tenants: [] }),
}))

import ConnectionDialog from './ConnectionDialog'

const tenants = {
  data: [
    { id: 'm1', name: 'MSP One', operatingModel: 'msp' },
    { id: 'i1', name: 'IaaS Tenant', operatingModel: 'iaas' },
    { id: 'm2', name: 'MSP Disabled', operatingModel: 'msp', enabled: false },
  ],
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ConnectionDialog owner tenants', () => {
  it('offers the provider pool and the enabled MSP tenants only', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => tenants })
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pve" mode="create" />)

    const select = await screen.findByRole('combobox', { name: /Owner/ })
    fireEvent.mouseDown(select)
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map(o => o.textContent)
    expect(options).toEqual(['Provider pool (shared)', 'MSP One'])
  })

  it('keeps the selector hidden when the tenants request fails', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pbs" mode="create" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/v1/tenants', expect.anything()))
    expect(screen.queryByRole('combobox', { name: /Owner/ })).toBeNull()
  })

  it('drops the tenants answer that lands after the dialog unmounts', async () => {
    let answer: (value: unknown) => void = () => {}
    fetchMock.mockReturnValue(new Promise(resolve => { answer = resolve }))
    const json = vi.fn(async () => tenants)
    const { unmount } = renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pve" mode="create" />)

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const { signal } = fetchMock.mock.calls[0][1] as RequestInit
    unmount()
    expect(signal?.aborted).toBe(true)

    answer({ ok: true, json })
    await waitFor(() => expect(json).toHaveBeenCalled())
    await new Promise(resolve => setTimeout(resolve, 0))
  })
})
