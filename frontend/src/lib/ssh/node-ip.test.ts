import { describe, it, expect, vi, beforeEach } from 'vitest'

const findUniqueMock = vi.fn<(args: any) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const resolve4Mock = vi.fn<(name: string) => Promise<string[]>>()

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    managedHost: {
      findUnique: findUniqueMock,
    },
  },
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

vi.mock('dns', () => ({
  promises: {
    resolve4: resolve4Mock,
  },
}))

beforeEach(() => {
  findUniqueMock.mockReset()
  pveFetchMock.mockReset()
  resolve4Mock.mockReset()
})

describe('getNodeIp - priority order', () => {
  it('returns ManagedHost.sshAddress override when present (highest priority)', async () => {
    findUniqueMock.mockResolvedValueOnce({ sshAddress: '10.0.0.99', ip: '10.0.0.5' })

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp({ id: 'conn-1', baseUrl: 'https://10.0.0.1:8006' }, 'pve1')

    expect(ip).toBe('10.0.0.99')
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(resolve4Mock).not.toHaveBeenCalled()
  })

  it('returns ManagedHost.ip when sshAddress is null but ip is stored', async () => {
    findUniqueMock.mockResolvedValueOnce({ sshAddress: null, ip: '10.0.0.5' })

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp({ id: 'conn-1', baseUrl: 'https://10.0.0.1:8006' }, 'pve1')

    expect(ip).toBe('10.0.0.5')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('falls back to pveFetch + resolveManagementIp when ManagedHost has no IP', async () => {
    findUniqueMock.mockResolvedValueOnce({ sshAddress: null, ip: null })
    pveFetchMock.mockResolvedValueOnce([
      { iface: 'vmbr0', type: 'bridge', address: '10.0.0.5', gateway: '10.0.0.1', active: 1 },
    ])

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp({ id: 'conn-1', baseUrl: 'https://10.0.0.1:8006' }, 'pve1')

    expect(ip).toBe('10.0.0.5')
    expect(pveFetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'conn-1' }),
      '/nodes/pve1/network',
    )
    expect(resolve4Mock).not.toHaveBeenCalled()
  })

  it('URL-encodes the node name when calling pveFetch', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    pveFetchMock.mockResolvedValueOnce([
      { iface: 'vmbr0', address: '10.0.0.5', gateway: '10.0.0.1' },
    ])

    const { getNodeIp } = await import('./node-ip')
    await getNodeIp({ id: 'conn-1', baseUrl: 'https://10.0.0.1:8006' }, 'node with space')

    expect(pveFetchMock).toHaveBeenCalledWith(
      expect.anything(),
      '/nodes/node%20with%20space/network',
    )
  })

  it('falls back to DNS when pveFetch returns no management interface', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    pveFetchMock.mockResolvedValueOnce([])
    resolve4Mock.mockResolvedValueOnce(['10.0.0.42'])

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp({ id: 'conn-1', baseUrl: 'https://10.0.0.1:8006' }, 'pve1')

    expect(ip).toBe('10.0.0.42')
    expect(resolve4Mock).toHaveBeenCalledWith('pve1')
  })

  it('falls back to DNS when pveFetch throws', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    pveFetchMock.mockRejectedValueOnce(new Error('401 unauthorized'))
    resolve4Mock.mockResolvedValueOnce(['10.0.0.42'])

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp({ id: 'conn-1', baseUrl: 'https://10.0.0.1:8006' }, 'pve1')

    expect(ip).toBe('10.0.0.42')
  })

  it('falls back to the connection host when DNS fails (no behindProxy)', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    pveFetchMock.mockResolvedValueOnce([])
    resolve4Mock.mockRejectedValueOnce(new Error('ENOTFOUND'))

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp(
      { id: 'conn-1', baseUrl: 'https://10.0.0.1:8006', behindProxy: false },
      'pve1',
    )

    expect(ip).toBe('10.0.0.1')
  })

  it('strips the protocol and trailing port from baseUrl when used as fallback', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    pveFetchMock.mockResolvedValueOnce([])
    resolve4Mock.mockRejectedValueOnce(new Error('ENOTFOUND'))

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp(
      { id: 'conn-1', baseUrl: 'https://pve.example.com:8006', behindProxy: false },
      'pve1',
    )

    expect(ip).toBe('pve.example.com')
  })

  it('does NOT fall back to baseUrl when behindProxy is true (LB IP is useless for SSH)', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    pveFetchMock.mockResolvedValueOnce([])
    resolve4Mock.mockRejectedValueOnce(new Error('ENOTFOUND'))

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp(
      { id: 'conn-1', baseUrl: 'https://lb.example.com:8006', behindProxy: true },
      'pve1',
    )

    expect(ip).toBe('pve1')
  })

  it('returns the node name itself when every layer fails', async () => {
    findUniqueMock.mockResolvedValueOnce(null)
    pveFetchMock.mockRejectedValueOnce(new Error('boom'))
    resolve4Mock.mockRejectedValueOnce(new Error('ENOTFOUND'))

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp({ id: 'conn-1', baseUrl: '', behindProxy: false }, 'pve-mystery')

    expect(ip).toBe('pve-mystery')
  })
})

describe('getNodeIp - resilience', () => {
  it('does not crash when the Prisma lookup throws (treats it as a cache miss)', async () => {
    findUniqueMock.mockRejectedValueOnce(new Error('DB unavailable'))
    pveFetchMock.mockResolvedValueOnce([
      { iface: 'vmbr0', address: '10.0.0.5', gateway: '10.0.0.1' },
    ])

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp({ id: 'conn-1', baseUrl: 'https://10.0.0.1:8006' }, 'pve1')

    expect(ip).toBe('10.0.0.5')
  })

  it('accepts both conn.id and conn.connectionId as the connection identifier', async () => {
    findUniqueMock.mockResolvedValueOnce({ sshAddress: '172.16.0.1', ip: null })

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp({ connectionId: 'conn-alt', baseUrl: '' }, 'pve1')

    expect(ip).toBe('172.16.0.1')
    expect(findUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { connectionId_node: { connectionId: 'conn-alt', node: 'pve1' } },
      }),
    )
  })

  it('skips the Prisma lookup entirely when no connection id is present', async () => {
    pveFetchMock.mockResolvedValueOnce([
      { iface: 'vmbr0', address: '10.0.0.5', gateway: '10.0.0.1' },
    ])

    const { getNodeIp } = await import('./node-ip')
    const ip = await getNodeIp({ baseUrl: 'https://10.0.0.1:8006' }, 'pve1')

    expect(ip).toBe('10.0.0.5')
    expect(findUniqueMock).not.toHaveBeenCalled()
  })
})
