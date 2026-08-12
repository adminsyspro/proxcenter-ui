import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const pbsFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getVdcScopeMock = vi.fn<(tenantId?: string) => Promise<any>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const findManyMock = vi.fn<(args: any) => Promise<any[]>>()
const listVzdumpMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ connection: { findMany: findManyMock } }),
  getCurrentTenantId: async () => 'default',
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findMany: findManyMock } } }))
vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: getVdcScopeMock }))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: pbsFetchMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/crypto/secret', () => ({ decryptSecret: (s: string) => `dec:${s}` }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { BACKUP_VIEW: 'backup.view' },
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'en' }) }) }))
vi.mock('@/lib/backups/pveVzdump', () => ({ listGuestVzdumpBackups: listVzdumpMock }))

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  pbsFetchMock.mockReset().mockResolvedValue([])
  pveFetchMock.mockReset().mockResolvedValue([])
  getVdcScopeMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'pve-1', apiToken: 't' })
  findManyMock.mockReset().mockResolvedValue([])
  listVzdumpMock.mockReset().mockResolvedValue({ data: [], warnings: [] })
})

async function call(connectionId?: string, extra?: Record<string, string>) {
  const { GET } = await import('./route')
  const searchParams = { ...(connectionId ? { connectionId } : {}), ...(extra || {}) }
  const res = await callRoute(GET as any, {
    params: { vmid: '1105' },
    searchParams: Object.keys(searchParams).length > 0 ? searchParams : undefined,
  })
  return readJson<any>(res)
}

/** Le balayage vzdump est opt-in : l'UI ne le demande qu'à l'ouverture de
 *  l'onglet Sauvegardes. */
const callScan = (connectionId?: string) => call(connectionId, { scanVzdump: '1' })

describe('GET /api/v1/guests/[vmid]/backups — pbsConfigured (PBS connection mapped to the cluster)', () => {
  it('is false when no PBS connection exists at all', async () => {
    findManyMock.mockResolvedValue([])
    const body = await call('pve-1')
    expect(body.data.pbsConfigured).toBe(false)
  })

  it('is false when the cluster backs up to a PBS that is not a ProxCenter connection', async () => {
    // Real case: the cluster's pbs storage points to 10.199.199.231, but the
    // only PBS connection is 10.99.99.204 — they do not match.
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.99.99.204:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockResolvedValue([
      { storage: 'PBS_MASTER_RBX', type: 'pbs', server: '10.199.199.231', datastore: 'VM-BACKUP' },
      { storage: 'local', type: 'dir' },
    ])
    const body = await call('pve-1')
    expect(body.data.pbsConfigured).toBe(false)
  })

  it('is true when a ProxCenter PBS connection matches the cluster pbs storage host', async () => {
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.199.199.231:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockResolvedValue([
      { storage: 'PBS_MASTER_RBX', type: 'pbs', server: '10.199.199.231', datastore: 'VM-BACKUP' },
    ])
    const body = await call('pve-1')
    expect(body.data.pbsConfigured).toBe(true)
  })

  it('falls back to "a PBS connection exists" when no connectionId is provided', async () => {
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.99.99.204:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    const body = await call()
    expect(body.data.pbsConfigured).toBe(true)
  })

  it('falls back to "a PBS connection exists" when the cluster storage cannot be read', async () => {
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.99.99.204:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockRejectedValue(new Error('storage unreachable'))
    const body = await call('pve-1')
    expect(body.data.pbsConfigured).toBe(true)
  })
})

const VZDUMP_ENTRY = {
  id: 'node2/local:backup/vzdump-qemu-1105-2026_08_11-15_51_33.vma.zst',
  source: 'vzdump',
  volid: 'local:backup/vzdump-qemu-1105-2026_08_11-15_51_33.vma.zst',
  node: 'node2',
  storage: 'local',
  backupType: 'vm',
  backupTime: 1786000293,
  backupTimeKnown: true,
  size: 100,
  sizeFormatted: '100 B',
  verified: false,
  verification: null,
  protected: false,
}

describe('GET /api/v1/guests/[vmid]/backups — vzdump archives on PVE storages', () => {
  it('returns vzdump archives even when no PBS connection exists at all', async () => {
    // The exact reported case: a cluster with zero PBS, backing up to local.
    findManyMock.mockResolvedValue([])
    pveFetchMock.mockResolvedValue([{ storage: 'local', type: 'dir', content: 'backup' }])
    listVzdumpMock.mockResolvedValue({ data: [VZDUMP_ENTRY], warnings: [] })

    const body = await callScan('pve-1')

    expect(body.data.backups).toHaveLength(1)
    expect(body.data.backups[0].source).toBe('vzdump')
    expect(body.data.stats.total).toBe(1)
    expect(body.data.pbsConfigured).toBe(false)
    expect(body.data.vzdumpScanned).toBe(true)
  })

  it('merges both sources and sorts them by date, most recent first', async () => {
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.0.0.1:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockResolvedValue([
      { storage: 'PBS_DS', type: 'pbs', server: '10.0.0.1' },
      { storage: 'local', type: 'dir', content: 'backup' },
    ])
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') return [{ store: 'store1' }]
      if (path.includes('/snapshots')) {
        return [{ 'backup-id': '1105', 'backup-type': 'vm', 'backup-time': 1786100000, size: 10 }]
      }
      return []
    })
    listVzdumpMock.mockResolvedValue({ data: [VZDUMP_ENTRY], warnings: [] })

    const body = await callScan('pve-1')

    expect(body.data.backups.map((b: any) => b.source)).toEqual(['pbs', 'vzdump'])
    expect(body.data.stats.total).toBe(2)
  })

  it('counts only PBS snapshots as verified', async () => {
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.0.0.1:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockResolvedValue([{ storage: 'local', type: 'dir', content: 'backup' }])
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') return [{ store: 'store1' }]
      if (path.includes('/snapshots')) {
        return [{
          'backup-id': '1105', 'backup-type': 'vm', 'backup-time': 1786100000,
          size: 10, verification: { state: 'ok' },
        }]
      }
      return []
    })
    listVzdumpMock.mockResolvedValue({ data: [VZDUMP_ENTRY], warnings: [] })

    const body = await callScan('pve-1')

    expect(body.data.stats.total).toBe(2)
    expect(body.data.stats.verifiedCount).toBe(1)
    expect(body.data.stats.pbsTotal).toBe(1)
  })

  it('does not scan PVE storages when no connectionId is provided', async () => {
    findManyMock.mockResolvedValue([])
    const body = await callScan()

    expect(listVzdumpMock).not.toHaveBeenCalled()
    expect(body.data.vzdumpScanned).toBe(false)
    expect(body.data.backups).toEqual([])
  })

  it('still returns vzdump archives when the PBS fan-out fails', async () => {
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.0.0.1:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockResolvedValue([{ storage: 'local', type: 'dir', content: 'backup' }])
    pbsFetchMock.mockRejectedValue(new Error('pbs unreachable'))
    listVzdumpMock.mockResolvedValue({ data: [VZDUMP_ENTRY], warnings: [] })

    const body = await callScan('pve-1')

    expect(body.data.backups).toHaveLength(1)
    expect(body.data.warnings.join(' ')).toContain('pbs unreachable')
  })

  it('still returns PBS snapshots when the PVE storage config cannot be read', async () => {
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.0.0.1:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockRejectedValue(new Error('storage unreachable'))
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') return [{ store: 'store1' }]
      if (path.includes('/snapshots')) {
        return [{ 'backup-id': '1105', 'backup-type': 'vm', 'backup-time': 1786100000, size: 10 }]
      }
      return []
    })

    const body = await callScan('pve-1')

    expect(body.data.backups).toHaveLength(1)
    expect(body.data.backups[0].source).toBe('pbs')
    expect(body.data.pbsConfigured).toBe(true)
    expect(body.data.vzdumpScanned).toBe(false)
    expect(listVzdumpMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/guests/[vmid]/backups — vzdump scan is opt-in', () => {
  it('does not scan PVE storages without scanVzdump, but still returns PBS snapshots', async () => {
    // Le préchargement déclenché à chaque clic dans l'arbre passe par ce
    // chemin : il ne doit coûter aucun appel de contenu à pveproxy.
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.0.0.1:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockResolvedValue([{ storage: 'local', type: 'dir', content: 'backup' }])
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') return [{ store: 'store1' }]
      if (path.includes('/snapshots')) {
        return [{ 'backup-id': '1105', 'backup-type': 'vm', 'backup-time': 1786100000, size: 10 }]
      }
      return []
    })
    listVzdumpMock.mockResolvedValue({ data: [VZDUMP_ENTRY], warnings: [] })

    const body = await call('pve-1')

    expect(listVzdumpMock).not.toHaveBeenCalled()
    expect(body.data.vzdumpScanned).toBe(false)
    expect(body.data.backups).toHaveLength(1)
    expect(body.data.backups[0].source).toBe('pbs')
  })

  it('treats scanVzdump=0 as no scan', async () => {
    findManyMock.mockResolvedValue([])
    pveFetchMock.mockResolvedValue([{ storage: 'local', type: 'dir', content: 'backup' }])

    const body = await call('pve-1', { scanVzdump: '0' })

    expect(listVzdumpMock).not.toHaveBeenCalled()
    expect(body.data.vzdumpScanned).toBe(false)
  })

  it('forwards the guest current node to the vzdump collector', async () => {
    // Sans ce paramètre, la priorisation du nœud du guest est du code mort et
    // la troncature au plafond dur peut écarter le nœud qui porte l'archive.
    findManyMock.mockResolvedValue([])
    pveFetchMock.mockResolvedValue([{ storage: 'local', type: 'dir', content: 'backup' }])
    listVzdumpMock.mockResolvedValue({ data: [], warnings: [] })

    await call('pve-1', { scanVzdump: '1', node: 'node2' })

    expect(listVzdumpMock).toHaveBeenCalledTimes(1)
    expect(listVzdumpMock.mock.calls[0][2]).toMatchObject({ currentNode: 'node2' })
  })
})

describe('GET /api/v1/guests/[vmid]/backups — both collections run concurrently', () => {
  it('starts the PBS fan-out without waiting for the vzdump scan', async () => {
    // Le scan vzdump ne se débloque que lorsque le fan-out PBS a commencé :
    // si la route sérialisait les deux, ce test resterait bloqué jusqu'au
    // timeout au lieu de passer.
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.0.0.1:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockResolvedValue([{ storage: 'local', type: 'dir', content: 'backup' }])

    let releaseVzdump: () => void = () => {}
    const pbsStarted = new Promise<void>(resolve => { releaseVzdump = resolve })

    listVzdumpMock.mockImplementation(async () => {
      await pbsStarted

      return { data: [VZDUMP_ENTRY], warnings: [] }
    })
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      releaseVzdump()
      if (path === '/admin/datastore') return [{ store: 'store1' }]
      if (path.includes('/snapshots')) {
        return [{ 'backup-id': '1105', 'backup-type': 'vm', 'backup-time': 1786100000, size: 10 }]
      }

      return []
    })

    const body = await callScan('pve-1')

    expect(body.data.backups.map((b: any) => b.source)).toEqual(['pbs', 'vzdump'])
  })
})
