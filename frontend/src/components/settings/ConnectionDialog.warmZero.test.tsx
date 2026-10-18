/**
 * roadmap#45: the thick zeroing cap of warm migrations is a setting of the
 * TARGET PVE connection, Enterprise only. Community never shows it.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'

const { useLicenseMock } = vi.hoisted(() => ({ useLicenseMock: vi.fn() }))

vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => useLicenseMock(),
  Features: { VMWARE_MIGRATION: 'vmware_migration' },
}))
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ isProvider: true, currentTenant: { id: 'default' }, tenants: [] }),
}))

import ConnectionDialog from './ConnectionDialog'

const licensed = (on: boolean) => useLicenseMock.mockReturnValue({ hasFeature: (id: string) => on && id === 'vmware_migration' })

const pve = { id: 'c1', name: 'PVE-PROD', type: 'pve', baseUrl: 'https://10.0.0.1:8006', warmZeroRateLimitMBps: 300 }

beforeEach(() => useLicenseMock.mockReset())
afterEach(() => cleanup())

describe('ConnectionDialog warm zeroing cap (roadmap#45)', () => {
  it('is hidden on Community', () => {
    licensed(false)
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pve" initialData={pve as any} mode="edit" migrationSourcesConfigured />)
    expect(screen.queryByTestId('connection-warm-zero-rate-limit')).toBeNull()
  })

  it('is hidden for a source hypervisor even on Enterprise', () => {
    licensed(true)
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="vmware" mode="create" />)
    expect(screen.queryByTestId('connection-warm-zero-rate-limit')).toBeNull()
  })

  it('edits the cap of a PVE target on Enterprise with a slider, in its own Migrations tab', async () => {
    licensed(true)
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pve" initialData={pve as any} mode="edit" migrationSourcesConfigured />)
    // The section lives in the Migrations tab; General opens first.
    expect(screen.getByTestId('connection-tab-migrations')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('connection-tab-migrations'))
    expect(screen.getByTestId('connection-warm-zero-rate-value')).toHaveTextContent('300 MB/s')

    const slider = screen.getByTestId('connection-warm-zero-rate-limit') as HTMLInputElement
    fireEvent.change(slider, { target: { value: '150' } })
    await waitFor(() => expect(screen.getByTestId('connection-warm-zero-rate-value')).toHaveTextContent('150 MB/s'))

    fireEvent.change(slider, { target: { value: '0' } })
    await waitFor(() => expect(screen.getByTestId('connection-warm-zero-rate-value')).toHaveTextContent('Unlimited'))
  })

  it('edits the post-copy integrity check in the Migrations tab, with its cost per disk', async () => {
    licensed(true)
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pve" initialData={pve as any} mode="edit" migrationSourcesConfigured />)
    fireEvent.click(screen.getByTestId('connection-tab-migrations'))
    expect(screen.getByTestId('connection-integrityRegionCount-value')).toHaveTextContent('8')
    expect(screen.getByTestId('connection-integrity-cost')).toHaveTextContent('about 2 s per disk')
    fireEvent.change(screen.getByTestId('connection-integrityRegionSizeMiB'), { target: { value: 16 } })
    await waitFor(() => expect(screen.getByTestId('connection-integrity-cost')).toHaveTextContent('about 6 s per disk'))
    fireEvent.click(within(screen.getByTestId('connection-integrity-enabled')).getByRole('switch'))
    await waitFor(() => expect(screen.getByTestId('connection-integrity-cost')).toHaveTextContent('Off: disks are handed over unverified'))
  })

  it('hides the Migrations tab while no source hypervisor is configured', () => {
    licensed(true)
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pve" initialData={pve as any} mode="edit" />)
    expect(screen.getByTestId('connection-tab-siteRecovery')).toBeInTheDocument()
    expect(screen.queryByTestId('connection-tab-migrations')).toBeNull()
  })

  it('shows only the tabs that apply: no Migrations or Site Recovery tab for a PBS', () => {
    licensed(true)
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pbs" mode="create" migrationSourcesConfigured />)
    expect(screen.getByTestId('connection-tab-general')).toBeInTheDocument()
    expect(screen.queryByTestId('connection-tab-migrations')).toBeNull()
    expect(screen.queryByTestId('connection-tab-siteRecovery')).toBeNull()
    expect(screen.getByTestId('connection-tab-location')).toBeInTheDocument()
  })
})
