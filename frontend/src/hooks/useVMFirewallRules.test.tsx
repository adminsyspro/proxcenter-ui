/**
 * Coverage for the bounded VM firewall scan and its single-guest refresh.
 *
 * The inventory request and per-guest config requests share `fetch`, while the
 * firewall adapter supplies rules and options. Keeping those mocks separate
 * lets these tests assert the scan cap and batch size without depending on any
 * route handlers. No automatic RTL cleanup is configured in this repo.
 */

import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { FirewallRule } from '@/lib/api/firewall'

vi.mock('@/lib/api/firewall', () => ({
  getVMRules: vi.fn(),
  getVMOptions: vi.fn(),
}))

import * as firewallAPI from '@/lib/api/firewall'

import { useVMFirewallRules, type VMFirewallInfo } from './useVMFirewallRules'

interface Guest {
  vmid: string
  name: string
  node: string
  type: 'qemu' | 'lxc'
  status: string
  template?: boolean
}

const getVMRules = vi.mocked(firewallAPI.getVMRules)
const getVMOptions = vi.mocked(firewallAPI.getVMOptions)

const rule = (pos: number): FirewallRule => ({ pos, type: 'in', action: 'ACCEPT', enable: 1 })

function guest(vmid: number, overrides: Partial<Guest> = {}): Guest {
  return {
    vmid: String(vmid),
    name: `guest-${vmid}`,
    node: 'pve1',
    type: 'qemu',
    status: 'running',
    ...overrides,
  }
}

function vm(vmid: number, overrides: Partial<VMFirewallInfo> = {}): VMFirewallInfo {
  return {
    vmid,
    name: `guest-${vmid}`,
    node: 'pve1',
    type: 'qemu',
    status: 'running',
    firewallEnabled: false,
    rules: [],
    options: null,
    vlans: [],
    ...overrides,
  }
}

/** Mock the inventory response and the config returned for each scanned guest. */
function mockGuestScan(
  guests: Guest[],
  configs: Record<number, Record<string, unknown> | null> = {},
) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)

    if (url.startsWith('/api/v1/vms?')) {
      return { json: async () => ({ data: { vms: guests } }) } as Response
    }

    const vmid = Number(url.match(/\/(\d+)\/config$/)?.[1])
    const config = Object.hasOwn(configs, vmid) ? configs[vmid] : {}

    return { json: async () => config === null ? null : { data: config } } as Response
  })

  vi.stubGlobal('fetch', fetchMock)

  return fetchMock
}

beforeEach(() => {
  getVMRules.mockReset().mockResolvedValue([])
  getVMOptions.mockReset().mockResolvedValue({ enable: 1 })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useVMFirewallRules', () => {
  it('caps a 250-guest inventory at 200 and reports the 50 skipped guests', async () => {
    const guests = Array.from({ length: 250 }, (_, index) => guest(1000 + index))

    mockGuestScan(guests)

    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    await act(async () => {
      await result.current.loadVMFirewallData()
    })

    expect(result.current.vmFirewallData).toHaveLength(200)
    expect(result.current.guestsNotScanned).toBe(50)
    expect(getVMRules).toHaveBeenCalledTimes(200)
    expect(getVMOptions).toHaveBeenCalledTimes(200)
    expect(result.current.vmFirewallData.map(item => item.vmid)).not.toContain(1200)
  })

  it('scans every non-template guest below the cap and excludes templates', async () => {
    mockGuestScan([
      guest(100),
      guest(101, { template: true }),
      guest(102, { type: 'lxc' }),
      guest(103, { template: true }),
    ])

    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    await act(async () => {
      await result.current.loadVMFirewallData()
    })

    expect(result.current.guestsNotScanned).toBe(0)
    expect(result.current.vmFirewallData.map(item => item.vmid)).toEqual([100, 102])
    expect(getVMRules).toHaveBeenCalledTimes(2)
  })

  it('never has more than eight guest rule requests in flight', async () => {
    let inFlight = 0
    let maximumInFlight = 0

    mockGuestScan(Array.from({ length: 17 }, (_, index) => guest(200 + index)))
    getVMRules.mockImplementation(async () => {
      inFlight += 1
      maximumInFlight = Math.max(maximumInFlight, inFlight)

      await new Promise<void>(resolve => setTimeout(resolve, 0))

      inFlight -= 1

      return []
    })

    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    await act(async () => {
      await result.current.loadVMFirewallData()
    })

    expect(getVMRules).toHaveBeenCalledTimes(17)
    expect(maximumInFlight).toBe(8)
  })

  it('keeps a guest whose rules request fails, with an empty rules array', async () => {
    mockGuestScan([guest(300), guest(301)])
    getVMRules.mockImplementation(async (_connectionId, _node, _type, vmid) => {
      if (Number(vmid) === 301) throw new Error('rules unavailable')

      return [rule(0)]
    })

    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    await act(async () => {
      await result.current.loadVMFirewallData()
    })

    expect(result.current.vmFirewallData).toHaveLength(2)
    expect(result.current.vmFirewallData.find(item => item.vmid === 300)?.rules).toEqual([rule(0)])
    expect(result.current.vmFirewallData.find(item => item.vmid === 301)?.rules).toEqual([])
  })

  it('keeps a guest whose adapter call throws outright, rather than sinking the scan', async () => {
    mockGuestScan([guest(310), guest(311)])
    getVMRules.mockImplementation((_connectionId, _node, _type, vmid) => {
      // Thrown, not rejected: the per-call `.catch()` is never attached, so
      // only the guest-level guard keeps the other guests from being lost.
      if (Number(vmid) === 311) throw new Error('adapter unavailable')

      return Promise.resolve([rule(0)])
    })

    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    await act(async () => {
      await result.current.loadVMFirewallData()
    })

    expect(result.current.vmFirewallData).toHaveLength(2)
    expect(result.current.vmFirewallData.find(item => item.vmid === 311)).toMatchObject({
      name: 'guest-311', firewallEnabled: false, rules: [], options: null, vlans: [],
    })
  })

  it('names a guest PVE returned without one after its id', async () => {
    mockGuestScan([guest(320, { name: '' })])

    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    await act(async () => {
      await result.current.loadVMFirewallData()
    })

    expect(result.current.vmFirewallData[0].name).toBe('VM 320')
  })

  it('sorts firewall-enabled guests first, then sorts each tier by rule count', async () => {
    const rulesByGuest: Record<number, FirewallRule[]> = {
      400: [rule(0), rule(1), rule(2)],
      401: [rule(0)],
      402: [rule(0), rule(1)],
      403: [rule(0)],
    }

    mockGuestScan(
      [guest(400), guest(401), guest(402), guest(403)],
      {
        400: { net0: 'virtio=AA:00,tag=30' },
        401: { net0: 'virtio=AA:01,firewall=1,tag=20' },
        402: {
          net0: 'virtio=AA:02,firewall=1,tag=30',
          net1: 'virtio=AA:03,tag=10',
          net2: 'virtio=AA:04,tag=30',
        },
        403: {},
      },
    )
    getVMRules.mockImplementation(async (_connectionId, _node, _type, vmid) => rulesByGuest[Number(vmid)])

    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    await act(async () => {
      await result.current.loadVMFirewallData()
    })

    expect(result.current.vmFirewallData.map(item => item.vmid)).toEqual([402, 401, 400, 403])
    expect(result.current.vmFirewallData[0]).toMatchObject({ firewallEnabled: true, vlans: [10, 30] })
    expect(result.current.vmFirewallData[2].firewallEnabled).toBe(false)
  })

  it('reloads only the requested guest with its latest rules, options and NIC config', async () => {
    const first = vm(500, { rules: [rule(0)] })
    const untouched = vm(501, { name: 'leave-me-alone', rules: [rule(1)] })

    mockGuestScan([], {
      500: {
        net0: 'virtio=AA:05,firewall=1,tag=40',
        net1: 'virtio=AA:06,tag=10',
      },
    })
    getVMRules.mockResolvedValue([rule(7), rule(8)])
    getVMOptions.mockResolvedValue({ enable: 0, policy_in: 'DROP' })

    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    act(() => result.current.setVMFirewallData([first, untouched]))

    await act(async () => {
      await result.current.reloadVMFirewallRules(first)
    })

    expect(getVMRules).toHaveBeenCalledWith('conn-1', 'pve1', 'qemu', 500)
    expect(result.current.vmFirewallData[0]).toMatchObject({
      vmid: 500,
      firewallEnabled: true,
      rules: [rule(7), rule(8)],
      options: { enable: 0, policy_in: 'DROP' },
      vlans: [10, 40],
    })
    expect(result.current.vmFirewallData[1]).toEqual(untouched)
  })

  it('makes a second load a no-op until resetting the data', async () => {
    const fetchMock = mockGuestScan([guest(600)])
    const { result } = renderHook(() => useVMFirewallRules('conn-1'))

    await act(async () => {
      await result.current.loadVMFirewallData()
    })

    await act(async () => {
      await result.current.loadVMFirewallData()
    })

    expect(getVMRules).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/v1/vms?'))).toHaveLength(1)

    act(() => result.current.setVMFirewallData([]))

    await act(async () => {
      await result.current.loadVMFirewallData()
    })

    expect(getVMRules).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls.filter(([input]) => String(input).startsWith('/api/v1/vms?'))).toHaveLength(2)
  })
})
