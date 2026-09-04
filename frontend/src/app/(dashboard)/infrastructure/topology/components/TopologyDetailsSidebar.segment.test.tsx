import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import frMessages from '@/messages/fr.json'

import type { SelectedNodeInfo, VlanContainerNodeData, VlanGroupNodeData } from '../types'
import TopologyDetailsSidebar from './TopologyDetailsSidebar'

const vnetGroup: VlanGroupNodeData = {
  label: 'VLAN 137',
  connectionId: 'conn-1',
  nodeName: 'pve2-dr',
  vlanTag: 137,
  bridge: 'prod-lan',
  segmentKey: 'vnet-tv1',
  segmentTag: 137,
  vnet: 'tv1',
  zone: 'tzvl1',
  zoneType: 'vlan',
  vmCount: 2,
  width: 170,
  height: 50,
}

const vxlanContainer: VlanContainerNodeData = {
  label: 'VNI 4242',
  vlanTag: null,
  bridge: 'overlay',
  segmentKey: 'vnet-tvx1',
  segmentTag: 4242,
  vnet: 'tvx1',
  zone: 'tzvx1',
  zoneType: 'vxlan',
  subnet: '10.42.0.0/24',
  vms: [{ vmid: 100, name: 'Debian13', vmType: 'qemu', vmStatus: 'stopped', nodeName: 'pve2-dr', ip: '10.42.0.37' }],
  width: 240,
  height: 120,
}

function render(node: SelectedNodeInfo, french = false) {
  return renderWithProviders(
    <TopologyDetailsSidebar node={node} onClose={vi.fn()} connections={[]} />,
    french ? { locale: 'fr', messages: frMessages as Record<string, unknown> } : undefined,
  )
}

/** Value rendered next to a caption, as the segment header lays them out. */
function valueOf(label: string): string | null | undefined {
  return screen.getByText(label).parentElement?.querySelector('.MuiTypography-body1')?.textContent
}

afterEach(() => {
  cleanup()
})

describe('segment details of a VLAN group', () => {
  it('names an SDN VNet as such, with its VLAN and its zone', () => {
    render({ type: 'vlanGroup', data: vnetGroup })

    expect(screen.getByText('VLAN 137')).toBeInTheDocument()
    expect(valueOf('VNet')).toBe('prod-lan')
    expect(valueOf('VLAN')).toBe('137')
    expect(valueOf('SDN zone')).toBe('tzvl1 (vlan)')
    expect(valueOf('VMs')).toBe('2')
    expect(screen.queryByText('Bridge')).toBeNull()
  })

  it('shows a plain bridge and no SDN rows when the bucket is not a VNet', () => {
    render({
      type: 'vlanGroup',
      data: { ...vnetGroup, label: 'VLAN 99', bridge: 'vmbr0', segmentKey: 'vlan-99', segmentTag: 99, vlanTag: 99, vnet: undefined, zone: undefined, zoneType: undefined },
    })

    expect(valueOf('Bridge')).toBe('vmbr0')
    expect(screen.queryByText('VNet')).toBeNull()
    expect(screen.queryByText('SDN zone')).toBeNull()
  })

  it('translates the segment-less title', () => {
    render(
      {
        type: 'vlanGroup',
        data: { ...vnetGroup, label: 'No VLAN', bridge: 'vmbr0', segmentKey: 'no-vlan', segmentTag: null, vlanTag: null, vnet: undefined, zone: undefined, zoneType: undefined },
      },
      true,
    )

    expect(screen.getByText('Sans VLAN')).toBeInTheDocument()
    expect(screen.queryByText('No VLAN')).toBeNull()
  })

  it('omits the zone type when the zone could not be resolved', () => {
    render({ type: 'vlanGroup', data: { ...vnetGroup, zoneType: '' } })

    expect(valueOf('SDN zone')).toBe('tzvl1')
  })
})

describe('segment details of a VLAN container', () => {
  it('reports a VXLAN VNet with no 802.1Q VLAN row', () => {
    render({ type: 'vlanContainer', data: vxlanContainer })

    expect(screen.getByText('VNI 4242')).toBeInTheDocument()
    expect(valueOf('VNet')).toBe('overlay')
    expect(valueOf('SDN zone')).toBe('tzvx1 (vxlan)')
    expect(valueOf('VMs')).toBe('1')
    expect(screen.queryByText('VLAN')).toBeNull()
    expect(screen.getByText('10.42.0.0/24')).toBeInTheDocument()
    expect(screen.getByText('Debian13')).toBeInTheDocument()
  })

  it('drops the subnet row when no guest IP allowed deriving one', () => {
    render({ type: 'vlanContainer', data: { ...vxlanContainer, subnet: null } })

    expect(screen.queryByText('Subnet')).toBeNull()
  })
})
