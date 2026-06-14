import { describe, expect, it, beforeEach, vi } from 'vitest'

import {
  parseNetLine,
  parseIpconfigLine,
  stripMacFromNet,
  scanUsedIpsForSubnet,
  scannedToIntSet,
  invalidateScanCache,
  __clearScanCacheForTests,
} from './ipamScan'

beforeEach(() => {
  __clearScanCacheForTests()
})

describe('parseNetLine', () => {
  it('extracts bridge and MAC from a virtio line', () => {
    const r = parseNetLine('virtio=BC:24:11:AA:BB:CC,bridge=znewmspp,firewall=1')
    expect(r).toEqual({ bridge: 'znewmspp', mac: 'BC:24:11:AA:BB:CC' })
  })
  it('returns null mac when PVE auto-generates (no =MAC token)', () => {
    const r = parseNetLine('virtio,bridge=vmbr0')
    expect(r).toEqual({ bridge: 'vmbr0', mac: null })
  })
  it('uppercases the MAC for idempotency with the IPAM normalisation', () => {
    const r = parseNetLine('e1000=aa:bb:cc:dd:ee:ff,bridge=br0')
    expect(r.mac).toBe('AA:BB:CC:DD:EE:FF')
  })
  it('handles e1000 / rtl8139 / vmxnet3 model tokens', () => {
    expect(parseNetLine('rtl8139=AA:BB:CC:DD:EE:FF,bridge=b').mac).toBe('AA:BB:CC:DD:EE:FF')
    expect(parseNetLine('vmxnet3=AA:BB:CC:DD:EE:FF,bridge=b').mac).toBe('AA:BB:CC:DD:EE:FF')
  })
  it('returns null bridge when the line is malformed', () => {
    expect(parseNetLine('').bridge).toBeNull()
  })
})

describe('parseIpconfigLine', () => {
  it('extracts the v4 IP from ip=A.B.C.D/24,gw=...', () => {
    expect(parseIpconfigLine('ip=10.42.0.10/24,gw=10.42.0.1')).toEqual({ ip: '10.42.0.10' })
  })
  it('skips ip=dhcp (we do not track DHCP-assigned addresses)', () => {
    expect(parseIpconfigLine('ip=dhcp')).toEqual({ ip: null })
  })
  it('skips lines without ip= (e.g. ip6= only)', () => {
    expect(parseIpconfigLine('ip6=auto')).toEqual({ ip: null })
  })
  it('rejects malformed IPv4', () => {
    expect(parseIpconfigLine('ip=999.999.999.999/24')).toEqual({ ip: null })
  })
  it('handles bare ip=A.B.C.D without prefix', () => {
    expect(parseIpconfigLine('ip=10.0.0.5')).toEqual({ ip: '10.0.0.5' })
  })
})

describe('scannedToIntSet', () => {
  it('drops entries whose IP fails to parse', () => {
    const set = scannedToIntSet([
      { vmid: 1, mac: null, ip: '10.0.0.1' },
      { vmid: 2, mac: null, ip: 'bogus' },
    ])
    expect(set.size).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// scanUsedIpsForSubnet — uses a stubbed pveFetch so we don't hit the wire.
// ---------------------------------------------------------------------------

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: vi.fn(),
}))

import { pveFetch } from '@/lib/proxmox/client'

const fakeConn = { baseUrl: 'http://x', apiToken: 't' } as any

describe('scanUsedIpsForSubnet', () => {
  beforeEach(() => {
    vi.mocked(pveFetch).mockReset()
  })

  it('returns IPs from VMs attached to the target VNet only', async () => {
    vi.mocked(pveFetch).mockImplementation(async (_conn, path) => {
      if (path === '/pools/poolA') {
        return {
          members: [
            { vmid: 100, node: 'pve1', type: 'qemu' },
            { vmid: 101, node: 'pve1', type: 'qemu' },
            { vmid: 200, node: 'pve1', type: 'lxc' }, // skipped — LXC out of scope
          ],
        } as any
      }
      if (path === '/nodes/pve1/qemu/100/config') {
        return { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA', ipconfig0: 'ip=10.42.0.5/24,gw=10.42.0.1' } as any
      }
      if (path === '/nodes/pve1/qemu/101/config') {
        // attached to a DIFFERENT bridge — must be ignored
        return { net0: 'virtio=AA:00:00:00:00:02,bridge=tenantB', ipconfig0: 'ip=10.43.0.5/24' } as any
      }
      throw new Error(`unexpected fetch ${path}`)
    })

    const out = await scanUsedIpsForSubnet({
      conn: fakeConn,
      vdcPoolName: 'poolA',
      vnetPveName: 'tenantA',
      subnetId: 'subnet-1',
      connectionId: 'conn-1',
    })
    expect(out).toEqual([{ vmid: 100, mac: 'AA:00:00:00:00:01', ip: '10.42.0.5' }])
  })

  it('skips NICs without a static ipconfig (DHCP, missing line)', async () => {
    vi.mocked(pveFetch).mockImplementation(async (_conn, path) => {
      if (path === '/pools/poolA') {
        return { members: [{ vmid: 100, node: 'pve1', type: 'qemu' }, { vmid: 101, node: 'pve1', type: 'qemu' }] } as any
      }
      if (path === '/nodes/pve1/qemu/100/config') {
        return { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA', ipconfig0: 'ip=dhcp' } as any
      }
      if (path === '/nodes/pve1/qemu/101/config') {
        return { net0: 'virtio=AA:00:00:00:00:02,bridge=tenantA' /* no ipconfig0 at all */ } as any
      }
      throw new Error(`unexpected fetch ${path}`)
    })

    const out = await scanUsedIpsForSubnet({
      conn: fakeConn,
      vdcPoolName: 'poolA',
      vnetPveName: 'tenantA',
      subnetId: 'subnet-1',
      connectionId: 'conn-1',
    })
    expect(out).toEqual([])
  })

  it('handles multi-NIC VMs (records every IP attached to the target VNet)', async () => {
    vi.mocked(pveFetch).mockImplementation(async (_conn, path) => {
      if (path === '/pools/poolA') {
        return { members: [{ vmid: 100, node: 'pve1', type: 'qemu' }] } as any
      }
      if (path === '/nodes/pve1/qemu/100/config') {
        return {
          net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA',
          ipconfig0: 'ip=10.42.0.5/24',
          net1: 'virtio=AA:00:00:00:00:02,bridge=tenantA',
          ipconfig1: 'ip=10.42.0.6/24',
          net2: 'virtio=AA:00:00:00:00:03,bridge=otherbridge',
          ipconfig2: 'ip=10.99.0.5/24',
        } as any
      }
      throw new Error(`unexpected fetch ${path}`)
    })

    const out = await scanUsedIpsForSubnet({
      conn: fakeConn,
      vdcPoolName: 'poolA',
      vnetPveName: 'tenantA',
      subnetId: 'subnet-1',
      connectionId: 'conn-1',
    })
    expect(out.map(r => r.ip).sort((a, b) => a.localeCompare(b))).toEqual(['10.42.0.5', '10.42.0.6'])
  })

  it('caches the result for the second call within the TTL', async () => {
    vi.mocked(pveFetch).mockImplementation(async (_conn, path) => {
      if (path === '/pools/poolA') {
        return { members: [{ vmid: 100, node: 'pve1', type: 'qemu' }] } as any
      }
      if (path === '/nodes/pve1/qemu/100/config') {
        return { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA', ipconfig0: 'ip=10.42.0.5/24' } as any
      }
      throw new Error('unexpected')
    })

    const args = {
      conn: fakeConn,
      vdcPoolName: 'poolA',
      vnetPveName: 'tenantA',
      subnetId: 'subnet-1',
      connectionId: 'conn-1',
    }
    await scanUsedIpsForSubnet(args)
    await scanUsedIpsForSubnet(args)
    // 1 pool fetch + 1 config fetch = 2 calls total despite scanning twice.
    expect(vi.mocked(pveFetch)).toHaveBeenCalledTimes(2)
  })

  it('invalidateScanCache forces a re-fetch on the next call', async () => {
    vi.mocked(pveFetch).mockImplementation(async (_conn, path) => {
      if (path === '/pools/poolA') {
        return { members: [{ vmid: 100, node: 'pve1', type: 'qemu' }] } as any
      }
      if (path === '/nodes/pve1/qemu/100/config') {
        return { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA', ipconfig0: 'ip=10.42.0.5/24' } as any
      }
      throw new Error('unexpected')
    })

    const args = {
      conn: fakeConn,
      vdcPoolName: 'poolA',
      vnetPveName: 'tenantA',
      subnetId: 'subnet-1',
      connectionId: 'conn-1',
    }
    await scanUsedIpsForSubnet(args)
    invalidateScanCache('conn-1', 'subnet-1')
    await scanUsedIpsForSubnet(args)
    expect(vi.mocked(pveFetch)).toHaveBeenCalledTimes(4)
  })

  it('degrades to an empty scan when /pools fails (e.g. RBAC)', async () => {
    vi.mocked(pveFetch).mockRejectedValueOnce(new Error('403 Forbidden'))
    const out = await scanUsedIpsForSubnet({
      conn: fakeConn,
      vdcPoolName: 'poolA',
      vnetPveName: 'tenantA',
      subnetId: 'subnet-1',
      connectionId: 'conn-1',
    })
    expect(out).toEqual([])
  })

  it('skips a VM whose config fetch fails but keeps the others', async () => {
    vi.mocked(pveFetch).mockImplementation(async (_conn, path) => {
      if (path === '/pools/poolA') {
        return { members: [{ vmid: 100, node: 'pve1', type: 'qemu' }, { vmid: 101, node: 'pve1', type: 'qemu' }] } as any
      }
      if (path === '/nodes/pve1/qemu/100/config') {
        throw new Error('config-not-found')
      }
      if (path === '/nodes/pve1/qemu/101/config') {
        return { net0: 'virtio=AA:00:00:00:00:02,bridge=tenantA', ipconfig0: 'ip=10.42.0.6/24' } as any
      }
      throw new Error(`unexpected fetch ${path}`)
    })

    const out = await scanUsedIpsForSubnet({
      conn: fakeConn,
      vdcPoolName: 'poolA',
      vnetPveName: 'tenantA',
      subnetId: 'subnet-1',
      connectionId: 'conn-1',
    })
    expect(out).toEqual([{ vmid: 101, mac: 'AA:00:00:00:00:02', ip: '10.42.0.6' }])
  })
})

describe('stripMacFromNet', () => {
  it('drops the MAC from the canonical model=MAC form so PVE regenerates it', () => {
    expect(stripMacFromNet('virtio=BC:24:11:AA:BB:CC,bridge=tenantA,tag=10'))
      .toBe('virtio,bridge=tenantA,tag=10')
  })

  it('drops the macaddr= token from the alt form', () => {
    expect(stripMacFromNet('virtio,bridge=tenantA,macaddr=BC:24:11:AA:BB:CC,firewall=1'))
      .toBe('virtio,bridge=tenantA,firewall=1')
  })

  it('handles every supported model token', () => {
    expect(stripMacFromNet('e1000=AA:BB:CC:DD:EE:FF,bridge=b')).toBe('e1000,bridge=b')
    expect(stripMacFromNet('rtl8139=AA:BB:CC:DD:EE:FF,bridge=b')).toBe('rtl8139,bridge=b')
    expect(stripMacFromNet('vmxnet3=AA:BB:CC:DD:EE:FF,bridge=b')).toBe('vmxnet3,bridge=b')
  })

  it('leaves a line with no pinned MAC unchanged', () => {
    expect(stripMacFromNet('virtio,bridge=vmbr0')).toBe('virtio,bridge=vmbr0')
  })

  it('preserves the other NIC options and their order', () => {
    expect(stripMacFromNet('virtio=BC:24:11:00:00:01,bridge=tenantA,tag=20,firewall=1,mtu=1400'))
      .toBe('virtio,bridge=tenantA,tag=20,firewall=1,mtu=1400')
  })

  it('returns an empty string for empty input', () => {
    expect(stripMacFromNet('')).toBe('')
  })
})
