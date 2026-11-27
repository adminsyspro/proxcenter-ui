/**
 * Unit tests for parseVmIdentity and buildVmIdentityMap.
 *
 * parseVmIdentity is pure: no mocks needed.
 * buildVmIdentityMap: mock @/lib/db/prisma, @/lib/connections/getConnection,
 * and @/lib/proxmox/client (pveFetch).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  pveFetchMock,
  getConnectionByIdMock,
  findManyConnectionsMock,
} = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  findManyConnectionsMock: vi.fn(),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: (...a: any[]) => pveFetchMock(...a),
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: (...a: any[]) => getConnectionByIdMock(...a),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    connection: {
      findMany: (...a: any[]) => findManyConnectionsMock(...a),
    },
  },
}))

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------
import { parseVmIdentity, buildVmIdentityMap } from './vmIdentity'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONN_OPTS = {
  id: 'c1',
  name: 'Cluster 1',
  baseUrl: 'https://pve.example.com:8006',
  apiToken: 'token123',
  insecureDev: false,
  behindProxy: false,
}

const CONN_ROWS_C1 = [
  {
    id: 'c1',
    name: 'Cluster 1',
    type: 'pve',
    tenantId: 'default',
    latitude: null,
    longitude: null,
    locationLabel: null,
  },
]

const CONN_ROWS_ALL = [
  ...CONN_ROWS_C1,
  {
    id: 'c2',
    name: 'Cluster 2',
    type: 'pve',
    tenantId: 'default',
    latitude: null,
    longitude: null,
    locationLabel: null,
  },
]

// ---------------------------------------------------------------------------
// Common setup
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// parseVmIdentity tests (pure)
// ---------------------------------------------------------------------------
describe('parseVmIdentity', () => {
  it('joins config uuid + static IPs (qemu)', () => {
    const id = parseVmIdentity(
      { vmid: 107, name: 'kube-w1', node: 'pve', type: 'qemu', connectionId: 'c1', clusterName: 'PROD' },
      {
        smbios1: 'uuid=ABCDEF00-1234-5678-9ABC-DEF012345678',
        net0: 'virtio,bridge=vmbr0',
        ipconfig0: 'ip=10.0.0.11/24',
      },
    )
    expect(id).toMatchObject({
      vmid: 107,
      name: 'kube-w1',
      host: 'pve',
      connectionId: 'c1',
      clusterName: 'PROD',
      uuid: 'abcdef00-1234-5678-9abc-def012345678',
      ips: ['10.0.0.11'],
    })
  })

  it('returns null uuid when smbios1 absent', () => {
    const id = parseVmIdentity(
      { vmid: 200, name: 'vm-lxc', node: 'n1', type: 'lxc', connectionId: 'c1' },
      { net0: 'name=eth0,bridge=vmbr0,ip=192.168.1.5/24' },
    )
    expect(id.uuid).toBeNull()
    expect(id.ips).toEqual(['192.168.1.5'])
    expect(id.clusterName).toBeUndefined()
  })

  it('returns empty ips when all addresses are dhcp', () => {
    const id = parseVmIdentity(
      { vmid: 300, name: 'vm-dhcp', node: 'n2', type: 'qemu', connectionId: 'c1' },
      { net0: 'virtio,bridge=vmbr0', ipconfig0: 'ip=dhcp' },
    )
    expect(id.ips).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// buildVmIdentityMap tests
// ---------------------------------------------------------------------------
describe('buildVmIdentityMap', () => {
  it('skips out-of-filter connections, resolves connection once with tenantId, and isolates per-VM failure', async () => {
    // Only c1 is in the connectionFilter; c2 must be skipped.
    findManyConnectionsMock.mockResolvedValue(CONN_ROWS_C1)
    getConnectionByIdMock.mockResolvedValue(CONN_OPTS)

    // /cluster/resources?type=vm -> two qemu VMs
    pveFetchMock.mockImplementation(async (_opts: any, path: string) => {
      if (path === '/nodes') return [{ node: 'pve', status: 'online' }]
      if (path === '/cluster/resources?type=vm') {
        return [
          { vmid: 100, name: 'vm100', node: 'pve', type: 'qemu' },
          { vmid: 101, name: 'vm101', node: 'pve', type: 'qemu' },
        ]
      }
      // Config for vm100 succeeds, vm101 rejects
      if (path.includes('/101/config')) throw new Error('timeout')
      // vm100 config
      return { net0: 'virtio,bridge=vmbr0', ipconfig0: 'ip=10.0.0.100/24' }
    })

    const r = await buildVmIdentityMap({ connectionFilter: new Set(['c1']) })

    expect(r.ok).toBe(true)
    expect(r.configFetchFailed).toBe(1)
    expect(r.vms.length).toBe(1)
    expect(r.vms[0].vmid).toBe(100)
    expect(r.vms.every(v => v.connectionId === 'c1')).toBe(true)
    // c2 was never touched
    expect(findManyConnectionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: { in: ['c1'] } }) })
    )
    // Connection resolved ONCE (with tenantId) for enumeration; opts reused for both VM fetches.
    // getConnectionById called once total: with (conn.id, conn.tenantId).
    expect(getConnectionByIdMock).toHaveBeenCalledTimes(1)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('c1', 'default')
  })

  it('null connectionFilter enumerates all connections, resolves each connection once', async () => {
    findManyConnectionsMock.mockResolvedValue(CONN_ROWS_ALL)
    getConnectionByIdMock.mockResolvedValue(CONN_OPTS)

    pveFetchMock.mockImplementation(async (_opts: any, path: string) => {
      if (path === '/nodes') return [{ node: 'pve', status: 'online' }]
      if (path === '/cluster/resources?type=vm') {
        return [{ vmid: 1, name: 'vm1', node: 'pve', type: 'qemu' }]
      }
      return {}
    })

    const r = await buildVmIdentityMap({ connectionFilter: null })

    expect(r.ok).toBe(true)
    expect(r.vms.length).toBe(2) // one VM from each of 2 connections
    expect(findManyConnectionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { type: 'pve' } })
    )
    // Two connections -> getConnectionById called twice total (once per connection, with tenantId).
    expect(getConnectionByIdMock).toHaveBeenCalledTimes(2)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('c1', 'default')
    expect(getConnectionByIdMock).toHaveBeenCalledWith('c2', 'default')
  })

  it('caps at VM_SCAN_CAP and sets capped:true', async () => {
    // Dynamically import to read the exported cap constant for the assertion
    const { VM_SCAN_CAP } = await import('./vmIdentity')

    // Generate VM_SCAN_CAP + 1 VMs on a single connection
    const vms = Array.from({ length: VM_SCAN_CAP + 1 }, (_, i) => ({
      vmid: i + 1,
      name: `vm${i + 1}`,
      node: 'pve',
      type: 'qemu',
    }))

    findManyConnectionsMock.mockResolvedValue(CONN_ROWS_C1)
    getConnectionByIdMock.mockResolvedValue(CONN_OPTS)

    pveFetchMock.mockImplementation(async (_opts: any, path: string) => {
      if (path === '/nodes') return [{ node: 'pve', status: 'online' }]
      if (path === '/cluster/resources?type=vm') return vms
      return {}
    })

    const r = await buildVmIdentityMap({ connectionFilter: new Set(['c1']) })

    expect(r.capped).toBe(true)
    expect(r.vms.length).toBe(VM_SCAN_CAP)
  })

  it('returns ok:true even when ALL per-VM fetches fail (graceful degradation)', async () => {
    findManyConnectionsMock.mockResolvedValue(CONN_ROWS_C1)
    getConnectionByIdMock.mockResolvedValue(CONN_OPTS)

    pveFetchMock.mockImplementation(async (_opts: any, path: string) => {
      if (path === '/nodes') return [{ node: 'pve', status: 'online' }]
      if (path === '/cluster/resources?type=vm') {
        return [{ vmid: 10, name: 'vmX', node: 'pve', type: 'qemu' }]
      }
      throw new Error('network error')
    })

    const r = await buildVmIdentityMap({ connectionFilter: new Set(['c1']) })

    expect(r.ok).toBe(true)
    expect(r.vms).toHaveLength(0)
    expect(r.configFetchFailed).toBe(1)
  })
})
