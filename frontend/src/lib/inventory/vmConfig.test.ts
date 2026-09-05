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

  it('normalises non-finite numeric fields to null and reads onboot: 0 as false inside a non-null config', () => {
    expect(parseVmConfig({ cores: 'not-a-number', sockets: Infinity, memory: NaN, onboot: 0 })).toEqual({
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

  it('attempts the /config call when node status is unknown (null), rather than treating it as offline', async () => {
    pveFetchMock.mockResolvedValue({ cpu: 'host' })
    // onlineNodes === null: the /nodes call itself failed, so status is
    // UNKNOWN for every VM. That must not fall back silently to the
    // offline (zero-call) path.
    const out = await enrichVmsWithConfig(CONN, [vms[0]], null)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/nodes/n1/qemu/100/config')
    expect(out[0].cpuType).toBe('host')
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

  it('adds the QEMU config network identity and description to an enriched guest', async () => {
    pveFetchMock.mockResolvedValue({
      net0: 'virtio=BC:24:11:C0:F0:6F,bridge=vmbr0',
      ipconfig0: 'ip=10.0.0.5/24,gw=10.0.0.1',
      description: 'web front',
    })

    const out = await enrichVmsWithConfig(CONN, [vms[0]], new Set(['n1']))

    expect(out[0]).toMatchObject({
      macs: ['BC:24:11:C0:F0:6F'],
      configIps: ['10.0.0.5'],
      description: 'web front',
    })
  })

  it('adds an empty network identity on the confirmed-offline node path', async () => {
    const out = await enrichVmsWithConfig(CONN, [vms[1]], new Set(['n1']))

    expect(out[0]).toMatchObject({ macs: [], configIps: [], description: null })
    expect(pveFetchMock).not.toHaveBeenCalled()
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

  it('does not call the probe when the agent flag is OFF, even with includeAgent on a running qemu VM', async () => {
    pveFetchMock.mockImplementation(async (_conn, path) => {
      if (path.endsWith('/config')) return { agent: '0' }
      // If the agentEnabled gate were dropped, this branch would be hit.
      throw new Error(`unexpected path: ${path}`)
    })
    const out = await enrichVmsWithConfig(CONN, [vms[0]], new Set(['n1']), { includeAgent: true })
    expect(out[0].agentResponding).toBe(false)
    expect(out[0].agentOsName).toBeNull()
    // Load-bearing assertion: only the /config call happened, the probe was
    // never attempted. Dropping the `!fields.agentEnabled` gate makes this fail.
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not call the probe for LXC guests, even with includeAgent and the flag ON', async () => {
    pveFetchMock.mockImplementation(async (_conn, path) => {
      if (path.endsWith('/config')) return { agent: '1' }
      // If the qemu-only gate were dropped, this branch would be hit (the
      // probe URL is hardcoded to /qemu/.../agent/get-osinfo).
      throw new Error(`unexpected path: ${path}`)
    })
    const out = await enrichVmsWithConfig(
      CONN, [{ vmid: '300', node: 'n1', type: 'lxc', status: 'running' }], new Set(['n1']), { includeAgent: true },
    )
    expect(out[0].agentResponding).toBe(false)
    expect(out[0].agentOsName).toBeNull()
    // Load-bearing assertion: only the /config call happened. Dropping the
    // `kind !== "qemu"` gate makes this fail.
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(pveFetchMock).toHaveBeenCalledWith(CONN, '/nodes/n1/lxc/300/config')
  })
})
