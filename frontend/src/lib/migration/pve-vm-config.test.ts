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
