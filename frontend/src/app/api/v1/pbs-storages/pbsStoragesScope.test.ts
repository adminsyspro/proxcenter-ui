// roadmap#184: backup.view held on one cluster maps the PBS storages of that cluster only.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ scope: null as any, pveFetch: vi.fn() }))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    connection: {
      findMany: async () => [
        { id: 'prod', name: 'PVE-PROD', type: 'pve', baseUrl: 'https://prod:8006', apiTokenEnc: 'x' },
        { id: 'dr', name: 'PVE-DR', type: 'pve', baseUrl: 'https://dr:8006', apiTokenEnc: 'x' },
        { id: 'pbs', name: 'PBS', type: 'pbs', baseUrl: 'https://10.0.0.9:8007', apiTokenEnc: 'x' },
      ],
    },
  }),
}))
vi.mock('@/lib/rbac', async () => {
  const { filterVisibleConnections } = await import('@/lib/rbac/infraScope')
  return {
    checkPermission: async () => null,
    getCurrentRbacInfraScope: async () => h.scope,
    filterVisibleConnections,
    PERMISSIONS: { BACKUP_VIEW: 'backup.view' },
  }
})
vi.mock('@/lib/crypto/secret', () => ({ decryptSecret: () => 'token' }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: h.pveFetch }))

import { GET } from './route'

beforeEach(() => {
  h.scope = null
  h.pveFetch.mockReset().mockImplementation(async (_conn: unknown, path: string) =>
    path === '/storage' ? [{ storage: 'pbs1', type: 'pbs', server: '10.0.0.9:8007', datastore: 'ds' }] : [])
})

const rows = async () => (await (await GET()).json()).data as any[]

describe('GET /api/v1/pbs-storages scope', () => {
  it('maps every cluster, and names the matching PBS, for an unrestricted caller', async () => {
    const data = await rows()

    expect(data.map(r => r.pveId).sort()).toEqual(['dr', 'prod'])
    expect(data[0].pbsName).toBe('PBS')
  })

  it('maps the granted cluster only, and does not name a PBS the grants leave out', async () => {
    h.scope = { fullConnections: new Set(['dr']), nodesByConnection: new Map(), guestDerived: false }
    const data = await rows()

    expect(data.map(r => r.pveId)).toEqual(['dr'])
    expect(data[0].pbsName).toBeNull()
  })
})
