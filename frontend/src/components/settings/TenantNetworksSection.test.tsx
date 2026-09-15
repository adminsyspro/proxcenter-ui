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
  // Carried by both clusters: the only one whose reachability can be tested.
  {
    id: 'n3', tenantId: 't1', tenantName: 'Acme', name: 'mesh', description: 'east-west', pveName: 'v2a1b3c4', vni: 10005, mtu: null,
    subnet: { ...SUBNET, id: 's3', cidr: '10.79.0.0/24', gateway: '10.79.0.1' },
    members: [
      { vdcId: 'v1', vdcName: 'Acme prod', connectionId: 'c1', connectionName: 'paris', pveName: 'v2a1b3c4', zoneName: 'zacme' },
      { vdcId: 'v2', vdcName: 'Acme DR', connectionId: 'c2', connectionName: 'frankfurt', pveName: 'v2a1b3c4', zoneName: 'zacmedr' },
    ],
  },
]

const REACHABILITY = [
  { vdcId: 'v1', vdcName: 'Acme prod', connectionId: 'c1', connectionName: 'paris', node: 'pve1', peer: '198.51.100.11', state: 'reachable' },
  { vdcId: 'v1', vdcName: 'Acme prod', connectionId: 'c1', connectionName: 'paris', node: 'pve1', peer: '198.51.100.12', state: 'unreachable', message: 'no answer' },
  { vdcId: 'v2', vdcName: 'Acme DR', connectionId: 'c2', connectionName: 'frankfurt', node: 'pve1-dr', peer: '203.0.113.11', state: 'unavailable', message: 'ssh: connection refused' },
]

let posted: any
let memberPosted: any
let putBody: any
let deletedUrls: string[]
let syncPosted: string[]
let reachabilityFails: boolean

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  posted = undefined
  memberPosted = undefined
  putBody = undefined
  deletedUrls = []
  syncPosted = []
  reachabilityFails = false
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.endsWith('/api/v1/admin/tenant-networks') && method === 'POST') {
      posted = JSON.parse(init.body)
      return jsonRes({ data: { ...NETWORKS[1], id: 'n9', name: posted.name, vni: 10004 } }, 201)
    }
    if (url.endsWith('/members') && method === 'POST') {
      memberPosted = JSON.parse(init.body)
      return jsonRes({ data: { vdcId: memberPosted.vdcId, vnetId: 'vn', pveName: 'v32cf5fc', zoneSync: [] } }, 201)
    }
    if (url.includes('/members?vdcId=') && method === 'DELETE') {
      deletedUrls.push(url)
      // The other member's zone could not be rewritten: reported, not fatal.
      return jsonRes({ data: { zoneSync: [{ vdcId: 'v2', vdcName: 'Acme DR', connectionId: 'c2', zoneName: 'zacmedr', changed: false, error: 'ifreload failed' }] } })
    }
    if (url.endsWith('/api/v1/admin/tenant-networks/n2') && method === 'PUT') {
      putBody = JSON.parse(init.body)
      return jsonRes({ data: { ...NETWORKS[1], ...putBody } })
    }
    if (url.endsWith('/api/v1/admin/tenant-networks/n2') && method === 'DELETE') {
      deletedUrls.push(url)
      return jsonRes({ data: { success: true } })
    }
    if (url.endsWith('/sync') && method === 'POST') {
      syncPosted.push(url)
      return jsonRes({ data: { zoneSync: [
        { vdcId: 'v1', vdcName: 'Acme prod', connectionId: 'c1', zoneName: 'zacme', changed: true },
        { vdcId: 'v2', vdcName: 'Acme DR', connectionId: 'c2', zoneName: 'zacmedr', changed: false },
      ] } })
    }
    if (url.endsWith('/reachability') && method === 'POST') {
      if (reachabilityFails) return jsonRes({ error: 'No SSH access to the nodes' }, 502)
      return jsonRes({ data: { results: REACHABILITY } })
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
    // backbone and mesh both run on the paris vDC.
    expect(screen.getAllByText('paris · Acme prod')).toHaveLength(2)
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

  it('edits a network: tenant, VNI and CIDR are frozen, only name, description, MTU and DNS are sent', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('spare')).toBeTruthy())
    // Second row: spare, which no vDC carries, so its MTU is still editable.
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit tenant network' })[1])
    const dialog = await screen.findByRole('dialog')
    const scope = within(dialog)
    expect(scope.getByText('Edit tenant network')).toBeTruthy()
    expect((scope.getByLabelText('VNI') as HTMLInputElement).disabled).toBe(true)
    expect((scope.getByLabelText('CIDR') as HTMLInputElement).disabled).toBe(true)
    expect((scope.getByLabelText('CIDR') as HTMLInputElement).value).toBe('10.78.0.0/24')

    fireEvent.change(scope.getByLabelText('Name'), { target: { value: 'spare2' } })
    fireEvent.change(scope.getByLabelText('Description'), { target: { value: 'kept aside' } })
    fireEvent.change(scope.getByLabelText('Zone MTU'), { target: { value: '1450' } })
    fireEvent.change(scope.getByLabelText('DNS servers'), { target: { value: '9.9.9.9 149.112.112.112' } })
    fireEvent.click(scope.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(putBody).toBeTruthy())
    expect(putBody).toEqual({ name: 'spare2', description: 'kept aside', mtu: 1450, subnet: { dnsServers: ['9.9.9.9', '149.112.112.112'] } })
    await waitFor(() => expect(screen.getByText('Tenant network "spare2" updated')).toBeTruthy())
  })

  it('keeps the MTU frozen while a vDC carries the network, and surfaces a refused save in the dialog', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('backbone')).toBeTruthy())
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit tenant network' })[0])
    const dialog = await screen.findByRole('dialog')
    const scope = within(dialog)
    expect((scope.getByLabelText('Zone MTU') as HTMLInputElement).disabled).toBe(true)

    // The server refuses: the message stays in the dialog, which stays open.
    ;(globalThis.fetch as any).mockImplementationOnce(async () => jsonRes({ error: 'A network with this name already exists' }, 409))
    fireEvent.change(scope.getByLabelText('Name'), { target: { value: 'spare' } })
    fireEvent.click(scope.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(scope.getByText('A network with this name already exists')).toBeTruthy())
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('removes a member after confirmation and reports the zone that could not be rewritten', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('backbone')).toBeTruthy())
    // The chip's delete icon of the backbone member.
    fireEvent.click(screen.getAllByLabelText('Remove Acme prod')[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Remove a vDC from the network')).toBeTruthy()
    expect(within(dialog).getByText(/Remove vDC "Acme prod" from "backbone"\?/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))

    await waitFor(() => expect(deletedUrls).toHaveLength(1))
    expect(deletedUrls[0]).toBe('/api/v1/admin/tenant-networks/n1/members?vdcId=v1')
    await waitFor(() => expect(screen.getByText(/vDC "Acme prod" no longer carries "backbone".*1 cluster\(s\) failed: frankfurt: ifreload failed/)).toBeTruthy())
  })

  it('deletes an empty network after confirmation, releasing its VNI', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('spare')).toBeTruthy())
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[1])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete a tenant network')).toBeTruthy()
    expect(within(dialog).getByText('Delete "spare"? The VNI 10003 is released.')).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(deletedUrls).toEqual(['/api/v1/admin/tenant-networks/n2']))
    await waitFor(() => expect(screen.getByText('Tenant network "spare" deleted')).toBeTruthy())
  })

  it('syncs the member zones and sums up what was rewritten', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('backbone')).toBeTruthy())
    fireEvent.click(screen.getAllByRole('button', { name: 'Sync zones' })[0])
    await waitFor(() => expect(syncPosted).toEqual(['/api/v1/admin/tenant-networks/n1/sync']))
    await waitFor(() => expect(screen.getByText('1 zone(s) rewritten, 1 already in sync')).toBeTruthy())
  })

  it('tests reachability only with two members, and groups the results per member node', async () => {
    mount()
    await waitFor(() => expect(screen.getByText('mesh')).toBeTruthy())
    const buttons = screen.getAllByRole('button', { name: 'Test reachability' }) as HTMLButtonElement[]
    expect(buttons[0].disabled).toBe(true)
    expect(buttons[2].disabled).toBe(false)
    fireEvent.click(buttons[2])

    const dialog = await screen.findByRole('dialog')
    const scope = within(dialog)
    expect(scope.getByText('Reachability of "mesh"')).toBeTruthy()
    await scope.findByText('1 of 3 peer checks reachable')
    // One row per node: the paris node ran two checks, the DR node answered no SSH.
    expect(scope.getByText('paris · Acme prod')).toBeTruthy()
    expect(scope.getByText('frankfurt · Acme DR')).toBeTruthy()
    expect(scope.getByText('pve1')).toBeTruthy()
    expect(scope.getByText('pve1-dr')).toBeTruthy()
    expect(scope.getByText('198.51.100.11')).toBeTruthy()
    expect(scope.getByText('198.51.100.12')).toBeTruthy()
    expect(scope.getByText('203.0.113.11')).toBeTruthy()

    fireEvent.click(scope.getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('shows the reachability failure in the dialog', async () => {
    reachabilityFails = true
    mount()
    await waitFor(() => expect(screen.getByText('mesh')).toBeTruthy())
    fireEvent.click(screen.getAllByRole('button', { name: 'Test reachability' })[2])
    const dialog = await screen.findByRole('dialog')
    await within(dialog).findByText('No SSH access to the nodes')
  })
})
