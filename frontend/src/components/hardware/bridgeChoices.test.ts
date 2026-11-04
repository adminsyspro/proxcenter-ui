import { describe, expect, it } from 'vitest'

import {
  FALLBACK_BRIDGES,
  bridgeEntryOption,
  deployBridgeOption,
  migrationBridgeOption,
  orderDeployBridges,
  bridgeOptionSearchText,
  naturalCompare,
  networkChoiceLabel,
  sortNaturally,
  sortNetworkChoices,
  toBridgeEntries,
  typedBridgeOption,
} from './bridgeChoices'

describe('naturalCompare / sortNaturally', () => {
  it('orders numbers by value and ignores case', () => {
    const names = ['VLAN2961', 'vlan10', 'VLAN2042', 'VLAN2', 'VLAN2562', 'vlan2553']
    expect(sortNaturally(names, n => n)).toEqual(['VLAN2', 'vlan10', 'VLAN2042', 'vlan2553', 'VLAN2562', 'VLAN2961'])
    expect(naturalCompare('vmbr2', 'vmbr10')).toBeLessThan(0)
    expect(naturalCompare('LAN', 'lan')).toBe(0)
  })

  it('keeps input order on ties and does not mutate the input', () => {
    const items = [{ k: 'b', id: 1 }, { k: 'A', id: 2 }, { k: 'a', id: 3 }]
    const sorted = sortNaturally(items, i => i.k)
    expect(sorted.map(i => i.id)).toEqual([2, 3, 1])
    expect(items.map(i => i.id)).toEqual([1, 2, 3])
  })
})

describe('networkChoiceLabel', () => {
  it('uses the VNet alias, the shared label, else the PVE name', () => {
    expect(networkChoiceLabel({ kind: 'vnet', name: 'v8a3f', displayName: 'lan' })).toBe('lan')
    expect(networkChoiceLabel({ kind: 'vnet', name: 'v8a3f' })).toBe('v8a3f')
    expect(networkChoiceLabel({ kind: 'shared', name: 'vmbr1', label: 'uplink' })).toBe('uplink')
    expect(networkChoiceLabel({ kind: 'shared', name: 'vmbr1', label: null })).toBe('vmbr1')
    expect(networkChoiceLabel({ kind: 'bridge', name: 'vmbr0', displayName: 'ignored' })).toBe('vmbr0')
    expect(networkChoiceLabel(null)).toBe('')
  })
})

describe('sortNetworkChoices', () => {
  it('groups bridges, VNets, shared bridges and sorts each group naturally by label', () => {
    const sorted = sortNetworkChoices([
      { kind: 'shared', name: 'vmbr9', label: 'uplink' },
      { kind: 'vnet', name: 'VLAN2961' },
      { kind: 'bridge', name: 'vmbr10' },
      { kind: 'vnet', name: 'h1', displayName: 'VLAN2042' },
      { kind: 'shared', name: 'vmbr3', label: null },
      { kind: 'vnet', name: 'VLAN2553' },
      { kind: 'bridge', name: 'vmbr2' },
    ])
    expect(sorted.map(c => c.name)).toEqual(['vmbr2', 'vmbr10', 'h1', 'VLAN2553', 'VLAN2961', 'vmbr9', 'vmbr3'])
  })

  it('breaks label ties on the PVE name and treats unknown kinds as bridges', () => {
    const sorted = sortNetworkChoices([
      { kind: 'vnet', name: 'vb2', displayName: 'lan' },
      { kind: 'vnet', name: 'va1', displayName: 'LAN' },
      { name: 'vmbr1' },
      null,
    ])
    expect(sorted.map(c => c?.name ?? null)).toEqual([null, 'vmbr1', 'va1', 'vb2'])
  })
})

describe('toBridgeEntries', () => {
  it('maps and sorts a network-choices answer, dropping nameless rows', () => {
    expect(toBridgeEntries([
      { kind: 'vnet', name: 'v2', displayName: 'web' },
      { kind: 'bridge', name: 'vmbr1', type: 'bridge' },
      { kind: 'shared', name: 'vmbr4', label: 'dmz' },
      { kind: 'bridge', name: '' },
      { kind: 'bridge', name: 'vmbr0', type: 'OVSBridge' },
    ])).toEqual([
      { iface: 'vmbr0', label: 'vmbr0', kind: 'bridge' },
      { iface: 'vmbr1', label: 'vmbr1', kind: 'bridge' },
      { iface: 'v2', label: 'web', kind: 'vnet' },
      { iface: 'vmbr4', label: 'dmz', kind: 'shared' },
    ])
    expect(toBridgeEntries(undefined)).toEqual([])
  })
})

describe('bridgeEntryOption', () => {
  it('demotes the PVE name to a hint only when the label differs', () => {
    expect(bridgeEntryOption({ iface: 'vmbr0', label: 'vmbr0' })).toEqual({ iface: 'vmbr0', label: 'vmbr0' })
    expect(bridgeEntryOption({ iface: 'v8a3f', label: 'lan' })).toEqual({ iface: 'v8a3f', label: 'lan', hint: 'v8a3f' })
    expect(bridgeEntryOption({ iface: 'vmbr5', label: '' })).toEqual({ iface: 'vmbr5', label: 'vmbr5' })
  })
})

describe('typedBridgeOption', () => {
  it('leads a named VNet with its alias and keeps the hashed id as hint', () => {
    expect(typedBridgeOption({ iface: 'v8a3f', type: 'vnet', label: 'lan', vdc: 'acme' }))
      .toEqual({ iface: 'v8a3f', label: 'lan', hint: 'v8a3f', detail: 'VNet · acme' })
  })

  it('leads other kinds with the iface and puts tag, label and vDC in the caption', () => {
    expect(typedBridgeOption({ iface: 'vmbr1', type: 'shared', label: 'uplink', vdc: '*' }))
      .toEqual({ iface: 'vmbr1', label: 'vmbr1', detail: 'Shared · uplink' })
    expect(typedBridgeOption({ iface: 'vmbr2', type: 'OVSBridge', label: null }))
      .toEqual({ iface: 'vmbr2', label: 'vmbr2', detail: 'OVS' })
    expect(typedBridgeOption({ iface: 'vmbr0', type: 'bridge' })).toEqual({ iface: 'vmbr0', label: 'vmbr0' })
    expect(typedBridgeOption({ iface: 'vnet1', type: 'vnet', label: 'vnet1' }))
      .toEqual({ iface: 'vnet1', label: 'vnet1', detail: 'VNet' })
  })
})

describe('bridgeOptionSearchText', () => {
  it('joins every text of the row', () => {
    expect(bridgeOptionSearchText({ iface: 'v8a3f', label: 'lan', hint: 'v8a3f', detail: 'VNet · zone1' }))
      .toBe('lan v8a3f v8a3f VNet · zone1')
    expect(bridgeOptionSearchText({ iface: 'vmbr0', label: 'vmbr0' })).toBe('vmbr0 vmbr0')
  })
})

describe('FALLBACK_BRIDGES', () => {
  it('offers vmbr0 then vmbr1', () => {
    expect(FALLBACK_BRIDGES.map(b => b.iface)).toEqual(['vmbr0', 'vmbr1'])
  })
})

describe('orderDeployBridges', () => {
  const list = [
    { iface: 'vmbr10', type: 'bridge' },
    { iface: 'vmbr9', type: 'shared' },
    { iface: 'h2', type: 'vnet', displayName: 'VLAN2961' },
    { iface: 'vmbr2', type: 'OVSBridge' },
    { iface: 'VLAN2042', type: 'vnet', displayName: null },
    { iface: 'vmbr3', type: 'shared' },
  ]

  it('lists VNets then shared uplinks for a tenant, naturally sorted', () => {
    expect(orderDeployBridges(list, false).map(b => b.iface)).toEqual(['VLAN2042', 'h2', 'vmbr3', 'vmbr9'])
  })

  it('appends the raw bridges in full cluster view', () => {
    expect(orderDeployBridges(list, true).map(b => b.iface)).toEqual(['VLAN2042', 'h2', 'vmbr3', 'vmbr9', 'vmbr2', 'vmbr10'])
  })
})

describe('deployBridgeOption', () => {
  it('shows a VNet by display name with its subnet', () => {
    expect(deployBridgeOption({ iface: 'h2', type: 'vnet', displayName: 'web', subnet: { cidr: '10.0.0.0/24', gateway: '10.0.0.1' } }))
      .toEqual({ iface: 'h2', label: 'web', icon: 'ri-shield-keyhole-line', accentIcon: true, detail: '10.0.0.0/24 · gw 10.0.0.1' })
    expect(deployBridgeOption({ iface: 'h3', type: 'vnet' }))
      .toEqual({ iface: 'h3', label: 'h3', icon: 'ri-shield-keyhole-line', accentIcon: true })
  })

  it('tags shared, OVS and plain bridges', () => {
    expect(deployBridgeOption({ iface: 'vmbr1', type: 'shared' }).detail).toBe('Shared')
    expect(deployBridgeOption({ iface: 'vmbr2', type: 'OVSBridge' }).detail).toBe('OVS')
    expect(deployBridgeOption({ iface: 'vmbr0', type: 'bridge' }))
      .toEqual({ iface: 'vmbr0', label: 'vmbr0', icon: 'ri-git-branch-line', detail: 'Bridge' })
  })
})

describe('migrationBridgeOption', () => {
  it('keeps the PVE name and moves the kind label to the caption', () => {
    expect(migrationBridgeOption({ name: 'vf95117a', kind: 'vnet', label: 'VNet · dmz · z1' }))
      .toEqual({ iface: 'vf95117a', label: 'vf95117a', icon: 'ri-node-tree', detail: 'VNet · dmz · z1' })
    expect(migrationBridgeOption({ name: 'vmbr0', kind: 'bridge', label: '' }))
      .toEqual({ iface: 'vmbr0', label: 'vmbr0', icon: 'ri-router-line' })
  })
})
