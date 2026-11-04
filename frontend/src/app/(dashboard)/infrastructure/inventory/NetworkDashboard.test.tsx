/**
 * The guests behind each count of Inventory > Network (#1290): a VNet, host
 * bridge or VLAN row unfolds the guests attached to it, and a guest opens in
 * the inventory.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { fireEvent, renderWithProviders, screen, within } from '@/__tests__/setup/renderWithProviders'

import NetworkDashboard from './NetworkDashboard'

const tenant = { isFullClusterView: true, currentTenant: { id: 'default' } }
vi.mock('@/contexts/TenantContext', () => ({ useTenant: () => tenant }))
vi.mock('./VnetsSection', () => ({ default: () => null }))
vi.mock('@/components/ChartContainer', () => ({ default: () => null }))

const fetchConnectionsNetworks = vi.fn()
vi.mock('@/lib/proxmox/fetchConnectionsNetworks', () => ({
  fetchConnectionsNetworks: (...args: unknown[]) => fetchConnectionsNetworks(...args),
}))

const guest = (vmid: string, name: string, node: string, nets: any[], type = 'qemu') =>
  ({ vmid, name, node, type, status: 'running', connId: 'c1', nets })

const DATA = {
  data: [
    guest('107', 'Rocky-vDC', 'pve2', [{ id: 'net0', bridge: 'v6bc065f' }]),
    guest('106', 'Debian-vDC', 'pve3', [{ id: 'net0', bridge: 'v6bc065f' }]),
    guest('105', 'Ubuntu', 'pve2', [{ id: 'net0', bridge: 'vmbr0', tag: 100 }]),
    guest('7202', 'acme-db-01', 'pve2', [{ id: 'net0', bridge: 'vmbr1' }]),
  ],
  bridges: [
    { connId: 'c1', node: 'pve2', iface: 'vmbr1', type: 'OVSBridge' },
    { connId: 'c1', node: 'pve3', iface: 'vmbr9', type: 'bridge' },
  ],
  vlans: [],
  sdnVnets: [{ connId: 'c1', vnet: 'v6bc065f', alias: 'lan', zone: 'zmsp', zoneType: 'vxlan', tag: 10000 }],
  vnetAliasesByConn: {},
  failedConnIds: [],
}

const HOSTS = [
  { key: 'c1:pve2', node: 'pve2', connId: 'c1', connName: 'PVE-PROD', status: 'online', vms: [] },
  { key: 'c1:pve3', node: 'pve3', connId: 'c1', connName: 'PVE-PROD', status: 'offline', vms: [] },
] as any

const cardOf = (el: HTMLElement) => el.closest('.MuiCard-root') as HTMLElement

beforeEach(() => {
  fetchConnectionsNetworks.mockResolvedValue(DATA)
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  fetchConnectionsNetworks.mockReset()
})

describe('NetworkDashboard: the guests behind each count (#1290)', () => {
  it('unfolds the guests of a VNet across its nodes and opens the one clicked', async () => {
    const onSelect = vi.fn()
    renderWithProviders(<NetworkDashboard connectionIds={['c1']} connectionNames={{ c1: 'PVE-PROD' }} hosts={HOSTS} onSelect={onSelect} />)

    const lanRow = await screen.findByRole('button', { name: 'Show or hide the guests on lan' })
    expect(lanRow.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText('Debian-vDC')).toBeNull()

    fireEvent.click(lanRow)
    expect(lanRow.getAttribute('aria-expanded')).toBe('true')
    const vnets = cardOf(lanRow)
    const rows = within(vnets).getAllByTestId('attached-guest-row')
    expect(rows.map(r => r.textContent)).toEqual(['Debian-vDC#106pve3net0', 'Rocky-vDC#107pve2net0'])
    // Each guest row names its node with the Proxmox logo.
    expect(vnets.querySelectorAll('img[src*="proxmox-logo"]')).toHaveLength(2)

    fireEvent.click(within(rows[1]).getByText('Rocky-vDC'))
    expect(onSelect).toHaveBeenCalledWith({ type: 'vm', id: 'c1:pve2:qemu:107' })

    // A guest row is a native button, so the keyboard reaches it without extra wiring.
    expect(rows[0].tagName).toBe('BUTTON')
    fireEvent.click(rows[0])
    expect(onSelect).toHaveBeenLastCalledWith({ type: 'vm', id: 'c1:pve3:qemu:106' })

    // Space folds the row back.
    fireEvent.keyDown(lanRow, { key: ' ' })
    expect(within(vnets).queryAllByTestId('attached-guest-row')).toEqual([])
  })

  it('unfolds the guests of a host bridge, and leaves a bridge without guest inert', async () => {
    renderWithProviders(<NetworkDashboard connectionIds={['c1']} connectionNames={{ c1: 'PVE-PROD' }} hosts={HOSTS} />)

    const vmbr1 = await screen.findByRole('button', { name: 'Show or hide the guests on vmbr1 (pve2)' })
    fireEvent.click(vmbr1)
    const bridges = cardOf(vmbr1)
    expect(within(bridges).getAllByTestId('attached-guest-row').map(r => r.textContent)).toEqual(['acme-db-01#7202pve2net0'])

    // vmbr9 carries no guest: no chevron, no button.
    expect(screen.queryByRole('button', { name: /vmbr9/ })).toBeNull()
    const vmbr9 = within(bridges).getAllByTestId('bridge-row').find(r => r.textContent?.includes('vmbr9'))!
    fireEvent.click(vmbr9)
    expect(within(bridges).getAllByTestId('attached-guest-row')).toHaveLength(1)
    // Every node of the table carries the Proxmox logo.
    expect(bridges.querySelectorAll('img[src*="proxmox-logo"]').length).toBeGreaterThanOrEqual(3)
  })

  it('unfolds the guests of a VLAN with the bridge they sit on', async () => {
    renderWithProviders(<NetworkDashboard connectionIds={['c1']} connectionNames={{ c1: 'PVE-PROD' }} />)

    const vlan100 = await screen.findByRole('button', { name: 'Show or hide the guests on VLAN 100' })
    fireEvent.click(vlan100)
    const vlans = cardOf(vlan100)
    expect(within(vlans).getByText('Bridge')).toBeTruthy()
    expect(within(vlans).getAllByTestId('attached-guest-row').map(r => r.textContent)).toEqual(['Ubuntu#105pve2net0vmbr0'])
  })
})
