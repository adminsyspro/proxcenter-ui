/**
 * The provider-only owner selector loads the MSP tenants when the dialog opens.
 * A reply landing after the dialog closed or unmounted must be dropped.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, waitFor } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => ({ hasFeature: () => false }),
  Features: { VMWARE_MIGRATION: 'vmware_migration' },
}))
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ isProvider: true, currentTenant: { id: 'default' }, tenants: [] }),
}))

import ConnectionDialog from './ConnectionDialog'

const tenantsReply = {
  data: [
    { id: 't1', name: 'Acme', operatingModel: 'msp', enabled: true },
    { id: 't2', name: 'Off', operatingModel: 'msp', enabled: false },
    { id: 't3', name: 'Shared', operatingModel: 'shared', enabled: true },
  ],
}

// fetch stub whose reply is released by the test.
function deferredFetch() {
  let release: (body: unknown) => void = () => {}
  const reply = new Promise<unknown>(resolve => { release = resolve })
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    reply.then(body => ({ ok: true, json: async () => body }))
  )
  vi.stubGlobal('fetch', fetchMock)
  return { fetchMock, release }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ConnectionDialog owner tenants', () => {
  it('lists the enabled MSP tenants as owners', async () => {
    const { fetchMock, release } = deferredFetch()
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pbs" mode="create" />)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/tenants', expect.objectContaining({ signal: expect.any(AbortSignal) }))

    release(tenantsReply)
    await waitFor(() => expect(screen.getAllByText('Owner').length).toBeGreaterThan(0))
  })

  it('drops the reply once the dialog is unmounted', async () => {
    const { fetchMock, release } = deferredFetch()
    const { unmount } = renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pbs" mode="create" />)
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal

    unmount()
    expect(signal.aborted).toBe(true)
    release(tenantsReply)
    await expect(fetchMock.mock.results[0].value).resolves.toBeDefined()
  })

  it('drops the reply once the dialog is closed', async () => {
    const { fetchMock, release } = deferredFetch()
    const { rerender } = renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pbs" mode="create" />)
    const signal = fetchMock.mock.calls[0][1]?.signal as AbortSignal

    rerender(<ConnectionDialog open={false} onClose={vi.fn()} onSave={vi.fn()} type="pbs" mode="create" />)
    expect(signal.aborted).toBe(true)
    release(tenantsReply)
    await fetchMock.mock.results[0].value
    expect(screen.queryByText('Owner')).toBeNull()
  })
})
