/**
 * The Logs tab of a Proxmox VE connection (micro-segmentation, firewall log
 * collection): shown when editing a cluster under a licence that carries the
 * micro-segmentation, and opened directly when the dialog is asked to.
 */
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent } from '@/__tests__/setup/renderWithProviders'

const { useLicenseMock, tabProps } = vi.hoisted(() => ({ useLicenseMock: vi.fn(), tabProps: [] as any[] }))

vi.mock('@/contexts/LicenseContext', () => ({
  useLicense: () => useLicenseMock(),
  Features: { VMWARE_MIGRATION: 'vmware_migration', MICROSEGMENTATION: 'microsegmentation' },
}))
vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({ isProvider: true, currentTenant: { id: 'default' }, tenants: [] }),
}))
vi.mock('./connection/LogCollectionTab', () => ({
  default: (props: any) => {
    tabProps.push(props)

    return <div data-testid='log-collection-stub' data-active={String(props.active)} data-connection={props.connectionId} />
  },
}))

import ConnectionDialog from './ConnectionDialog'

const pve = { id: 'c1', name: 'PVE-PROD', type: 'pve', baseUrl: 'https://10.0.0.1:8006' }
const licensed = (...features: string[]) => useLicenseMock.mockReturnValue({ hasFeature: (f: string) => features.includes(f) })

beforeEach(() => {
  tabProps.length = 0
  licensed('microsegmentation')
})
afterEach(() => cleanup())

const tab = () => screen.queryByTestId('connection-tab-logs')

describe('ConnectionDialog Logs tab', () => {
  it('is offered when editing a cluster, and reads nothing until it is opened', () => {
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type='pve' initialData={pve as any} mode='edit' />)

    expect(tab()).toHaveTextContent('Logs')
    expect(screen.getByTestId('log-collection-stub')).toHaveAttribute('data-active', 'false')
    fireEvent.click(tab()!)
    expect(screen.getByTestId('log-collection-stub')).toHaveAttribute('data-active', 'true')
    expect(screen.getByTestId('log-collection-stub')).toHaveAttribute('data-connection', 'c1')
  })

  it('opens on the tab the dialog is asked for', () => {
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type='pve' initialData={pve as any} mode='edit' initialTab='logs' />)

    expect(tab()).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('log-collection-stub')).toHaveAttribute('data-active', 'true')
  })

  it('is not offered while a cluster is being created: it has no node yet', () => {
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type='pve' mode='create' />)

    expect(tab()).toBeNull()
    expect(screen.queryByTestId('log-collection-stub')).toBeNull()
  })

  it('is not offered for anything but a Proxmox VE cluster', () => {
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type='pbs' initialData={{ ...pve, type: 'pbs' } as any} mode='edit' />)

    expect(tab()).toBeNull()
  })

  it('is not offered without the micro-segmentation in the licence', () => {
    licensed('vmware_migration')
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type='pve' initialData={pve as any} mode='edit' />)

    expect(tab()).toBeNull()
  })

  it('falls back to General when asked for a tab that is not shown', () => {
    licensed()
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type='pve' initialData={pve as any} mode='edit' initialTab='logs' />)

    expect(screen.getByTestId('connection-tab-general')).toHaveAttribute('aria-selected', 'true')
  })

  it('keeps the save of the connection form apart from the log collection', () => {
    renderWithProviders(<ConnectionDialog open onClose={vi.fn()} onSave={vi.fn()} type='pve' initialData={pve as any} mode='edit' initialTab='logs' />)

    // The tab applies its own settings: the footer of the dialog still saves the connection only.
    expect(tabProps.at(-1)).toMatchObject({ connectionId: 'c1', active: true })
    expect(Object.keys(tabProps.at(-1)).sort()).toEqual(['active', 'connectionId'])
  })
})
