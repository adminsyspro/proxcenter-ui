import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { pveFetchMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(conn: any, path: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

import {
  GUEST_IP_REFRESH_MS,
  GUEST_IP_RETENTION_MS,
  __resetGuestIpIndexForTests,
  getGuestIpEntry,
  getGuestIpIndex,
  getGuestIpInflight,
  invalidateGuestIpIndex,
  setGuestIpIndex,
} from '@/lib/cache/guestIpCache'
import { attachGuestIps, liveAddressesPath, refreshGuestIpIndex, scheduleGuestIpRefresh } from './guestIpIndex'

const CONN = { baseUrl: 'https://pve.test', apiToken: 'x' }

beforeEach(() => {
  vi.clearAllMocks()
  __resetGuestIpIndexForTests()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('liveAddressesPath', () => {
  it('returns null for stopped guests and QEMU guests without the agent', () => {
    expect(liveAddressesPath({ vmid: 100, node: 'n1', type: 'qemu', status: 'stopped', agentEnabled: true })).toBeNull()
    expect(liveAddressesPath({ vmid: 100, node: 'n1', type: 'qemu', status: 'running' })).toBeNull()
  })

  it('builds the LXC interfaces path for a running container', () => {
    expect(liveAddressesPath({ vmid: 101, node: 'n1', type: 'lxc', status: 'running' }))
      .toBe('/nodes/n1/lxc/101/interfaces')
  })

  it('builds the QEMU agent path when the agent is enabled', () => {
    expect(liveAddressesPath({ vmid: 100, node: 'n1', type: 'qemu', status: 'running', agentEnabled: true }))
      .toBe('/nodes/n1/qemu/100/agent/network-get-interfaces')
  })

  it('URI-encodes node names and vmids', () => {
    expect(liveAddressesPath({ vmid: '10/1', node: 'node/a', type: 'lxc', status: 'running' }))
      .toBe('/nodes/node%2Fa/lxc/10%2F1/interfaces')
  })
})

describe('refreshGuestIpIndex', () => {
  it('rebuilds the index from probes and carries usable previous entries as stale', async () => {
    const now = 1_000_000_000
    setGuestIpIndex('conn-1', new Map([
      ['qemu/102', { ips: ['10.0.0.102'], macs: ['AA:AA:AA:AA:AA:02'], seenAt: now - 100, stale: false }],
      ['qemu/104', { ips: ['10.0.0.104'], macs: [], seenAt: now - GUEST_IP_RETENTION_MS - 1, stale: false }],
      ['qemu/105', { ips: ['10.0.0.105'], macs: ['AA:AA:AA:AA:AA:05'], seenAt: now - 100, stale: false }],
    ]), now - GUEST_IP_REFRESH_MS)
    pveFetchMock.mockImplementation(async (_conn, path) => {
      if (path.includes('/qemu/100/')) {
        return { result: [{
          'hardware-address': 'bc:24:11:c0:f0:6f',
          'ip-addresses': [{ 'ip-address': '10.42.0.151' }],
        }] }
      }
      if (path.includes('/lxc/101/')) {
        return [{ hwaddr: 'bc:24:11:98:b7:a3', inet: '192.168.1.10/24' }]
      }
      if (path.includes('/qemu/105/')) {
        return { result: [{
          'hardware-address': 'bc:24:11:00:00:05',
          'ip-addresses': [{ 'ip-address': '127.0.0.1' }, { 'ip-address': 'fe80::1' }],
        }] }
      }
      throw new Error('probe failed')
    })
    const guests = [
      { vmid: 100, node: 'n1', type: 'qemu', status: 'running', agentEnabled: true },
      { vmid: 101, node: 'n1', type: 'lxc', status: 'running' },
      { vmid: 102, node: 'n1', type: 'qemu', status: 'running', agentEnabled: true },
      { vmid: 103, node: 'n1', type: 'qemu', status: 'running', agentEnabled: true },
      { vmid: 104, node: 'n1', type: 'qemu', status: 'stopped', agentEnabled: true },
      { vmid: 105, node: 'n1', type: 'qemu', status: 'running', agentEnabled: true },
    ]

    await refreshGuestIpIndex('conn-1', CONN, guests, now)

    expect(pveFetchMock).toHaveBeenCalledTimes(5)
    expect(pveFetchMock.mock.calls.map(([, path]) => path)).toEqual([
      '/nodes/n1/qemu/100/agent/network-get-interfaces',
      '/nodes/n1/lxc/101/interfaces',
      '/nodes/n1/qemu/102/agent/network-get-interfaces',
      '/nodes/n1/qemu/103/agent/network-get-interfaces',
      '/nodes/n1/qemu/105/agent/network-get-interfaces',
    ])
    expect(getGuestIpEntry('conn-1', 'qemu/100')).toEqual({
      ips: ['10.42.0.151'], macs: ['BC:24:11:C0:F0:6F'], seenAt: now, stale: false,
    })
    expect(getGuestIpEntry('conn-1', 'lxc/101')).toEqual({
      ips: ['192.168.1.10'], macs: ['BC:24:11:98:B7:A3'], seenAt: now, stale: false,
    })
    expect(getGuestIpEntry('conn-1', 'qemu/102')).toEqual({
      ips: ['10.0.0.102'], macs: ['AA:AA:AA:AA:AA:02'], seenAt: now - 100, stale: true,
    })
    expect(getGuestIpEntry('conn-1', 'qemu/103')).toBeNull()
    expect(getGuestIpEntry('conn-1', 'qemu/104')).toBeNull()
    expect(getGuestIpEntry('conn-1', 'qemu/105')).toEqual({
      ips: ['10.0.0.105'], macs: ['AA:AA:AA:AA:AA:05'], seenAt: now - 100, stale: true,
    })
  })
})

describe('refreshGuestIpIndex generation guard', () => {
  it('drops the result of a refresh whose connection was invalidated while probing', async () => {
    let release: (value: unknown) => void = () => {}
    pveFetchMock.mockImplementation(() => new Promise(resolve => { release = resolve }))
    const guests = [{ vmid: 100, node: 'n1', type: 'qemu', status: 'running', agentEnabled: true }]

    const run = refreshGuestIpIndex('conn-1', CONN, guests)
    invalidateGuestIpIndex('conn-1')
    release({ result: [{ name: 'ens18', 'hardware-address': 'bc:24:11:c0:f0:6f', 'ip-addresses': [{ 'ip-address': '10.42.0.151', 'ip-address-type': 'ipv4', prefix: 24 }] }] })
    await run

    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(getGuestIpIndex('conn-1')).toBeNull()
  })
})

describe('scheduleGuestIpRefresh', () => {
  it('reports the first build and locks duplicate back-to-back refreshes', async () => {
    let finishProbe: ((value: any) => void) | undefined
    pveFetchMock.mockReturnValue(new Promise(resolve => {
      finishProbe = resolve
    }))
    const guests = [{ vmid: 100, node: 'n1', type: 'qemu', status: 'running', agentEnabled: true }]

    expect(scheduleGuestIpRefresh('conn-1', CONN, guests)).toBe(true)
    expect(scheduleGuestIpRefresh('conn-1', CONN, guests)).toBe(true)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)

    const inflight = getGuestIpInflight('conn-1')
    finishProbe?.({ result: [{ 'ip-addresses': [{ 'ip-address': '10.0.0.5' }] }] })
    await inflight

    expect(getGuestIpInflight('conn-1')).toBeNull()
  })

  it('skips a fresh index and refreshes it again after the interval', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(10_000)
    setGuestIpIndex('conn-1', new Map(), Date.now())
    const guests = [{ vmid: 100, node: 'n1', type: 'qemu', status: 'running', agentEnabled: true }]
    pveFetchMock.mockResolvedValue({ result: [{ 'ip-addresses': [{ 'ip-address': '10.0.0.5' }] }] })

    expect(scheduleGuestIpRefresh('conn-1', CONN, guests)).toBe(false)
    expect(pveFetchMock).not.toHaveBeenCalled()

    vi.setSystemTime(10_000 + GUEST_IP_REFRESH_MS)
    expect(scheduleGuestIpRefresh('conn-1', CONN, guests)).toBe(false)
    await getGuestIpInflight('conn-1')

    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })
})

describe('attachGuestIps', () => {
  it('merges config and live identities, deduplicates them and marks only live IPs stale', () => {
    setGuestIpIndex('conn-1', new Map([
      ['qemu/100', {
        ips: ['10.0.0.5', '10.0.0.6'],
        macs: ['BC:24:11:C0:F0:6F', 'BC:24:11:AA:BB:CC'],
        seenAt: Date.now(),
        stale: true,
      }],
      ['qemu/102', {
        ips: [],
        macs: ['BC:24:11:00:00:02'],
        seenAt: Date.now(),
        stale: true,
      }],
    ]))
    const guests = [
      {
        vmid: 100, node: 'n1', type: 'qemu', status: 'stopped',
        configIps: ['10.0.0.5'], macs: ['BC:24:11:C0:F0:6F'],
      },
      {
        vmid: 101, node: 'n1', type: 'lxc', status: 'stopped',
        configIps: ['192.168.1.10'], macs: ['BC:24:11:98:B7:A3'],
      },
      {
        vmid: 102, node: 'n1', type: 'qemu', status: 'stopped',
        configIps: [], macs: [],
      },
    ]

    const result = attachGuestIps('conn-1', CONN, guests)

    expect(result.warming).toBe(false)
    expect(result.vms[0]).toMatchObject({
      ips: ['10.0.0.5', '10.0.0.6'],
      macs: ['BC:24:11:C0:F0:6F', 'BC:24:11:AA:BB:CC'],
      staleIps: ['10.0.0.5', '10.0.0.6'],
    })
    expect(result.vms[1]).toMatchObject({
      ips: ['192.168.1.10'], macs: ['BC:24:11:98:B7:A3'], staleIps: [],
    })
    expect(result.vms[2]).toMatchObject({
      ips: [], macs: ['BC:24:11:00:00:02'], staleIps: [],
    })
  })

  it('does not schedule a rebuild when the caller says its enumeration failed', () => {
    setGuestIpIndex('conn-1', new Map([
      ['qemu/100', { ips: ['10.0.0.5'], macs: [], seenAt: Date.now(), stale: false }],
    ]), Date.now() - GUEST_IP_REFRESH_MS - 1)

    const result = attachGuestIps('conn-1', CONN, [], { refresh: false })

    expect(result.warming).toBe(false)
    expect(getGuestIpInflight('conn-1')).toBeNull()
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(getGuestIpIndex('conn-1')?.get('qemu/100')?.ips).toEqual(['10.0.0.5'])
  })

  it('mirrors the first-build warming state', async () => {
    const result = attachGuestIps('conn-1', CONN, [])
    const inflight = getGuestIpInflight('conn-1')

    expect(result.warming).toBe(true)
    await inflight
    expect(getGuestIpInflight('conn-1')).toBeNull()
  })
})
