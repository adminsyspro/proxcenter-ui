import { describe, it, expect, vi, beforeEach } from 'vitest'

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

const pveConn = {
  baseUrl: 'https://pve.test:8006',
  apiToken: 'tok',
  insecureDev: false,
  id: 'conn-1',
}

beforeEach(() => {
  pveFetchMock.mockReset().mockResolvedValue(undefined)
})

describe('pveSetVmConfig', () => {
  it('PUTs to /nodes/{node}/qemu/{vmid}/config with the provided body', async () => {
    const { pveSetVmConfig } = await import('./pve-vm-config')
    const body = new URLSearchParams({ scsi0: 'local-zfs:vm-101-disk-0' })

    await pveSetVmConfig(pveConn, 'pve-node-1', 101, body)

    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    const [conn, path, init] = pveFetchMock.mock.calls[0]
    expect(conn).toBe(pveConn)
    expect(path).toBe('/nodes/pve-node-1/qemu/101/config')
    expect(init.method).toBe('PUT')
    expect(init.body).toBe(body)
  })

  // Slow-storage timeout is the whole point of this helper (issue #332):
  // qm set on ZFS-over-iSCSI takes ~10s, well above pveFetch's 8s default.
  // Guard against a future "simplification" that drops the long timeout.
  it('passes a timeout much larger than the pveFetch default (issue #332)', async () => {
    const { pveSetVmConfig } = await import('./pve-vm-config')

    await pveSetVmConfig(pveConn, 'n', 1, new URLSearchParams())

    const [, , , fetchOpts] = pveFetchMock.mock.calls[0]
    expect(fetchOpts).toBeDefined()
    expect(fetchOpts.timeoutMs).toBeGreaterThanOrEqual(60_000)
  })

  it('URL-encodes the node name so unusual characters cannot break the path', async () => {
    const { pveSetVmConfig } = await import('./pve-vm-config')

    await pveSetVmConfig(pveConn, 'node with space', 1, new URLSearchParams())

    const [, path] = pveFetchMock.mock.calls[0]
    expect(path).toBe('/nodes/node%20with%20space/qemu/1/config')
  })

  it('propagates pveFetch errors (timeout, 4xx, 5xx) to the caller', async () => {
    pveFetchMock.mockReset().mockRejectedValueOnce(new Error('PVE 500 /config: boom'))
    const { pveSetVmConfig } = await import('./pve-vm-config')

    await expect(
      pveSetVmConfig(pveConn, 'n', 1, new URLSearchParams()),
    ).rejects.toThrow('PVE 500')
  })
})

describe('destroyPveVm', () => {
  // The whole point of this helper (issue #400): purge + destroy-unreferenced-disks
  // MUST be in the query string and the request MUST NOT carry a body. PVE rejects a
  // body on DELETE with 501 "Unexpected content for method 'DELETE'", which silently
  // leaked the VMID + its disk on failed-migration cleanup.
  it('DELETEs with purge flags in the query string and NO request body (issue #400)', async () => {
    const { destroyPveVm } = await import('./pve-vm-config')

    await destroyPveVm(pveConn, 'pve-node-1', 112)

    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    const [conn, path, init] = pveFetchMock.mock.calls[0]
    expect(conn).toBe(pveConn)
    expect(path).toBe('/nodes/pve-node-1/qemu/112?purge=1&destroy-unreferenced-disks=1')
    expect(init.method).toBe('DELETE')
    expect(init.body).toBeUndefined()
  })

  it('accepts a string vmid and URL-encodes the node name', async () => {
    const { destroyPveVm } = await import('./pve-vm-config')

    await destroyPveVm(pveConn, 'node with space', '101')

    const [, path] = pveFetchMock.mock.calls[0]
    expect(path).toBe('/nodes/node%20with%20space/qemu/101?purge=1&destroy-unreferenced-disks=1')
  })

  it('propagates pveFetch errors to the caller (cleanup is best-effort at call sites)', async () => {
    pveFetchMock.mockReset().mockRejectedValueOnce(new Error('PVE 500 /qemu/112: boom'))
    const { destroyPveVm } = await import('./pve-vm-config')

    await expect(destroyPveVm(pveConn, 'n', 112)).rejects.toThrow('PVE 500')
  })
})
