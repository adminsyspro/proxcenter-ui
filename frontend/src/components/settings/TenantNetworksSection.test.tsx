/**
 * Component tests for TenantNetworksSection.tsx (#901): the provider-only
 * surface of stretched tenant networks, rendered as the third tab of VdcTab.
 *
 * Covers: the table lists the networks with tenant, VNI, subnet and member
 * clusters; creating a network POSTs its subnet; the join picker offers only
 * the vDCs that can join; delete is disabled while vDCs carry the network.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import TenantNetworksSection from '@/components/settings/TenantNetworksSection'

const TENANTS = [
  { id: 'default', name: 'Default' },
  { id: 't1', name: 'Acme' },
  // No vDC at all: can never carry a network, so never offered.
  { id: 't2', name: 'Beta' },
]
const CONNECTIONS = [
  { id: 'c1', name: 'paris' },
  { id: 'c2', name: 'frankfurt' },
]
const VDCS = [
  { id: 'v1', tenantId: 't1', connectionId: 'c1', name: 'Acme prod', sdnZoneName: 'zacme', enabled: true },
  { id: 'v2', tenantId: 't1', connectionId: 'c2', name: 'Acme DR', sdnZoneName: 'zacmedr', enabled: true },
  // VLAN-only vDC: no VXLAN zone, never a candidate.
  { id: 'v3', tenantId: 't1', connectionId: 'c2', name: 'Acme vlan', sdnZoneName: null, enabled: true },
]
const SUBNET = { id: 's1', cidr: '10.77.0.0/24', gateway: '10.77.0.1', dnsServers: ['10.77.0.2'], ipamEnabled: true }
const NETWORKS = [
  {
    id: 'n1', tenantId: 't1', tenantName: 'Acme', name: 'backbone', description: null, pveName: 'v32cf5fc', vni: 10002, mtu: null,
    subnet: SUBNET,
    members: [{ vdcId: 'v1', vdcName: 'Acme prod', connectionId: 'c1', connectionName: 'paris', pveName: 'v32cf5fc', zoneName: 'zacme' }],
  },
  {
    id: 'n2', tenantId: 't1', tenantName: 'Acme', name: 'spare', description: null, pveName: 'v1ffa358', vni: 10003, mtu: 1400,
    subnet: { ...SUBNET, id: 's2', cidr: '10.78.0.0/24', gateway: '10.78.0.1' },
    members: [],
  },
]

let posted: any
let memberPosted: any

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  posted = undefined
  memberPosted = undefined
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input)
    if (url.endsWith('/api/v1/admin/tenant-networks') && init?.method === 'POST') {
      posted = JSON.parse(init.body)
      return jsonRes({ data: { ...NETWORKS[1], id: 'n3', name: posted.name, vni: 10004 } }, 201)
    }
    if (url.endsWith('/members') && init?.method === 'POST') {
      memberPosted = JSON.parse(init.body)
      return jsonRes({ data: { vdcId: memberPosted.vdcId, vnetId: 'vn', pveName: 'v32cf5fc', zoneSync: [] } }, 201)
    }
    if (url.endsWith('/api/v1/admin/tenant-networks')) return jsonRes({ data: NETWORKS })
    return jsonRes({ data: [] })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mount() {
  return renderWithProviders(<TenantNetworksSection tenants={TENANTS} vdcs={VDCS} connections={CONNECTIONS} />)
}

describe('TenantNetworksSection', () => {
  it('lists the networks with tenant, VNI, subnet and member clusters', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('backbone')).toBeTruthy())
    expect(screen.getAllByText('Acme').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('10002')).toBeTruthy()
    expect(screen.getByText('10.77.0.0/24 · 10.77.0.1')).toBeTruthy()
    expect(screen.getByText('paris · Acme prod')).toBeTruthy()
    // The empty network says so instead of showing chips.
    expect(screen.getByText('no vDC yet')).toBeTruthy()
  })

  it('offers only the tenants that own a vDC with a VXLAN zone', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('backbone')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /new tenant network/i }))
    const dialog = await screen.findByRole('dialog')
    // A MUI Select opens on mousedown, not on click.
    fireEvent.mouseDown(within(dialog).getByRole('combobox'))
    const listbox = await screen.findByRole('listbox')
    expect(within(listbox).getByText('Acme')).toBeTruthy()
    expect(within(listbox).queryByText('Beta')).toBeNull()
    expect(within(listbox).queryByText('Default')).toBeNull()
  })

  it('creates a network with its subnet', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('backbone')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /new tenant network/i }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'core' } })
    fireEvent.change(within(dialog).getByLabelText('CIDR'), { target: { value: '10.79.0.0/24' } })
    fireEvent.change(within(dialog).getByLabelText('Gateway'), { target: { value: '10.79.0.1' } })
    fireEvent.change(within(dialog).getByLabelText('DNS servers'), { target: { value: '1.1.1.1, 8.8.8.8' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }))
    await waitFor(() => expect(posted).toBeTruthy())
    expect(posted).toMatchObject({
      tenantId: 't1', name: 'core', vni: null, mtu: null,
      subnet: { cidr: '10.79.0.0/24', gateway: '10.79.0.1', dnsServers: ['1.1.1.1', '8.8.8.8'] },
    })
    await waitFor(() => expect(screen.getByText(/created with VNI 10004/)).toBeTruthy())
  })

  it('offers only the vDCs that can join, then posts the chosen one', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('backbone')).toBeTruthy())
    // A MUI Tooltip copies its title into aria-label on the wrapping span: query the buttons by role.
    const addButtons = screen.getAllByRole('button', { name: 'Add a vDC' })
    // First row is backbone: paris is taken by Acme prod, Acme vlan has no zone.
    fireEvent.click(addButtons[0])
    const menu = await screen.findByRole('menu')
    expect(within(menu).getByText('frankfurt · Acme DR')).toBeTruthy()
    expect(within(menu).queryByText(/Acme prod/)).toBeNull()
    expect(within(menu).queryByText(/Acme vlan/)).toBeNull()
    fireEvent.click(within(menu).getByText('frankfurt · Acme DR'))
    await waitFor(() => expect(memberPosted).toEqual({ vdcId: 'v2' }))
  })

  it('disables delete while vDCs carry the network, and sync when none does', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('backbone')).toBeTruthy())
    const deleteButtons = screen.getAllByRole('button', { name: 'Delete' }) as HTMLButtonElement[]
    expect(deleteButtons[0].disabled).toBe(true)
    expect(deleteButtons[1].disabled).toBe(false)
    const syncButtons = screen.getAllByRole('button', { name: 'Sync zones' }) as HTMLButtonElement[]
    expect(syncButtons[0].disabled).toBe(false)
    expect(syncButtons[1].disabled).toBe(true)
  })
})
