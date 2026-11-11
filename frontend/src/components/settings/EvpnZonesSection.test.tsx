/**
 * Component tests for EvpnZonesSection.tsx (#1334): the provider-only surface
 * of the EVPN zones shared between clusters, rendered as a tab of VdcTab.
 *
 * Covers: the table lists the zones with the state of each cluster; declaring
 * a zone discovers the ticked clusters, offers their controllers or a new
 * one, and POSTs the members; adopting an existing zone fills the form; a
 * cluster can be added, resynced and detached; the collision card lists the
 * shared VNIs and moves a ProxCenter network to a free one.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, within } from '@testing-library/react'

import { renderWithProviders, screen, fireEvent, waitFor } from '@/__tests__/setup/renderWithProviders'
import EvpnZonesSection from '@/components/settings/EvpnZonesSection'

const CONNECTIONS = [
  { id: 'c1', name: 'paris', type: 'pve' },
  { id: 'c2', name: 'lyon', type: 'pve' },
  { id: 'c3', name: 'nice', type: 'pve' },
  { id: 'b1', name: 'backup', type: 'pbs' },
]
const ZONE = {
  id: 'z1', name: 'Shared', description: 'core', zoneName: 'zshared', vrfVxlan: 9000, mtu: 1450, vniStart: 9001, vniEnd: 9099,
  members: [
    { id: 'm1', connectionId: 'c1', connectionName: 'paris', controller: 'evpn1', controllerCreated: false, adopted: true },
    { id: 'm2', connectionId: 'c2', connectionName: 'lyon', controller: 'evpnpxc', controllerCreated: true, adopted: false },
  ],
}
const STATUS = [
  { connectionId: 'c1', connectionName: 'paris', state: 'ok', detail: null, vnetCount: 0 },
  { connectionId: 'c2', connectionName: 'lyon', state: 'drift', detail: 'MTU 1400', vnetCount: 0 },
]
const DISCOVERY: Record<string, any> = {
  c1: { connectionId: 'c1', connectionName: 'paris', reachable: true, controllers: [{ controller: 'evpn1', asn: 65000, peers: ['10.0.1.1'] }], zones: [{ zone: 'zold', controller: 'evpn1', vrfVxlan: 5000, mtu: 1400 }], nodeIps: ['10.0.1.1'], nodesWithoutFrr: [] },
  c2: { connectionId: 'c2', connectionName: 'lyon', reachable: true, controllers: [], zones: [], nodeIps: ['10.0.2.1'], nodesWithoutFrr: ['n2'] },
  c3: { connectionId: 'c3', connectionName: 'nice', reachable: false, controllers: [], zones: [], nodeIps: [], nodesWithoutFrr: [] },
}
const COLLISION = {
  vni: 10001,
  exposed: true,
  holders: [
    { connectionId: 'c2', connectionName: 'lyon', zone: 'zb', zoneType: 'vxlan', vnet: 'vhand', alias: null, vdcVnetId: null, vdcName: null, tenantName: null, renumberable: false },
    { connectionId: 'c1', connectionName: 'paris', zone: 'za', zoneType: 'vxlan', vnet: 'vlan1', alias: 'dmz', vdcVnetId: 'vn-1', vdcName: 'Acme prod', tenantName: 'Acme', renumberable: true },
  ],
}

let zones: any[]
let collisions: any[]
let posted: any
let memberPosted: any
let putBody: any
let resynced: any
let renumbered: any
let deletedUrls: string[]
let createFails: string | null
let applyErrors: any[]

function jsonRes(body: any, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  zones = [ZONE]
  collisions = [COLLISION]
  posted = memberPosted = putBody = resynced = renumbered = undefined
  deletedUrls = []
  createFails = null
  applyErrors = []
  vi.stubGlobal('fetch', vi.fn(async (input: any, init?: any) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    if (url.includes('/evpn-zones/discover')) {
      const ids = decodeURIComponent(url.split('connectionIds=')[1]).split(',')
      return jsonRes({ data: ids.map(id => DISCOVERY[id]) })
    }
    if (url.endsWith('/evpn-zones/collisions') && method === 'GET') return jsonRes({ data: { collisions, unreachable: ['nice'] } })
    if (url.endsWith('/evpn-zones/collisions') && method === 'POST') {
      renumbered = JSON.parse(init.body)
      collisions = []
      return jsonRes({ data: { vdcVnetId: 'vn-1', previousVni: 10001, vni: 10003 } })
    }
    if (url.endsWith('/evpn-zones') && method === 'GET') return jsonRes({ data: zones })
    if (url.endsWith('/evpn-zones') && method === 'POST') {
      posted = JSON.parse(init.body)
      if (createFails) return jsonRes({ error: createFails }, 409)
      return jsonRes({ data: { ...ZONE, id: 'z9', name: posted.name }, applyErrors }, 201)
    }
    if (url.endsWith('/evpn-zones/z1/members') && method === 'POST') {
      memberPosted = JSON.parse(init.body)
      return jsonRes({ data: ZONE, applyErrors: [] }, 201)
    }
    if (url.endsWith('/evpn-zones/z1/members') && method === 'PUT') {
      resynced = JSON.parse(init.body)
      return jsonRes({ data: STATUS[0] })
    }
    if (url.includes('/evpn-zones/z1/members?connectionId=') && method === 'DELETE') {
      deletedUrls.push(url)
      return jsonRes({ data: ZONE, applyErrors: [{ connectionName: 'lyon', error: 'ifreload failed' }] })
    }
    if (url.endsWith('/evpn-zones/z1') && method === 'PUT') {
      putBody = JSON.parse(init.body)
      return jsonRes({ data: { ...ZONE, ...putBody } })
    }
    if (url.endsWith('/evpn-zones/z1') && method === 'DELETE') {
      deletedUrls.push(url)
      return jsonRes({ data: { success: true }, applyErrors: [] })
    }
    if (url.endsWith('/evpn-zones/z1')) return jsonRes({ data: { ...ZONE, status: STATUS } })
    return jsonRes({ error: `unexpected ${method} ${url}` }, 500)
  }))
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const dialog = () => screen.getByRole('dialog')
const type = (label: string, value: string) => fireEvent.change(within(dialog()).getByLabelText(label), { target: { value } })
const tick = (cluster: string) => fireEvent.click(within(dialog()).getByRole('checkbox', { name: new RegExp(cluster) }))

async function renderLoaded() {
  renderWithProviders(<EvpnZonesSection connections={CONNECTIONS} />)
  await screen.findByText('Shared')
}

describe('EvpnZonesSection', () => {
  it('lists the zones with their settings and the state of each cluster', async () => {
    await renderLoaded()
    const row = screen.getByText('Shared').closest('tr')!
    expect(within(row).getByText('zshared')).toBeInTheDocument()
    expect(within(row).getByText('9000')).toBeInTheDocument()
    expect(within(row).getByText('9001 - 9099')).toBeInTheDocument()
    expect(within(row).getByText('paris')).toBeInTheDocument()
    fireEvent.click(within(row).getByText('lyon'))
    expect(await screen.findByText('Differs from the declaration (MTU 1400)')).toBeInTheDocument()
  })

  it('shows the empty state and a load failure', async () => {
    zones = []
    collisions = []
    renderWithProviders(<EvpnZonesSection connections={CONNECTIONS} />)
    expect(await screen.findByText('No EVPN zone declared.')).toBeInTheDocument()
    expect(await screen.findByText('No VNI is carried by unrelated networks.')).toBeInTheDocument()
  })

  it('declares a zone: existing controller on one cluster, a new one on the other', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Declare an EVPN zone' }))
    // Only Proxmox clusters are offered.
    expect(within(dialog()).queryByText('backup')).not.toBeInTheDocument()
    tick('paris')
    await waitFor(() => expect(within(dialog()).getAllByRole('combobox')).toHaveLength(1))
    tick('lyon')
    // lyon has no controller: "create one" by default, with every node of both clusters as peers.
    expect(await within(dialog()).findByLabelText('BGP peers')).toHaveValue('10.0.1.1, 10.0.2.1')
    expect(within(dialog()).getByText(/frr packages are missing on n2/)).toBeInTheDocument()
    type('Controller id', 'evpnpxc')
    type('AS number', '65001')
    type('Name', 'Second')
    type('Proxmox zone id', 'ZSec-2')
    type('VRF VNI', '8000')
    type('MTU', '1450')
    type('First VNI', '8001')
    type('Last VNI', '8099')
    expect(within(dialog()).getByLabelText('Proxmox zone id')).toHaveValue('zsec2')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Declare an EVPN zone' }))
    await waitFor(() => expect(posted).toBeDefined())
    expect(posted).toEqual({
      name: 'Second', description: '', zoneName: 'zsec2', vrfVxlan: 8000, mtu: 1450, vniStart: 8001, vniEnd: 8099,
      members: [
        { connectionId: 'c1', controller: { mode: 'existing', name: 'evpn1' } },
        { connectionId: 'c2', controller: { mode: 'create', name: 'evpnpxc', asn: 65001, peers: ['10.0.1.1', '10.0.2.1'] } },
      ],
    })
    expect(await screen.findByText('EVPN zone "Second" declared.')).toBeInTheDocument()
  })

  it('adopts a zone Proxmox already runs, and keeps the form open on a refusal', async () => {
    createFails = 'EVPN zone: a zone named "Old" already exists.'
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Declare an EVPN zone' }))
    tick('paris')
    fireEvent.click(await within(dialog()).findByText('zold'))
    expect(within(dialog()).getByLabelText('Proxmox zone id')).toHaveValue('zold')
    expect(within(dialog()).getByLabelText('VRF VNI')).toHaveValue('5000')
    expect(within(dialog()).getByLabelText('MTU')).toHaveValue('1400')
    expect(within(dialog()).getByText('Existing zone, adopted')).toBeInTheDocument()
    type('Name', 'Old')
    type('First VNI', '5001')
    type('Last VNI', '5099')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Declare an EVPN zone' }))
    expect(await within(dialog()).findByText('EVPN zone: a zone named "Old" already exists.')).toBeInTheDocument()
    expect(posted.mtu).toBe(1400)
  })

  it('ticks every cluster at once, flags the unreachable one, and reports a failed apply', async () => {
    applyErrors = [{ connectionName: 'lyon', error: 'ifreload failed' }]
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Declare an EVPN zone' }))
    fireEvent.click(within(dialog()).getByRole('checkbox', { name: 'All' }))
    expect(await within(dialog()).findByText('This cluster cannot be read right now.')).toBeInTheDocument()
    // Untick the unreachable cluster, keep the two others.
    tick('nice')
    type('Name', 'Third')
    type('Proxmox zone id', 'zthird')
    type('VRF VNI', '7000')
    type('First VNI', '7001')
    type('Last VNI', '7099')
    fireEvent.change(within(dialog()).getByLabelText('BGP peers'), { target: { value: '10.9.9.9' } })
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Declare an EVPN zone' }))
    await waitFor(() => expect(posted).toBeDefined())
    expect(posted.mtu).toBeNull()
    // The clusters are offered by name: lyon before paris.
    expect(posted.members.map((m: any) => m.connectionId)).toEqual(['c2', 'c1'])
    expect(posted.members[0].controller.peers).toEqual(['10.9.9.9'])
    expect(await screen.findByText(/Proxmox could not apply the change on lyon/)).toBeInTheDocument()
  })

  it('edits the name and the range, with the Proxmox settings locked', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Edit the EVPN zone' }))
    expect(within(dialog()).getByLabelText('Proxmox zone id')).toBeDisabled()
    expect(within(dialog()).getByLabelText('VRF VNI')).toBeDisabled()
    type('Name', 'Renamed')
    type('Last VNI', '9199')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(putBody).toEqual({ name: 'Renamed', description: 'core', vniStart: 9001, vniEnd: 9199 }))
  })

  it('adds a cluster to a zone, offering only the clusters that do not carry it', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Add a cluster' }))
    expect(within(dialog()).queryByRole('checkbox', { name: /paris/ })).not.toBeInTheDocument()
    tick('nice')
    await waitFor(() => expect(within(dialog()).getByLabelText('Controller id')).toBeInTheDocument())
    type('BGP peers', '10.0.3.1')
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Add a cluster' }))
    await waitFor(() => expect(memberPosted).toEqual({ connectionId: 'c3', controller: { mode: 'create', name: 'evpn', asn: 65000, peers: ['10.0.3.1'] } }))
  })

  it('resyncs and detaches a cluster from its menu', async () => {
    await renderLoaded()
    const row = screen.getByText('Shared').closest('tr')!
    fireEvent.click(within(row).getByText('lyon'))
    fireEvent.click(await screen.findByText('Resync'))
    await waitFor(() => expect(resynced).toEqual({ connectionId: 'c2' }))
    expect(await screen.findByText('Cluster "lyon" is in sync.')).toBeInTheDocument()

    fireEvent.click(within(screen.getByText('Shared').closest('tr')!).getByText('lyon'))
    fireEvent.click(await screen.findByText('Detach this cluster'))
    expect(within(dialog()).getByText(/Zone "zshared" is deleted on this cluster/)).toBeInTheDocument()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(deletedUrls).toEqual(['/api/v1/admin/evpn-zones/z1/members?connectionId=c2']))
    expect(await screen.findByText(/Proxmox could not apply the change on lyon/)).toBeInTheDocument()

    // An adopted zone stays in place: the confirmation says so.
    fireEvent.click(within(screen.getByText('Shared').closest('tr')!).getByText('paris'))
    fireEvent.click(await screen.findByText('Detach this cluster'))
    expect(within(dialog()).getByText(/existed before ProxCenter and stays in place/)).toBeInTheDocument()
  })

  it('deletes a zone after a confirmation', async () => {
    await renderLoaded()
    fireEvent.click(screen.getByRole('button', { name: 'Delete the EVPN zone' }))
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(deletedUrls).toEqual(['/api/v1/admin/evpn-zones/z1']))
    expect(await screen.findByText('EVPN zone "Shared" deleted.')).toBeInTheDocument()
  })

  it('lists the shared VNIs and moves the ProxCenter network to a free one', async () => {
    await renderLoaded()
    expect(await screen.findByText('Bridged')).toBeInTheDocument()
    expect(screen.getByText(/lyon · zb · vhand · not created by ProxCenter/)).toBeInTheDocument()
    expect(screen.getByText(/paris · za · dmz \(vlan1\) · Acme \/ Acme prod/)).toBeInTheDocument()
    expect(screen.getByText('Not checked, cluster unreachable: nice.')).toBeInTheDocument()
    // Only the ProxCenter network can move.
    expect(screen.getAllByRole('button', { name: 'Change VNI' })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Change VNI' }))
    expect(within(dialog()).getByText(/Move "dmz" on "paris" from VNI 10001 to a free one/)).toBeInTheDocument()
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Change VNI' }))
    await waitFor(() => expect(renumbered).toEqual({ vdcVnetId: 'vn-1' }))
    expect(await screen.findByText('"dmz" moved from VNI 10001 to 10003.')).toBeInTheDocument()
    expect(await screen.findByText('No VNI is carried by unrelated networks.')).toBeInTheDocument()
  })
})
