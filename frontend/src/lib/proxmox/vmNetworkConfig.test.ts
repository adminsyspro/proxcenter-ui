import { test, expect } from 'vitest'
import { parseVmStaticIPs, parseVmSmbiosUuid, parseVmStaticIpForKey } from './vmNetworkConfig'

test('QEMU static IP from ipconfigN, CIDR stripped', () => {
  expect(parseVmStaticIPs({ net0: 'virtio,bridge=vmbr0', ipconfig0: 'ip=10.0.0.11/24,gw=10.0.0.1' }, 'qemu')).toEqual(['10.0.0.11'])
})
test('QEMU dhcp yields no static IP', () => {
  expect(parseVmStaticIPs({ net0: 'virtio,bridge=vmbr0', ipconfig0: 'ip=dhcp' }, 'qemu')).toEqual([])
})
test('LXC static IP from netN ip=', () => {
  expect(parseVmStaticIPs({ net0: 'name=eth0,bridge=vmbr0,ip=10.0.0.12/24' }, 'lxc')).toEqual(['10.0.0.12'])
})
test('smbios uuid parsed + lowercased', () => {
  expect(parseVmSmbiosUuid({ smbios1: 'uuid=ABCDEF00-1234-5678-9ABC-DEF012345678,manufacturer=x' })).toBe('abcdef00-1234-5678-9abc-def012345678')
})
test('no smbios -> null, malformed -> null', () => {
  expect(parseVmSmbiosUuid({})).toBeNull()
  expect(parseVmSmbiosUuid({ smbios1: 'uuid=not-a-uuid' })).toBeNull()
})

// ── parseVmStaticIpForKey ──────────────────────────────────────────────────

test('parseVmStaticIpForKey: QEMU valid ip+cidr', () => {
  const config = { net0: 'virtio,bridge=vmbr0', ipconfig0: 'ip=10.0.0.5/24,gw=10.0.0.1' }
  expect(parseVmStaticIpForKey(config, 'qemu', 'net0')).toEqual({ ip: '10.0.0.5', cidr: 24 })
})

test('parseVmStaticIpForKey: LXC valid ip+cidr', () => {
  const config = { net0: 'name=eth0,bridge=vmbr0,ip=192.168.1.10/16' }
  expect(parseVmStaticIpForKey(config, 'lxc', 'net0')).toEqual({ ip: '192.168.1.10', cidr: 16 })
})

test('parseVmStaticIpForKey: dhcp -> {ip:null,cidr:null}', () => {
  const config = { net0: 'virtio,bridge=vmbr0', ipconfig0: 'ip=dhcp' }
  expect(parseVmStaticIpForKey(config, 'qemu', 'net0')).toEqual({ ip: null, cidr: null })
})

test('parseVmStaticIpForKey: auto -> {ip:null,cidr:null}', () => {
  const config = { net0: 'name=eth0,bridge=vmbr0,ip=auto' }
  expect(parseVmStaticIpForKey(config, 'lxc', 'net0')).toEqual({ ip: null, cidr: null })
})

test('parseVmStaticIpForKey: invalid ip= -> {ip:null,cidr:null}', () => {
  const config = { net0: 'virtio,bridge=vmbr0', ipconfig0: 'ip=not-a-real-ip/24' }
  expect(parseVmStaticIpForKey(config, 'qemu', 'net0')).toEqual({ ip: null, cidr: null })
})

test('parseVmStaticIpForKey: missing key -> {ip:null,cidr:null}', () => {
  const config = { net0: 'virtio,bridge=vmbr0' }
  expect(parseVmStaticIpForKey(config, 'qemu', 'net99')).toEqual({ ip: null, cidr: null })
})

// ── multi-NIC desync regression ────────────────────────────────────────────

// net0: valid IP, net1: invalid ip= (passes pre-scan, fails isValidIp), net2: valid IP.
// The old zip logic would advance ipIdx on net1's slot and hand net2 the wrong IP.
// With parseVmStaticIpForKey, each key is resolved independently so no desync can occur.
test('multi-NIC: invalid ip= on net1 does not desync net2', () => {
  const config = {
    net0: 'virtio,bridge=vmbr0',
    ipconfig0: 'ip=10.0.0.1/24,gw=10.0.0.254',
    net1: 'virtio,bridge=vmbr0',
    ipconfig1: 'ip=not-a-real-ip/24',
    net2: 'virtio,bridge=vmbr0',
    ipconfig2: 'ip=10.0.0.3/24,gw=10.0.0.254',
  }

  // parseVmStaticIPs collects only valid IPs: net1 is skipped.
  expect(parseVmStaticIPs(config, 'qemu')).toEqual(['10.0.0.1', '10.0.0.3'])

  // Per-key lookups: each key resolves its own IP independently.
  expect(parseVmStaticIpForKey(config, 'qemu', 'net0')).toEqual({ ip: '10.0.0.1', cidr: 24 })
  expect(parseVmStaticIpForKey(config, 'qemu', 'net1')).toEqual({ ip: null, cidr: null })
  expect(parseVmStaticIpForKey(config, 'qemu', 'net2')).toEqual({ ip: '10.0.0.3', cidr: 24 })
})
