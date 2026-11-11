/**
 * ui#1332: the bulk migration limits are set per connection, Enterprise only:
 * migrations into the cluster and into one node on a PVE target, migrations
 * reading from one ESXi host on a VMware source.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'

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

const pve = { id: 'c1', name: 'PVE-PROD', type: 'pve', baseUrl: 'https://10.0.0.1:8006', migrationMaxParallel: 12, migrationMaxPerNode: null }
const vcenter = { id: 'v1', name: 'vCenter', type: 'vmware', subType: 'vcenter', baseUrl: 'https://10.0.0.20', migrationMaxPerSourceHost: null }

beforeEach(() => useLicenseMock.mockReset())
afterEach(() => cleanup())

describe('ConnectionDialog bulk migration limits (ui#1332)', () => {
  it('shows the cluster limit saved on a PVE target and the per-node default', () => {
    licensed(true)
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pve" initialData={pve as any} mode="edit" migrationSourcesConfigured />)
    fireEvent.click(screen.getByTestId('connection-tab-migrations'))
    expect(screen.getByTestId('connection-migrationMaxParallel-value')).toHaveTextContent('12')
    expect(screen.getByTestId('connection-migrationMaxPerNode-value')).toHaveTextContent('2')
    expect(screen.queryByTestId('connection-migrationMaxPerSourceHost')).toBeNull()
  })

  it('sends the edited limits of a PVE target on save', async () => {
    licensed(true)
    const onSave = vi.fn<(d: any) => Promise<void>>().mockResolvedValue(undefined)
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={onSave} type="pve" initialData={pve as any} mode="edit" migrationSourcesConfigured />)
    fireEvent.click(screen.getByTestId('connection-tab-migrations'))
    fireEvent.change(screen.getByTestId('connection-migrationMaxPerNode'), { target: { value: 4 } })
    await waitFor(() => expect(screen.getByTestId('connection-migrationMaxPerNode-value')).toHaveTextContent('4'))
    fireEvent.click(screen.getByRole('button', { name: /save|update/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0]).toMatchObject({ migrationMaxParallel: 12, migrationMaxPerNode: 4 })
  })

  it('offers the per-host limit of a VMware source in its own Migrations tab, without the PVE target settings', () => {
    licensed(true)
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="vmware" initialData={vcenter as any} mode="edit" />)
    fireEvent.click(screen.getByTestId('connection-tab-migrations'))
    expect(screen.getByTestId('connection-migrationMaxPerSourceHost-value')).toHaveTextContent('4')
    expect(screen.queryByTestId('connection-warm-zero-rate-limit')).toBeNull()
    expect(screen.queryByTestId('connection-migrationMaxParallel')).toBeNull()
  })

  it('is not offered on Community', () => {
    licensed(false)
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="vmware" initialData={vcenter as any} mode="edit" />)
    expect(screen.queryByTestId('connection-tab-migrations')).toBeNull()
  })
})
