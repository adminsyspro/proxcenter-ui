import { afterEach, describe, expect, it } from 'vitest'
import { cleanup } from '@testing-library/react'
import { ReactFlowProvider } from '@xyflow/react'
import type { ReactElement } from 'react'

import { renderWithProviders, screen } from '@/__tests__/setup/renderWithProviders'
import frMessages from '@/messages/fr.json'

import type { VlanContainerNodeData, VlanGroupNodeData } from '../../types'
import { VlanContainerNode } from './VlanContainerNode'
import { VlanGroupNode } from './VlanGroupNode'

/** Both nodes render a `Handle`, which needs the React Flow store. */
function renderNode(ui: ReactElement) {
  return renderWithProviders(<ReactFlowProvider>{ui}</ReactFlowProvider>)
}

/**
 * Same, under the French catalogue. The canvas nodes used to hardcode an
 * English "No VLAN", so rendering in another locale is what proves the label
 * now comes from next-intl.
 */
function renderNodeInFrench(ui: ReactElement) {
  return renderWithProviders(<ReactFlowProvider>{ui}</ReactFlowProvider>, {
    locale: 'fr',
    messages: frMessages as Record<string, unknown>,
  })
}

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

const untaggedGroup: VlanGroupNodeData = {
  label: 'No VLAN',
  connectionId: 'conn-1',
  nodeName: 'pve1',
  vlanTag: null,
  bridge: 'vmbr0',
  segmentKey: 'no-vlan',
  segmentTag: null,
  vmCount: 1,
  width: 170,
  height: 50,
}

const vnetContainer: VlanContainerNodeData = {
  label: 'VNI 4242',
  vlanTag: null,
  bridge: 'overlay',
  segmentKey: 'vnet-tvx1',
  segmentTag: 4242,
  vnet: 'tvx1',
  zone: 'tzvx1',
  zoneType: 'vxlan',
  subnet: null,
  vms: [
    { vmid: 100, name: 'Debian13', vmType: 'qemu', vmStatus: 'stopped', nodeName: 'pve2-dr', ip: '10.42.0.37' },
    { vmid: 101, name: 'ct-web', vmType: 'lxc', vmStatus: 'running', nodeName: 'pve2-dr', ip: null },
  ],
  width: 240,
  height: 120,
}

/** The `data` prop React Flow hands a custom node. */
const asNodeProps = (data: unknown) => ({ data, id: 'n1', type: 't', selected: false }) as any

afterEach(() => {
  cleanup()
})

describe('VlanGroupNode', () => {
  it('shows the resolved segment label and the VNet alias as its bridge', () => {
    const { container } = renderNode(<VlanGroupNode {...asNodeProps(vnetGroup)} />)

    expect(screen.getByText('VLAN 137')).toBeInTheDocument()
    expect(screen.getByText('prod-lan')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(container.querySelector('.ri-git-branch-line')).not.toBeNull()
  })

  it('translates the segment-less label instead of hardcoding English', () => {
    const { container } = renderNodeInFrench(<VlanGroupNode {...asNodeProps(untaggedGroup)} />)

    expect(screen.getByText('Sans VLAN')).toBeInTheDocument()
    expect(screen.queryByText('No VLAN')).toBeNull()
    expect(container.querySelector('.ri-link-unlink')).not.toBeNull()
  })

  it('marks a plain per-NIC VLAN with the router icon', () => {
    const { container } = renderNode(
      <VlanGroupNode {...asNodeProps({ ...untaggedGroup, label: 'VLAN 99', segmentKey: 'vlan-99', segmentTag: 99, vlanTag: 99 })} />,
    )

    expect(screen.getByText('VLAN 99')).toBeInTheDocument()
    expect(container.querySelector('.ri-router-line')).not.toBeNull()
  })
})

describe('VlanContainerNode', () => {
  it('labels a VXLAN bucket with its VNI and lists its guests', () => {
    const { container } = renderNode(<VlanContainerNode {...asNodeProps(vnetContainer)} />)

    expect(screen.getByText('VNI 4242')).toBeInTheDocument()
    expect(screen.getByText('Debian13')).toBeInTheDocument()
    expect(screen.getByText('ct-web')).toBeInTheDocument()
    // A guest with an IP shows it, one without falls back to its vmid.
    expect(screen.getByText('10.42.0.37')).toBeInTheDocument()
    expect(screen.getByText('101')).toBeInTheDocument()
    expect(container.querySelector('.ri-git-branch-line')).not.toBeNull()
  })

  it('translates the segment-less label instead of hardcoding English', () => {
    const { container } = renderNodeInFrench(
      <VlanContainerNode
        {...asNodeProps({ ...vnetContainer, label: 'No VLAN', segmentKey: 'no-vlan', segmentTag: null, vnet: undefined, zoneType: undefined })}
      />,
    )

    expect(screen.getByText('Sans VLAN')).toBeInTheDocument()
    expect(screen.queryByText('No VLAN')).toBeNull()
    expect(container.querySelector('.ri-link-unlink')).not.toBeNull()
  })

  it('renders an empty bucket without a guest row', () => {
    renderNode(<VlanContainerNode {...asNodeProps({ ...vnetContainer, vms: [] })} />)

    expect(screen.getByText('VNI 4242')).toBeInTheDocument()
    expect(screen.getByText('0')).toBeInTheDocument()
  })
})
