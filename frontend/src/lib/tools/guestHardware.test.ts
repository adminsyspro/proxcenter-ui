/**
 * `get_guest_hardware`: one guest's sizing from its Proxmox config, and the
 * space really consumed when something can measure it (#459). Proxmox reports
 * 0 used for a qemu guest without an agent, so "unknown" must never read as 0.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { SnapshotGuest } from '@/lib/tools/snapshot'
import { ToolScopeError, type ToolContext } from './types'

const GB = 1024 ** 3
const pveFetch = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...args: unknown[]) => pveFetch(...args) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id, name: id, baseUrl: 'https://pve:8006', apiToken: 't' }),
}))

function guest(o: Partial<SnapshotGuest> & { name: string; vmid: string }): SnapshotGuest {
  return {
    connId: 'conn-1', cluster: 'PVE-PROD', type: 'VM', kind: 'qemu', status: 'running', node: 'pve1',
    cpuPct: 5, memPct: 40, memUsedGb: 2, memTotalGb: 8, vcpus: 4, diskTotalGb: 32, template: false,
    ...o,
  }
}

const ctx: ToolContext = {
  snapshot: {
    clusters: [{ id: 'conn-1', name: 'PVE-PROD', nodeCount: 1, guestCount: 3 }],
    nodes: [],
    guests: [
      guest({ name: 'Win2025', vmid: '102' }),
      guest({ name: 'idle-01', vmid: '150', status: 'stopped' }),
      guest({ name: 'ct-web', vmid: '200', type: 'CT', kind: 'lxc', diskUsedGb: 3.2, diskTotalGb: 8 }),
    ],
    summary: { totalGuests: 3, runningGuests: 2, stoppedGuests: 1, totalNodes: 1, onlineNodes: 1 },
    cached: false,
  },
  tenantId: 't',
  locale: 'en',
}

const qemuConfig = {
  cores: 2,
  sockets: 2,
  cpu: 'x86-64-v2-AES',
  memory: 8192,
  bios: 'ovmf',
  ostype: 'win11',
  agent: '1,fstrim_cloned_disks=1',
  scsi0: 'local-lvm:vm-102-disk-0,size=32G',
  efidisk0: 'local-lvm:vm-102-disk-1,size=4M',
  ide2: 'local:iso/virtio-win.iso,media=cdrom',
  net0: 'virtio=BC:24:11:AA:BB:CC,bridge=vmbr0,tag=100,firewall=1',
}

async function hardware(ref: string) {
  const { getGuestHardwareTool } = await import('./guests')

  return getGuestHardwareTool.execute({ guest: ref }, ctx) as Promise<any>
}

beforeEach(() => {
  pveFetch.mockReset().mockImplementation(async (_conn: unknown, path: string) => {
    if (path.endsWith('/agent/get-fsinfo')) {
      return {
        result: [
          { name: 'C:\\', mountpoint: 'C:\\', type: 'NTFS', 'total-bytes': 31 * GB, 'used-bytes': 14 * GB },
          { name: 'C:\\', mountpoint: 'C:\\', type: 'NTFS', 'total-bytes': 31 * GB, 'used-bytes': 14 * GB },
          { name: 'tmpfs', mountpoint: '/run', type: 'tmpfs', 'total-bytes': 1 * GB, 'used-bytes': 0 },
        ],
      }
    }

    return path.endsWith('/config') ? { ...qemuConfig, cores: path.includes('/lxc/') ? undefined : 2 } : {}
  })
})

describe('get_guest_hardware', () => {
  it('reads the sizing of a qemu guest from its config', async () => {
    const res = await hardware('Win2025')

    expect(pveFetch.mock.calls[0][1]).toBe('/nodes/pve1/qemu/102/config')
    expect(res.guest).toMatchObject({ name: 'Win2025', vmid: '102', cluster: 'PVE-PROD' })
    expect(res.cpu).toEqual({ cores: 2, sockets: 2, vcpus: 4, cpuType: 'x86-64-v2-AES', numa: false })
    expect(res.memoryMb).toBe(8192)
    expect(res.agentEnabled).toBe(true)
    expect(res.interfaceCount).toBe(1)
    expect(res.networkInterfaces[0]).toMatchObject({ key: 'net0', bridge: 'vmbr0', vlanTag: 100 })
  })

  it('measures consumed space through the agent, counting a repeated filesystem once', async () => {
    const res = await hardware('102')

    expect(res.consumedSpace).toEqual({ available: true, usedGb: 14, totalGb: 31, usedPct: expect.any(Number), source: 'guest-agent' })
    expect(res.note).toBeUndefined()
  })

  it('says consumption is unknown when the agent does not answer, never 0', async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path.endsWith('/agent/get-fsinfo')) throw new Error('QEMU guest agent is not running')

      return qemuConfig
    })

    const res = await hardware('Win2025')

    expect(res.consumedSpace).toEqual({ available: false, reason: 'agent-unavailable' })
    expect(res.note).toMatch(/Do NOT present provisionedDiskGb/)
  })

  it('does not ask the agent of a stopped guest', async () => {
    const res = await hardware('idle-01')

    expect(res.consumedSpace).toEqual({ available: false, reason: 'guest-not-running' })
    expect(pveFetch.mock.calls.some(c => String(c[1]).includes('agent'))).toBe(false)
  })

  it('takes the Proxmox figure for a container, which has no agent', async () => {
    const res = await hardware('ct-web')

    expect(pveFetch.mock.calls[0][1]).toBe('/nodes/pve1/lxc/200/config')
    expect(res.consumedSpace).toMatchObject({ available: true, usedGb: 3.2, totalGb: 8, source: 'proxmox' })
    // No `cores` on an lxc means unlimited, not one core.
    expect(res.cpu.vcpus).toBeUndefined()
  })

  it('refuses a guest outside the snapshot before any Proxmox call', async () => {
    await expect(hardware('secret-vm')).rejects.toThrow(ToolScopeError)
    expect(pveFetch).not.toHaveBeenCalled()
  })
})
