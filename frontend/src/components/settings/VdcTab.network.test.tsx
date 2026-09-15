/**
 * Component tests for the Network tab of the vDC edit dialog (#899, #901):
 * the zone status against Proxmox, the VXLAN transport section in its three
 * modes, the node addresses with their interface state, provisioning, the
 * stretched networks the vDC carries, and the delete confirmation.
 *
 * The create flow and the storage policies live in VdcTab.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor, within } from '@/__tests__/setup/renderWithProviders'
import VdcTab from '@/components/settings/VdcTab'

const TENANTS = [
  { id: 'default', name: 'Provider', slug: 'default' },
  { id: 't1', name: 'ACME', slug: 'acme' },
]
const CONNECTIONS = [{ id: 'c1', name: 'paris', type: 'pve', inProviderPool: true }]

/** Saved transport: VLAN 4000 on vmbr0, one node addressed, a router as extra peer. */
const TRANSPORT = {
  mode: 'transport',
  peers: ['198.51.100.254'],
  mtu: 1450,
  vlanId: 4000,
  device: 'vmbr0',
  cidr: '198.51.100.0/24',
  nodeAddresses: { pve1: '198.51.100.1' },
}

const VDC = {
  id: 'vdc-z',
  name: 'ACME — paris',
  slug: 'acme-paris',
  tenantId: 't1',
  connectionId: 'c1',
  nodes: ['pve1', 'pve2'],
  primaryStorage: 'shared-nfs',
  enabled: true,
  quota: {},
  usage: { usedVms: 0 },
  storagePolicies: [],
  sdnZoneName: 'zacme',
  pvePoolName: 'acme-paris',
  vnets: [{ pveName: 'v1' }],
  transport: TRANSPORT,
}

const NODE_ADDRESSES = {
  nodes: [
    { name: 'pve1', online: true, clusterIp: '203.0.113.11', addresses: ['203.0.113.11', '198.51.100.1'], ifaces: [{ iface: 'vmbr0', type: 'bridge', mtu: 1500, cidr: '203.0.113.11/24' }] },
    { name: 'pve2', online: true, clusterIp: '203.0.113.12', addresses: ['203.0.113.12'], ifaces: [{ iface: 'vmbr0', type: 'bridge', mtu: 1500, cidr: '203.0.113.12/24' }] },
  ],
  devices: ['vmbr0'],
}

const ZONE_OUT_OF_SYNC = {
  zoneName: 'zacme',
  desired: { peers: ['198.51.100.1', '198.51.100.254'], mtu: 1450 },
  live: { type: 'vxlan', peers: ['198.51.100.1'], mtu: 1400, state: 'changed', pending: {} },
  inSync: false,
}
const ZONE_IN_SYNC = {
  ...ZONE_OUT_OF_SYNC,
  live: { ...ZONE_OUT_OF_SYNC.live, peers: ZONE_OUT_OF_SYNC.desired.peers, mtu: 1450, state: null },
  inSync: true,
  changed: true,
}

const STRETCHED = [
  { id: 'n1', name: 'backbone', vni: 10002, pveName: 'v32cf5fc', members: [{ vdcId: 'vdc-z', pveName: 'v32cf5fc' }] },
  // Carried by another vDC of the tenant only: not shown here.
  { id: 'n2', name: 'other', vni: 10003, pveName: 'v1ffa358', members: [{ vdcId: 'vdc-other', pveName: 'v1ffa358' }] },
]

let putBody: any
let deleted: string[]
let posts: string[]
let provisioned: boolean

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  putBody = undefined
  deleted = []
  posts = []
  provisioned = false
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url.endsWith('/api/v1/admin/vdcs/vdc-z') && method === 'PUT') {
      putBody = JSON.parse(init.body)
      return jsonRes({ data: { ...VDC, ...putBody } })
    }
    if (url.endsWith('/api/v1/admin/vdcs/vdc-z') && method === 'DELETE') {
      deleted.push(url)
      return jsonRes({ data: { success: true } })
    }
    if (url.includes('/vdcs/vdc-z/usage')) return jsonRes({ data: { usage: { usedVms: 0 } } })
    if (url.endsWith('/vdcs/vdc-z/zone')) {
      if (method === 'POST') { posts.push('zone'); return jsonRes({ data: ZONE_IN_SYNC }) }
      return jsonRes({ data: ZONE_OUT_OF_SYNC })
    }
    if (url.endsWith('/vdcs/vdc-z/transport/provision')) {
      if (method === 'POST') {
        posts.push('provision')
        provisioned = true
        return jsonRes({ data: { results: [{ node: 'pve1', iface: 'vmbr0.4000', action: 'unchanged' }, { node: 'pve2', iface: 'vmbr0.4000', action: 'created' }] } })
      }
      return jsonRes({ data: { nodes: [
        { node: 'pve1', iface: 'vmbr0.4000', state: 'provisioned', wanted: '198.51.100.1/24', found: '198.51.100.1/24' },
        { node: 'pve2', iface: 'vmbr0.4000', state: provisioned ? 'provisioned' : 'missing', wanted: '198.51.100.2/24', found: provisioned ? '198.51.100.2/24' : null },
      ] } })
    }
    if (url.endsWith('/api/v1/admin/vdcs')) return jsonRes({ data: [VDC] })
    if (url.includes('/node-addresses')) return jsonRes({ data: NODE_ADDRESSES })
    if (url.includes('/api/v1/admin/tenant-networks?tenantId=t1')) return jsonRes({ data: STRETCHED })
    if (url.includes('/users')) return jsonRes({ data: [] })
    if (url.endsWith('/api/v1/tenants')) return jsonRes({ data: TENANTS })
    if (url.includes('type=pve')) return jsonRes({ data: CONNECTIONS })
    if (url.includes('type=pbs')) return jsonRes({ data: [] })
    if (url.includes('available-resources')) {
      return jsonRes({ data: { nodes: [{ name: 'pve1', status: 'online' }, { name: 'pve2', status: 'online' }], storages: [{ id: 'shared-nfs', type: 'nfs', maxdisk: 1000 }] } })
    }
    return jsonRes({ data: [] })
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function vdcRow() {
  return screen.findByText(/^ACME/).then((cell) => cell.closest('[role="row"]') as HTMLElement)
}

/** Open the edit dialog of the vDC on its Network tab. */
async function openNetworkTab() {
  renderWithProviders(<VdcTab />)
  const row = await vdcRow()
  fireEvent.click(row.querySelector('.ri-pencil-line')?.closest('button') as HTMLElement)
  const dialog = await screen.findByRole('dialog')
  const scope = within(dialog)
  fireEvent.click(scope.getByRole('tab', { name: /network/i }))
  await scope.findByText('VXLAN transport')
  return { dialog, scope }
}

const addressField = (scope: ReturnType<typeof within>, node: string) =>
  scope.getByLabelText(`${node}: Address on the segment`) as HTMLInputElement

describe('VdcTab: Network tab of the edit dialog', () => {
  it('shows the zone against Proxmox, the state of each node interface and the stretched networks', async () => {
    const { dialog, scope } = await openNetworkTab()

    expect(scope.getByText('zacme')).toBeInTheDocument()
    await scope.findByText('Out of sync')
    expect(scope.getByText('Pending apply')).toBeInTheDocument()
    expect(scope.getByText('Peers on Proxmox')).toBeInTheDocument()
    expect(scope.getByText('Expected')).toBeInTheDocument()
    expect(scope.getByText('MTU 1400')).toBeInTheDocument()

    // The saved node address is hydrated, the second node is still empty.
    expect(addressField(scope, 'pve1').value).toBe('198.51.100.1')
    expect(addressField(scope, 'pve2').value).toBe('')
    expect(scope.getByText(/Interface on each node: vmbr0\.4000\./)).toBeInTheDocument()

    // Interface state read from the nodes: provisioned on pve1, missing on pve2.
    await waitFor(() => expect(dialog.querySelector('.ri-checkbox-circle-fill')).not.toBeNull())
    expect(dialog.querySelector('.ri-error-warning-fill')).not.toBeNull()

    // Only the stretched networks this vDC carries.
    await scope.findByText('backbone · VNI 10002 · v32cf5fc')
    expect(scope.queryByText(/other · VNI/)).toBeNull()
  })

  it('fills the node addresses sequentially from the segment and sends the transport with the vDC', async () => {
    const { scope } = await openNetworkTab()

    fireEvent.click(scope.getByRole('button', { name: 'Fill sequentially' }))
    expect(addressField(scope, 'pve1').value).toBe('198.51.100.1')
    expect(addressField(scope, 'pve2').value).toBe('198.51.100.2')

    // The form now differs from what is saved: Sync waits for a save.
    expect((scope.getByRole('button', { name: 'Sync zone' }) as HTMLButtonElement).disabled).toBe(true)

    const saveBtn = scope.getByRole('button', { name: 'Update' })
    await waitFor(() => expect(saveBtn.hasAttribute('disabled')).toBe(false))
    fireEvent.click(saveBtn)

    await waitFor(() => expect(putBody).toBeDefined())
    expect(putBody.transport).toEqual({ ...TRANSPORT, nodeAddresses: { pve1: '198.51.100.1', pve2: '198.51.100.2' } })
  })

  it('syncs the zone, then provisions the transport interface on the nodes', async () => {
    const { dialog, scope } = await openNetworkTab()
    await scope.findByText('Out of sync')

    const syncBtn = scope.getByRole('button', { name: 'Sync zone' }) as HTMLButtonElement
    await waitFor(() => expect(syncBtn.disabled).toBe(false))
    fireEvent.click(syncBtn)
    await scope.findByText('Zone updated and applied')
    expect(scope.getByText('In sync')).toBeInTheDocument()
    expect(posts).toEqual(['zone'])

    const provisionBtn = scope.getByRole('button', { name: 'Provision on nodes' }) as HTMLButtonElement
    await waitFor(() => expect(provisionBtn.disabled).toBe(false))
    fireEvent.click(provisionBtn)
    await waitFor(() => expect(posts).toContain('provision'))

    // Every node now carries the interface: nothing left to provision.
    await waitFor(() => expect(dialog.querySelectorAll('.ri-checkbox-circle-fill').length).toBe(2))
    await waitFor(() => expect((scope.getByRole('button', { name: 'Provision on nodes' }) as HTMLButtonElement).disabled).toBe(true))
  })

  it('flags a malformed or off-segment node address, and points at nodes missing from a peer list', async () => {
    const { scope } = await openNetworkTab()

    fireEvent.change(addressField(scope, 'pve2'), { target: { value: 'not-an-ip' } })
    expect(scope.getByText('"not-an-ip" is not a valid IPv4 or IPv6 address.')).toBeInTheDocument()
    fireEvent.change(addressField(scope, 'pve2'), { target: { value: '203.0.113.99' } })
    expect(scope.getByText('Outside the segment')).toBeInTheDocument()

    // Peer list mode: every peer typed by hand; a node left out is named.
    fireEvent.mouseDown(scope.getByLabelText('Transport mode'))
    fireEvent.click(await screen.findByRole('option', { name: 'Peer list' }))
    const peers = scope.getByLabelText('Peer addresses')
    fireEvent.change(peers, { target: { value: '203.0.113.11, 198.51.100.254' } })
    expect(scope.getByText(/Nodes without an address in the list: pve2\./)).toBeInTheDocument()
    fireEvent.change(peers, { target: { value: '203.0.113.11\ngarbage' } })
    expect(scope.getByText('"garbage" is not a valid IPv4 or IPv6 address.')).toBeInTheDocument()

    // Cluster mode: the corosync addresses feed the drawing, nothing to type.
    fireEvent.mouseDown(scope.getByLabelText('Transport mode'))
    fireEvent.click(await screen.findByRole('option', { name: 'Cluster network' }))
    expect(scope.queryByLabelText('Peer addresses')).toBeNull()
    expect(scope.getByRole('img', { name: /Peers are the cluster node addresses/ }).textContent).toContain('203.0.113.12')
  })

  it('deletes the vDC after confirmation', async () => {
    renderWithProviders(<VdcTab />)
    const row = await vdcRow()
    fireEvent.click(row.querySelector('.ri-delete-bin-line')?.closest('button') as HTMLElement)

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Delete vDC "ACME — paris"?')).toBeInTheDocument()
    expect(within(dialog).getByText(/The PVE pool "acme-paris" will also be removed/)).toBeInTheDocument()

    const confirmBtn = within(dialog).getByRole('button', { name: 'Delete' }) as HTMLButtonElement
    await waitFor(() => expect(confirmBtn.disabled).toBe(false))
    fireEvent.click(confirmBtn)

    await waitFor(() => expect(deleted).toHaveLength(1))
    await screen.findByText('vDC deleted successfully')
  })
})
