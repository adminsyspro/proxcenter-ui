/**
 * Coverage for the guest segment resolution behind the VM firewall grouping.
 *
 * The cases that matter are the ones that used to fall under "Untagged": a NIC
 * on an SDN VNet carries no `tag=`, so only the bridge tells which segment the
 * guest rides. The ordering rules (first NIC wins, VNet beats tag) are asserted
 * too, since they decide which bucket a multi-NIC guest lands in.
 */

import { describe, it, expect } from 'vitest'

import {
  guestSegmentKey,
  hasNicFirewall,
  nicVlanTags,
  parseGuestNics,
  resolveGuestSegment,
  UNTAGGED_KEY,
  vlanOfSegmentKey,
  type GuestNic,
} from './guestSegment'
import { buildSdnVnets, type SdnVnet } from './sdnVnetMap'

/** A VXLAN VNet and a VLAN-zone VNet, joined exactly as the cluster reports them. */
const VNETS = buildSdnVnets(
  [
    { vnet: 'v42fc503', alias: 'lan', zone: 'vxzone', tag: 42 },
    { vnet: 'vprod', zone: 'vlzone', tag: 100 },
  ],
  [
    { zone: 'vxzone', type: 'vxlan', peers: '10.0.0.1,10.0.0.2' },
    { zone: 'vlzone', type: 'vlan' },
  ],
)

const VNET_BY_ID = new Map<string, SdnVnet>(VNETS.map(v => [v.vnet, v]))

const nic = (index: number, overrides: Partial<GuestNic> = {}): GuestNic => ({ index, ...overrides })

describe('parseGuestNics', () => {
  it('parses bridge, tag and firewall out of a NIC string', () => {
    expect(parseGuestNics({ net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=100,firewall=1,rate=10' })).toEqual([
      { index: 0, bridge: 'vmbr0', tag: 100, firewall: true },
    ])
  })

  it('keeps the bridge of a VNet-backed NIC, which carries no tag', () => {
    expect(parseGuestNics({ net0: 'virtio=AA:BB:CC:DD:EE:FF,bridge=v42fc503,firewall=1' })).toEqual([
      { index: 0, bridge: 'v42fc503', firewall: true },
    ])
  })

  it('orders NICs by index, past the first ten', () => {
    const nics = parseGuestNics({
      net2: 'virtio=AA:02,bridge=vmbr2',
      net10: 'virtio=AA:10,bridge=vmbr10',
      net0: 'virtio=AA:00,bridge=vmbr0',
    })

    expect(nics.map(n => n.index)).toEqual([0, 2, 10])
  })

  it('ignores every config key that is not a NIC', () => {
    expect(parseGuestNics({ name: 'web-01', scsi0: 'local:vm-100-disk-0', netfoo: 'virtio=AA:BB' })).toEqual([])
  })

  it('reads firewall=0 as disabled', () => {
    expect(parseGuestNics({ net0: 'virtio=AA:00,bridge=vmbr0,firewall=0' })[0].firewall).toBe(false)
  })

  it('drops a tag PVE never assigns, so tag=0 stays untagged', () => {
    expect(parseGuestNics({ net0: 'virtio=AA:00,bridge=vmbr0,tag=0' })[0].tag).toBeUndefined()
  })

  it('yields a bare NIC entry when the string carries nothing usable', () => {
    expect(parseGuestNics({ net0: 'virtio=AA:00' })).toEqual([{ index: 0 }])
  })

  it('is null-safe and ignores a non-string NIC value', () => {
    expect(parseGuestNics(null)).toEqual([])
    expect(parseGuestNics(undefined)).toEqual([])
    expect(parseGuestNics({ net0: 42 })).toEqual([])
  })
})

describe('nicVlanTags', () => {
  it('de-duplicates and sorts the tags of every NIC', () => {
    expect(nicVlanTags([nic(0, { tag: 30 }), nic(1, { tag: 10 }), nic(2, { tag: 30 })])).toEqual([10, 30])
  })

  it('returns nothing for a guest with no tagged NIC', () => {
    expect(nicVlanTags([nic(0, { bridge: 'vmbr0' })])).toEqual([])
  })
})

describe('hasNicFirewall', () => {
  it('is true as soon as one NIC has it enabled', () => {
    expect(hasNicFirewall([nic(0), nic(1, { firewall: true })])).toBe(true)
  })

  it('is false when no NIC has it', () => {
    expect(hasNicFirewall([nic(0, { firewall: false }), nic(1)])).toBe(false)
    expect(hasNicFirewall([])).toBe(false)
  })
})

describe('resolveGuestSegment', () => {
  it('resolves a NIC on an SDN VNet instead of leaving it untagged', () => {
    const segment = resolveGuestSegment([nic(0, { bridge: 'v42fc503' })], VNET_BY_ID)

    expect(segment).toEqual({ kind: 'vnet', vnet: VNET_BY_ID.get('v42fc503') })
  })

  it('prefers the VNet over a tag set on the same NIC', () => {
    const segment = resolveGuestSegment([nic(0, { bridge: 'vprod', tag: 7 })], VNET_BY_ID)

    expect(segment).toEqual({ kind: 'vnet', vnet: VNET_BY_ID.get('vprod') })
  })

  it('falls back to the per-NIC tag on an ordinary bridge', () => {
    expect(resolveGuestSegment([nic(0, { bridge: 'vmbr0', tag: 20 })], VNET_BY_ID)).toEqual({ kind: 'vlan', tag: 20 })
  })

  it('takes the first NIC that names a segment, in NIC order', () => {
    const nics = [nic(0, { bridge: 'vmbr0' }), nic(1, { bridge: 'vmbr0', tag: 20 }), nic(2, { bridge: 'v42fc503' })]

    expect(resolveGuestSegment(nics, VNET_BY_ID)).toEqual({ kind: 'vlan', tag: 20 })
  })

  it('leaves a guest untagged when nothing names a segment', () => {
    expect(resolveGuestSegment([nic(0, { bridge: 'vmbr0' })], VNET_BY_ID)).toEqual({ kind: 'untagged' })
    expect(resolveGuestSegment([], VNET_BY_ID)).toEqual({ kind: 'untagged' })
  })

  it('leaves a guest untagged when the cluster exposes no VNet at all', () => {
    expect(resolveGuestSegment([nic(0, { bridge: 'v42fc503' })], new Map())).toEqual({ kind: 'untagged' })
  })
})

describe('guestSegmentKey', () => {
  it('keys a VNet group by its VNet id, never by an alias two VNets could share', () => {
    expect(guestSegmentKey({ kind: 'vnet', vnet: VNET_BY_ID.get('v42fc503')! }, [])).toBe('vnet:v42fc503')
  })

  it('keys a VLAN group by its tag', () => {
    expect(guestSegmentKey({ kind: 'vlan', tag: 20 }, [20])).toBe('vlan:20')
  })

  it('keys an untagged guest by the sentinel', () => {
    expect(guestSegmentKey({ kind: 'untagged' }, [])).toBe(UNTAGGED_KEY)
    expect(guestSegmentKey(undefined, [])).toBe(UNTAGGED_KEY)
  })

  it('falls back to the primary VLAN when no segment was resolved', () => {
    expect(guestSegmentKey(undefined, [20, 30])).toBe('vlan:20')
  })
})

describe('vlanOfSegmentKey', () => {
  it('reads the tag back out of a VLAN key', () => {
    expect(vlanOfSegmentKey('vlan:100')).toBe(100)
  })

  it('returns null for any other key', () => {
    expect(vlanOfSegmentKey('vnet:v42fc503')).toBeNull()
    expect(vlanOfSegmentKey(UNTAGGED_KEY)).toBeNull()
  })
})
