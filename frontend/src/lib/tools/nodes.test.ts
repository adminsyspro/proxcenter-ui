/**
 * `get_node_hardware` answers "how many interfaces does host X have?" with the
 * cards (#459). The network section mirrors lab host pve1: one card, the
 * bridge on top of it and a VLAN on the bridge.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { ToolContext } from './types'

const pveFetch = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...args: unknown[]) => pveFetch(...args) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id, name: id, baseUrl: 'https://pve:8006', apiToken: 't' }),
}))

const ctx: ToolContext = {
  snapshot: {
    clusters: [{ id: 'c1', name: 'PVE-PROD', nodeCount: 1, guestCount: 0 }],
    nodes: [{ connId: 'c1', cluster: 'PVE-PROD', name: 'pve1', status: 'online', cpuPct: 1, memPct: 1, memUsedGb: 1, memTotalGb: 8 }],
    guests: [],
    summary: { totalGuests: 0, runningGuests: 0, stoppedGuests: 0, totalNodes: 1, onlineNodes: 1 },
    cached: false,
  },
  tenantId: 't',
  locale: 'en',
}

beforeEach(() => {
  pveFetch.mockReset().mockImplementation(async (_conn: unknown, path: string) => {
    if (path.endsWith('/network')) {
      return [
        { iface: 'vmbr0', type: 'bridge', active: 1, bridge_ports: 'nic0' },
        { iface: 'nic0', type: 'eth', active: 1 },
        { iface: 'vmbr0.4000', type: 'vlan', active: 1, 'vlan-id': 4000 },
      ]
    }

    return path.endsWith('/disks/list') ? [] : { cpuinfo: { cpus: 4 }, memory: { total: 8, used: 1 }, rootfs: { total: 1, used: 0 } }
  })
})

describe('get_node_hardware network section', () => {
  it('counts the cards as interfaces and the bridge and VLAN apart', async () => {
    const { getNodeHardwareTool } = await import('./nodes')

    const res = await getNodeHardwareTool.execute({ node: 'pve1' }, ctx) as any

    expect(res.network.interfaceCount).toBe(1)
    expect(res.network.softwareInterfaceCount).toBe(2)
    expect(res.network.interfaceCountByType).toEqual({ bridge: 1, eth: 1, vlan: 1 })
    expect(res.network.interfaces.map((i: any) => i.iface)).toEqual(['nic0'])
    expect(res.network.softwareInterfaces.map((i: any) => i.iface)).toEqual(['vmbr0', 'vmbr0.4000'])
  })
})
