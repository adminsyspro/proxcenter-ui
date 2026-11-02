/**
 * The ceph-exporter port of a PVE connection (Ceph cockpit, per-OSD I/O):
 * edited in the General tab, 9926 by default, PVE only.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
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

const pve = { id: 'c1', name: 'PVE-PROD', type: 'pve', baseUrl: 'https://10.0.0.1:8006', cephExporterPort: 9100 }

beforeEach(() => useLicenseMock.mockReturnValue({ hasFeature: () => false }))
afterEach(() => cleanup())

const field = () => screen.getByTestId('connection-ceph-exporter-port').querySelector('input') as HTMLInputElement

describe('ConnectionDialog ceph-exporter port', () => {
  it('shows the saved port, and 9926 for a connection that has none', () => {
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pve" initialData={pve as any} mode="edit" />)
    expect(field().value).toBe('9100')
    cleanup()
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pve" mode="create" />)
    expect(field().value).toBe('9926')
  })

  it('is not offered for a PBS', () => {
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type="pbs" mode="create" />)
    expect(screen.queryByTestId('connection-ceph-exporter-port')).toBeNull()
  })

  it('sends the edited port on save', async () => {
    const onSave = vi.fn<(d: any) => Promise<void>>().mockResolvedValue(undefined)
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={onSave} type="pve" initialData={pve as any} mode="edit" />)
    fireEvent.change(field(), { target: { value: '9200' } })
    fireEvent.click(screen.getByRole('button', { name: /save|update/i }))
    await waitFor(() => expect(onSave).toHaveBeenCalled())
    expect(onSave.mock.calls[0][0].cephExporterPort).toBe(9200)
  })
})
