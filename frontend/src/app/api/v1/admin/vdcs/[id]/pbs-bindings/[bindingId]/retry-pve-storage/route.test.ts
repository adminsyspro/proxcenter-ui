/**
 * POST /api/v1/admin/vdcs/[id]/pbs-bindings/[bindingId]/retry-pve-storage
 * (#891): recreate the PVE storage of a PBS binding whose first creation
 * failed, so the tenant gets its backup target back.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  isUserSuperAdmin: vi.fn(),
  prisma: { vdcPbsNamespace: { findUnique: vi.fn() } } as any,
  listPveStoragesForBinding: vi.fn(),
  insertPveStorage: vi.fn(),
  createPbsStorage: vi.fn(),
  sanitizeStorageName: vi.fn(),
  getConnectionById: vi.fn(),
  resolvePbsMeta: vi.fn(),
  readVdcAndTenant: vi.fn(),
  readVdcNodeNames: vi.fn(),
  appendVdcStorage: vi.fn(),
  clearVdcScopeCache: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: (...a: unknown[]) => m.getServerSession(...a) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/rbac', () => ({ isUserSuperAdmin: (...a: unknown[]) => m.isUserSuperAdmin(...a) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/db/vdcPbsBindings', () => ({
  listPveStoragesForBinding: (...a: unknown[]) => m.listPveStoragesForBinding(...a),
  insertPveStorage: (...a: unknown[]) => m.insertPveStorage(...a),
}))
vi.mock('@/lib/proxmox/pvePbsStorage', () => ({
  createPbsStorage: (...a: unknown[]) => m.createPbsStorage(...a),
  sanitizeStorageName: (...a: unknown[]) => m.sanitizeStorageName(...a),
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: (...a: unknown[]) => m.getConnectionById(...a) }))
vi.mock('@/lib/proxmox/pbsConnMeta', () => ({ resolvePbsMeta: (...a: unknown[]) => m.resolvePbsMeta(...a) }))
vi.mock('@/lib/vdc/pbsOrchestrator', () => ({
  readVdcAndTenant: (...a: unknown[]) => m.readVdcAndTenant(...a),
  readVdcNodeNames: (...a: unknown[]) => m.readVdcNodeNames(...a),
  appendVdcStorage: (...a: unknown[]) => m.appendVdcStorage(...a),
}))
vi.mock('@/lib/vdc/scope', () => ({ clearVdcScopeCache: (...a: unknown[]) => m.clearVdcScopeCache(...a) }))

import { POST } from './route'

const BINDING = { id: 'b1', vdcId: 'v1', pbsConnectionId: 'pbs1', datastore: 'ds', namespace: 'tenant-acme/vdc-acme', pbsTokenId: 'tok@pbs!x', pbsTokenSecret: 's3cr3t' }
const call = () => callRoute(POST as any, { method: 'POST', params: { id: 'v1', bindingId: 'b1' } })

beforeEach(() => {
  vi.clearAllMocks()
  m.getServerSession.mockResolvedValue({ user: { id: 'admin-1' } })
  m.isUserSuperAdmin.mockResolvedValue(true)
  m.prisma.vdcPbsNamespace.findUnique.mockResolvedValue(BINDING)
  m.listPveStoragesForBinding.mockResolvedValue([])
  m.readVdcAndTenant.mockResolvedValue({ vdc: { id: 'v1', connectionId: 'c1', slug: 'acme-paris' }, tenant: { id: 't1', slug: 'acme' } })
  m.getConnectionById.mockResolvedValue({ id: 'c1' })
  m.sanitizeStorageName.mockReturnValue('pbs-acme-acmeparis')
  m.readVdcNodeNames.mockResolvedValue(['pve1', 'pve2'])
  m.resolvePbsMeta.mockResolvedValue({ host: '203.0.113.201', fingerprint: 'AA:BB' })
  m.createPbsStorage.mockResolvedValue(undefined)
  m.insertPveStorage.mockResolvedValue(undefined)
  m.appendVdcStorage.mockResolvedValue(undefined)
})

describe('POST .../retry-pve-storage', () => {
  it('is for super admins only', async () => {
    m.getServerSession.mockResolvedValueOnce(null)
    expect((await call()).status).toBe(403)
    m.isUserSuperAdmin.mockResolvedValueOnce(false)
    expect((await call()).status).toBe(403)
    expect(m.prisma.vdcPbsNamespace.findUnique).not.toHaveBeenCalled()
  })

  it('404s a missing binding or one of another vDC, 400s a binding without token', async () => {
    m.prisma.vdcPbsNamespace.findUnique.mockResolvedValueOnce(null)
    expect((await call()).status).toBe(404)
    m.prisma.vdcPbsNamespace.findUnique.mockResolvedValueOnce({ ...BINDING, vdcId: 'other' })
    expect((await call()).status).toBe(404)
    m.prisma.vdcPbsNamespace.findUnique.mockResolvedValueOnce({ ...BINDING, pbsTokenSecret: null })
    expect((await call()).status).toBe(400)
    expect(m.createPbsStorage).not.toHaveBeenCalled()
  })

  it('reports an existing storage without touching Proxmox', async () => {
    m.listPveStoragesForBinding.mockResolvedValueOnce([{ pveStorageName: 'pbs-acme-acmeparis' }])
    const res = await call()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { status: 'already_exists', storageName: 'pbs-acme-acmeparis' } })
    expect(m.createPbsStorage).not.toHaveBeenCalled()
  })

  it('creates the storage on the vDC nodes with the binding token, records it, exposes it to the vDC and clears the scope cache', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(m.createPbsStorage).toHaveBeenCalledWith({ id: 'c1' }, {
      storage: 'pbs-acme-acmeparis', server: '203.0.113.201', datastore: 'ds', namespace: 'tenant-acme/vdc-acme',
      username: 'tok@pbs!x', password: 's3cr3t', fingerprint: 'AA:BB', nodes: ['pve1', 'pve2'],
    })
    expect(m.insertPveStorage).toHaveBeenCalledWith({ bindingId: 'b1', pveConnectionId: 'c1', pveStorageName: 'pbs-acme-acmeparis', managed: true })
    expect(m.appendVdcStorage).toHaveBeenCalledWith('v1', 'pbs-acme-acmeparis')
    expect(m.clearVdcScopeCache).toHaveBeenCalledWith('t1')
    expect(await res.json()).toEqual({ data: { status: 'created', storageName: 'pbs-acme-acmeparis' } })
  })

  it('tolerates a record that already exists (lost race) but not another database error', async () => {
    m.insertPveStorage.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: 'P2002' }))
    expect((await call()).status).toBe(200)
    m.insertPveStorage.mockRejectedValueOnce(new Error('db down'))
    const res = await call()
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db down')
  })
})
