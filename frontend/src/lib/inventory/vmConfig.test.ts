import { describe, expect, it, vi, beforeEach } from 'vitest'

const { pveFetchMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(conn: any, path: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

import { parseVmConfig, enrichVmsWithConfig } from './vmConfig'

const CONN = { baseUrl: 'https://pve.test', apiToken: 'x' }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseVmConfig', () => {
  it('extracts the config-drift fields #254 asks for', () => {
    expect(parseVmConfig({
      cpu: 'x86-64-v2-AES,flags=+nested-virt',
      scsihw: 'virtio-scsi-single',
      agent: '1,fstrim_cloned_disks=1',
      bios: 'ovmf',
      ostype: 'l26',
      onboot: 1,
      cores: 4,
      sockets: 2,
      memory: 8192,
    })).toEqual({
      cpuType: 'x86-64-v2-AES,flags=+nested-virt',
      scsihw: 'virtio-scsi-single',
      agentEnabled: true,
      bios: 'ovmf',
      ostype: 'l26',
      onboot: true,
      cores: 4,
      sockets: 2,
      memoryMb: 8192,
    })
  })

  it('reads the enabled= form and the disabled forms of the agent flag', () => {
    expect(parseVmConfig({ agent: 'enabled=1' }).agentEnabled).toBe(true)
    expect(parseVmConfig({ agent: '0' }).agentEnabled).toBe(false)
    expect(parseVmConfig({ agent: 'enabled=0,type=virtio' }).agentEnabled).toBe(false)
    expect(parseVmConfig({}).agentEnabled).toBe(false)
  })

  it('returns all-null fields for a null config', () => {
    expect(parseVmConfig(null)).toEqual({
      cpuType: null, scsihw: null, agentEnabled: false, bios: null,
      ostype: null, onboot: false, cores: null, sockets: null, memoryMb: null,
    })
  })
})

describe('enrichVmsWithConfig', () => {
  const vms = [
    { vmid: '100', node: 'n1', type: 'qemu', status: 'running' },
    { vmid: '101', node: 'dead', type: 'qemu', status: 'running' },
  ]

  it('serves config fields by default and never calls the offline node', async () => {
    pveFetchMock.mockResolvedValue({ cpu: 'host', scsihw: 'virtio-scsi-pci', agent: '1' })
    const out = await enrichVmsWithConfig(CONN, vms, new Set(['n1']))
    expect(out[0].cpuType).toBe('host')
    expect(out[0].agentEnabled).toBe(true)
    expect(out[1].cpuType).toBeNull()
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/nodes/n1/qemu/100/config')
  })

  it('uses the lxc path for containers', async () => {
    pveFetchMock.mockResolvedValue({ ostype: 'debian', onboot: 1 })
    await enrichVmsWithConfig(CONN, [{ vmid: '300', node: 'n1', type: 'lxc', status: 'running' }], new Set(['n1']))
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/nodes/n1/lxc/300/config')
  })

  it('never throws when a /config call fails', async () => {
    pveFetchMock.mockRejectedValue(new Error('HTTP 595'))
    const out = await enrichVmsWithConfig(CONN, [vms[0]], new Set(['n1']))
    expect(out[0].cpuType).toBeNull()
    expect(out[0].agentEnabled).toBe(false)
  })

  it('probes the agent only with includeAgent, only on running VMs with the flag ON', async () => {
    pveFetchMock.mockImplementation(async (_conn, path) => {
      if (path.endsWith('/config')) return { agent: '1' }
      if (path.endsWith('/agent/get-osinfo')) return { result: { 'pretty-name': 'Debian GNU/Linux 12' } }
      throw new Error('unexpected path')
    })
    const noProbe = await enrichVmsWithConfig(CONN, [vms[0]], new Set(['n1']))
    expect(noProbe[0].agentResponding).toBeUndefined()

    pveFetchMock.mockClear()
    const probed = await enrichVmsWithConfig(CONN, [vms[0]], new Set(['n1']), { includeAgent: true })
    expect(probed[0].agentResponding).toBe(true)
    expect(probed[0].agentOsName).toBe('Debian GNU/Linux 12')

    pveFetchMock.mockClear()
    pveFetchMock.mockResolvedValue({ agent: '1' })
    const stopped = await enrichVmsWithConfig(
      CONN, [{ ...vms[0], status: 'stopped' }], new Set(['n1']), { includeAgent: true },
    )
    expect(stopped[0].agentResponding).toBe(false)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it('reports agentResponding false when the probe fails (flag ON, agent not installed)', async () => {
    pveFetchMock.mockImplementation(async (_conn, path) => {
      if (path.endsWith('/config')) return { agent: '1' }
      throw new Error('HTTP 500')
    })
    const out = await enrichVmsWithConfig(CONN, [vms[0]], new Set(['n1']), { includeAgent: true })
    expect(out[0].agentResponding).toBe(false)
    expect(out[0].agentOsName).toBeNull()
  })
})
