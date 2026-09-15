/**
 * Pure tests for the vDC VXLAN transport rules (#899).
 * Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/vdc/transport.test.ts
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_TRANSPORT,
  formatIPv6,
  ipInCidr,
  nodesWithoutPeer,
  normalizePeerList,
  normalizeTransportInput,
  nthAddress,
  parseCidr,
  parseIPv4,
  parseIPv6,
  parseZonePeers,
  resolveZonePeers,
  sameZoneConfig,
  suggestNodeAddresses,
  transportFromRow,
  transportIfaceName,
  underlayMtuFor,
  zoneConfigFor,
} from './transport'

describe('IP helpers', () => {
  it('parses IPv4 and rejects out-of-range octets', () => {
    expect(parseIPv4('10.42.0.101')).toBe(10 * 2 ** 24 + 42 * 2 ** 16 + 101)
    expect(parseIPv4('256.1.1.1')).toBeNull()
    expect(parseIPv4('10.1.1')).toBeNull()
    expect(parseIPv4('pve1')).toBeNull()
  })

  it('parses and formats IPv6, embedded IPv4 included', () => {
    expect(parseIPv6('::1')).toBe(BigInt(1))
    expect(parseIPv6('fd00::10')).toBe((BigInt(0xfd00) << BigInt(112)) | BigInt(0x10))
    expect(parseIPv6('::ffff:10.0.0.1')).toBe((BigInt(0xffff) << BigInt(32)) | BigInt(parseIPv4('10.0.0.1')!))
    expect(parseIPv6('1::2::3')).toBeNull()
    expect(parseIPv6('12345::')).toBeNull()
    expect(parseIPv6('fe80::1%eth0')).toBeNull()
    expect(formatIPv6(parseIPv6('FD00:0:0:0:0:0:0:10')!)).toBe('fd00::10')
    expect(formatIPv6(BigInt(0))).toBe('::')
    expect(formatIPv6(parseIPv6('2001:db8:0:1:0:0:0:1')!)).toBe('2001:db8:0:1::1')
  })

  it('parses CIDRs into their network address', () => {
    expect(parseCidr('10.100.5.17/24')?.text).toBe('10.100.5.0/24')
    expect(parseCidr('fd00::abcd/64')?.text).toBe('fd00::/64')
    expect(parseCidr('10.100.5.0/33')).toBeNull()
    expect(parseCidr('10.100.5.0')).toBeNull()
    expect(parseCidr('10.100.5.0/x')).toBeNull()
  })

  it('tests membership and enumerates hosts, skipping network and broadcast', () => {
    const c = parseCidr('10.100.5.0/29')!
    expect(ipInCidr('10.100.5.6', c)).toBe(true)
    expect(ipInCidr('10.100.6.1', c)).toBe(false)
    expect(ipInCidr('fd00::1', c)).toBe(false)
    expect(nthAddress(c, 0)).toBeNull()
    expect(nthAddress(c, 1)).toBe('10.100.5.1')
    expect(nthAddress(c, 6)).toBe('10.100.5.6')
    expect(nthAddress(c, 7)).toBeNull()
    expect(nthAddress(c, 8)).toBeNull()
    expect(nthAddress(parseCidr('10.0.0.0/31')!, 0)).toBe('10.0.0.0')
    expect(nthAddress(parseCidr('fd00::/64')!, 1)).toBe('fd00::1')
  })
})

describe('normalizePeerList', () => {
  it('accepts arrays and separated strings, dedupes, lowercases IPv6', () => {
    expect(normalizePeerList('10.0.0.1, 10.0.0.2\n10.0.0.1 FD00::1')).toEqual(['10.0.0.1', '10.0.0.2', 'fd00::1'])
    expect(normalizePeerList(['10.0.0.1', ' 10.0.0.1 '])).toEqual(['10.0.0.1'])
    expect(normalizePeerList('')).toEqual([])
    expect(normalizePeerList(undefined)).toEqual([])
  })

  it('refuses anything that is not an address', () => {
    expect(() => normalizePeerList('10.0.0.1, pve2')).toThrow(/"pve2" is not a valid/)
    expect(() => normalizePeerList(['10.0.0.1/24'])).toThrow(/not a valid/)
  })
})

describe('normalizeTransportInput', () => {
  it('returns a copy of the base for an empty input', () => {
    const t = normalizeTransportInput(null)
    expect(t).toEqual(DEFAULT_TRANSPORT)
    expect(t.peers).not.toBe(DEFAULT_TRANSPORT.peers)
    expect(t.nodeAddresses).not.toBe(DEFAULT_TRANSPORT.nodeAddresses)
  })

  it('cluster mode clears every other field but keeps the MTU', () => {
    const t = normalizeTransportInput({
      mode: 'cluster', peers: ['10.0.0.9'], mtu: 1400, vlanId: 10, device: 'bond0',
      cidr: '10.0.0.0/24', nodeAddresses: { pve1: '10.0.0.1' },
    })
    expect(t).toEqual({ ...DEFAULT_TRANSPORT, mtu: 1400 })
  })

  it('falls back to the base mode for an unknown one', () => {
    expect(normalizeTransportInput({ mode: 'evpn' as any }).mode).toBe('cluster')
  })

  it('peer list mode needs at least one address and drops transport fields', () => {
    expect(() => normalizeTransportInput({ mode: 'peers', peers: [] })).toThrow(/at least one peer/)
    const t = normalizeTransportInput({ mode: 'peers', peers: '10.0.0.1,10.0.0.2' as any, vlanId: 10, device: 'bond0' })
    expect(t.peers).toEqual(['10.0.0.1', '10.0.0.2'])
    expect(t.vlanId).toBeNull()
    expect(t.device).toBeNull()
  })

  it('bounds MTU and VLAN id', () => {
    expect(() => normalizeTransportInput({ mtu: 1000 })).toThrow(/MTU must be/)
    expect(() => normalizeTransportInput({ mtu: 9001 })).toThrow(/MTU must be/)
    expect(() => normalizeTransportInput({ mtu: 1450.5 })).toThrow(/MTU must be/)
    expect(normalizeTransportInput({ mtu: '1450' as any }).mtu).toBe(1450)
    expect(normalizeTransportInput({ mtu: '' as any }).mtu).toBeNull()
    expect(normalizeTransportInput({ mtu: null }, { ...DEFAULT_TRANSPORT, mtu: 1400 }).mtu).toBeNull()
    const base = { mode: 'transport' as const, device: 'bond0', cidr: '10.0.0.0/24', nodeAddresses: { pve1: '10.0.0.1' } }
    expect(() => normalizeTransportInput({ ...base, vlanId: 4095 })).toThrow(/VLAN id/)
    expect(() => normalizeTransportInput({ ...base, vlanId: 0 })).toThrow(/VLAN id/)
  })

  it('transport mode requires VLAN, device, CIDR and one node address', () => {
    const base = {
      mode: 'transport' as const, vlanId: 4000, device: 'bond0', cidr: '10.100.5.0/24',
      nodeAddresses: { pve1: '10.100.5.1', pve2: '10.100.5.2' },
    }
    expect(normalizeTransportInput(base)).toEqual({
      mode: 'transport', peers: [], mtu: null, vlanId: 4000, device: 'bond0',
      cidr: '10.100.5.0/24', nodeAddresses: base.nodeAddresses,
    })
    expect(() => normalizeTransportInput({ ...base, vlanId: null })).toThrow(/needs a VLAN id/)
    expect(() => normalizeTransportInput({ ...base, device: '' })).toThrow(/underlay device/)
    expect(() => normalizeTransportInput({ ...base, cidr: null })).toThrow(/segment CIDR/)
    expect(() => normalizeTransportInput({ ...base, nodeAddresses: { pve1: '' } })).toThrow(/at least one node/)
  })

  it('refuses a node address outside the segment, duplicates and bad names', () => {
    const base = { mode: 'transport' as const, vlanId: 4000, device: 'bond0', cidr: '10.100.5.0/24', nodeAddresses: { pve1: '10.100.5.1' } }
    expect(() => normalizeTransportInput({ ...base, nodeAddresses: { pve1: '10.100.6.1' } })).toThrow(/outside 10\.100\.5\.0\/24/)
    expect(() => normalizeTransportInput({ ...base, nodeAddresses: { pve1: '10.100.5.1', pve2: '10.100.5.1' } })).toThrow(/listed twice/)
    expect(() => normalizeTransportInput({ ...base, peers: ['10.100.5.1'] })).toThrow(/listed twice/)
    expect(() => normalizeTransportInput({ ...base, device: 'enp0s31f6np0' })).toThrow(/exceeds 15/)
    expect(() => normalizeTransportInput({ ...base, device: 'bond 0' })).toThrow(/not a valid interface name/)
    expect(() => normalizeTransportInput({ ...base, nodeAddresses: { 'pve 1': '10.100.5.1' } })).toThrow(/not a valid node name/)
    expect(() => normalizeTransportInput({ ...base, nodeAddresses: ['10.100.5.1'] as any })).toThrow(/object of node name/)
    expect(() => normalizeTransportInput({ ...base, cidr: '10.100.5.0' })).toThrow(/not a valid CIDR/)
  })

  it('keeps the base values for fields left out (partial PUT)', () => {
    const stored = normalizeTransportInput({ mode: 'peers', peers: ['10.0.0.1'], mtu: 1400 })
    const t = normalizeTransportInput({ mtu: 8950 }, stored)
    expect(t).toEqual({ ...stored, mtu: 8950 })
    expect(t.peers).not.toBe(stored.peers)
  })

  it('canonicalises the CIDR to its network address and normalises IPv6', () => {
    const t = normalizeTransportInput({
      mode: 'transport', vlanId: 10, device: 'vmbr0', cidr: 'FD00::5/64',
      nodeAddresses: { pve1: 'FD00::1' }, peers: ['FD00::FE'],
    })
    expect(t.cidr).toBe('fd00::/64')
    expect(t.nodeAddresses.pve1).toBe('fd00::1')
    expect(t.peers).toEqual(['fd00::fe'])
  })
})

describe('zone configuration', () => {
  const cluster = ['10.42.0.101', '10.42.0.102']

  it('resolves peers per mode', () => {
    expect(resolveZonePeers(DEFAULT_TRANSPORT, cluster)).toEqual(cluster)
    expect(resolveZonePeers({ ...DEFAULT_TRANSPORT, mode: 'peers', peers: ['10.0.0.1', '10.0.0.1', '10.0.0.2'] }, cluster))
      .toEqual(['10.0.0.1', '10.0.0.2'])
    expect(resolveZonePeers({
      ...DEFAULT_TRANSPORT, mode: 'transport',
      nodeAddresses: { pve1: '10.100.5.1', pve2: '10.100.5.2' }, peers: ['10.100.5.254'],
    }, cluster)).toEqual(['10.100.5.1', '10.100.5.2', '10.100.5.254'])
    expect(zoneConfigFor({ ...DEFAULT_TRANSPORT, mtu: 1400 }, cluster)).toEqual({ peers: cluster, mtu: 1400 })
  })

  it('compares zone configs regardless of peer order', () => {
    expect(sameZoneConfig({ peers: ['a', 'b'], mtu: null }, { peers: ['b', 'a'], mtu: null })).toBe(true)
    expect(sameZoneConfig({ peers: ['a'], mtu: null }, { peers: ['a', 'b'], mtu: null })).toBe(false)
    expect(sameZoneConfig({ peers: ['a'], mtu: 1400 }, { peers: ['a'], mtu: null })).toBe(false)
    expect(sameZoneConfig({ peers: ['a'], mtu: undefined as any }, { peers: ['a'], mtu: null })).toBe(true)
  })

  it('parses the PVE peers field', () => {
    expect(parseZonePeers('10.42.0.102,10.42.0.103, 10.42.0.101')).toEqual(['10.42.0.102', '10.42.0.103', '10.42.0.101'])
    expect(parseZonePeers(['a', 'a'])).toEqual(['a'])
    expect(parseZonePeers(undefined)).toEqual([])
  })

  it('derives the interface name and underlay MTU', () => {
    expect(transportIfaceName({ device: 'bond0', vlanId: 4000 })).toBe('bond0.4000')
    expect(transportIfaceName({ device: null, vlanId: 4000 })).toBeNull()
    expect(underlayMtuFor(1450)).toBe(1500)
    expect(underlayMtuFor(null)).toBeNull()
  })

  it('names the nodes that have no address in the peer list', () => {
    const nodes = [
      { name: 'pve1', addresses: ['10.42.0.101', '10.100.5.1'] },
      { name: 'pve2', addresses: ['10.42.0.102'] },
    ]
    expect(nodesWithoutPeer(['10.100.5.1', '10.100.5.2'], nodes)).toEqual(['pve2'])
    expect(nodesWithoutPeer(['10.42.0.101', '10.42.0.102'], nodes)).toEqual([])
    expect(nodesWithoutPeer(['FD00::1'], [{ name: 'pve1', addresses: ['fd00::1'] }])).toEqual([])
  })

  it('suggests sequential node addresses inside the segment', () => {
    expect(suggestNodeAddresses('10.100.5.0/24', ['pve1', 'pve2', 'pve3']))
      .toEqual({ pve1: '10.100.5.1', pve2: '10.100.5.2', pve3: '10.100.5.3' })
    expect(suggestNodeAddresses('10.100.5.0/30', ['a', 'b', 'c'])).toEqual({ a: '10.100.5.1', b: '10.100.5.2' })
    expect(suggestNodeAddresses('10.100.5.0/24', ['a', 'b'], 11)).toEqual({ a: '10.100.5.11', b: '10.100.5.12' })
    expect(suggestNodeAddresses('bogus', ['a'])).toEqual({})
  })
})

describe('transportFromRow', () => {
  it('maps a stored row and degrades a broken one to cluster mode', () => {
    expect(transportFromRow({ vxlanTransportMode: 'peers', vxlanPeers: ['10.0.0.1'], vxlanMtu: 1400 }))
      .toEqual({ ...DEFAULT_TRANSPORT, mode: 'peers', peers: ['10.0.0.1'], mtu: 1400 })
    expect(transportFromRow({})).toEqual(DEFAULT_TRANSPORT)
    expect(transportFromRow({ vxlanTransportMode: 'peers', vxlanPeers: [], vxlanMtu: 1400 }))
      .toEqual({ ...DEFAULT_TRANSPORT, mtu: 1400 })
    expect(transportFromRow({
      vxlanTransportMode: 'transport', transportVlanId: 4000, transportDevice: 'bond0',
      transportCidr: '10.100.5.0/24', transportNodeAddresses: { pve1: '10.100.5.1' },
    }).nodeAddresses).toEqual({ pve1: '10.100.5.1' })
  })
})
