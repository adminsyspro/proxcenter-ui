import { describe, expect, it } from 'vitest'

import {
  EMPTY_GUEST_NET_IDENTITY,
  extractLiveAddresses,
  normalizeMac,
  parseGuestNetIdentity,
} from './guestNetIdentity'

describe('normalizeMac', () => {
  it('normalizes valid colon and dash separated addresses', () => {
    expect(normalizeMac('bc:24:11:aa:bb:cc')).toBe('BC:24:11:AA:BB:CC')
    expect(normalizeMac('bc-24-11-aa-bb-cc')).toBe('BC:24:11:AA:BB:CC')
  })

  it('rejects null, malformed and all-zero addresses', () => {
    expect(normalizeMac(null)).toBeNull()
    expect(normalizeMac('bc:24:11')).toBeNull()
    expect(normalizeMac('00:00:00:00:00:00')).toBeNull()
  })
})

describe('parseGuestNetIdentity', () => {
  it('extracts a QEMU model-prefixed MAC from a real PVE config', () => {
    expect(parseGuestNetIdentity({
      agent: '1',
      name: 'Debian13',
      net0: 'virtio=BC:24:11:C0:F0:6F,bridge=vmbr0',
    }, 'qemu')).toEqual({
      macs: ['BC:24:11:C0:F0:6F'],
      configIps: [],
      description: null,
    })
  })

  it('accepts and normalizes the alternate QEMU macaddr form', () => {
    const result = parseGuestNetIdentity({
      net0: 'virtio,bridge=vmbr0,macaddr=bc:24:11:aa:bb:cc',
    }, 'qemu')

    expect(result.macs).toEqual(['BC:24:11:AA:BB:CC'])
  })

  it('extracts LXC MAC and static IPv4 and IPv6 addresses', () => {
    const result = parseGuestNetIdentity({
      hostname: 'debian-test',
      net0: 'name=eth0,bridge=vmbr0,hwaddr=BC:24:11:98:B7:A3,ip=192.168.1.10/24,gw=192.168.1.1,ip6=2001:db8::10/64',
    }, 'lxc')

    expect(result).toEqual({
      macs: ['BC:24:11:98:B7:A3'],
      configIps: ['192.168.1.10', '2001:db8::10'],
      description: null,
    })
  })

  it('extracts the MAC but no config IP from a DHCP LXC config', () => {
    const result = parseGuestNetIdentity({
      hostname: 'debian-test',
      net0: 'name=eth0,bridge=vmbr0,hwaddr=BC:24:11:98:B7:A3,ip=dhcp,type=veth',
    }, 'lxc')

    expect(result).toEqual({
      macs: ['BC:24:11:98:B7:A3'],
      configIps: [],
      description: null,
    })
  })

  it('ignores DHCP and auto placeholders in QEMU cloud-init config', () => {
    const result = parseGuestNetIdentity({
      ipconfig0: 'ip=dhcp',
      ipconfig1: 'ip=10.42.0.20/24,gw=10.42.0.1,ip6=auto',
      description: 'web front',
    }, 'qemu')

    expect(result).toEqual({
      macs: [],
      configIps: ['10.42.0.20'],
      description: 'web front',
    })
  })

  it('returns an empty identity for null config without sharing the top-level object', () => {
    const result = parseGuestNetIdentity(null, 'qemu')

    expect(result).toEqual(EMPTY_GUEST_NET_IDENTITY)
    expect(result).not.toBe(EMPTY_GUEST_NET_IDENTITY)
  })
})

describe('extractLiveAddresses', () => {
  it('extracts routable addresses and MACs from a QEMU guest agent payload', () => {
    const payload = {
      result: [
        {
          name: 'lo',
          'hardware-address': '00:00:00:00:00:00',
          'ip-addresses': [
            { 'ip-address': '127.0.0.1', 'ip-address-type': 'ipv4', prefix: 8 },
            { 'ip-address': '::1', 'ip-address-type': 'ipv6', prefix: 128 },
          ],
        },
        {
          name: 'ens18',
          'hardware-address': 'bc:24:11:c0:f0:6f',
          'ip-addresses': [
            { 'ip-address': '10.42.0.151', 'ip-address-type': 'ipv4', prefix: 24 },
            { 'ip-address': 'fe80::be24:11ff:fec0:f06f', 'ip-address-type': 'ipv6', prefix: 64 },
          ],
        },
      ],
    }

    expect(extractLiveAddresses(payload)).toEqual({
      ips: ['10.42.0.151'],
      macs: ['BC:24:11:C0:F0:6F'],
    })
  })

  it('extracts routable addresses and MACs from a bare LXC interfaces payload', () => {
    const payload = [
      {
        name: 'lo',
        hwaddr: '00:00:00:00:00:00',
        inet: '127.0.0.1/8',
        inet6: '::1/128',
        'ip-addresses': [{ 'ip-address': '127.0.0.1' }],
      },
      {
        name: 'eth0',
        hwaddr: 'bc:24:11:98:b7:a3',
        inet: '192.168.1.10/24',
        inet6: 'fe80::be24:11ff:fe98:b7a3/64',
      },
    ]

    expect(extractLiveAddresses(payload)).toEqual({
      ips: ['192.168.1.10'],
      macs: ['BC:24:11:98:B7:A3'],
    })
  })

  it('returns empty arrays for malformed payloads', () => {
    expect(extractLiveAddresses({ result: null })).toEqual({ ips: [], macs: [] })
  })
})
