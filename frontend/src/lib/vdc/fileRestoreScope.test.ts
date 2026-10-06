import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCurrentTenantIdMock, getTenantInfrastructureScopeMock, bindingFindFirstMock } = vi.hoisted(() => ({
  getCurrentTenantIdMock: vi.fn(),
  getTenantInfrastructureScopeMock: vi.fn(),
  bindingFindFirstMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: getCurrentTenantIdMock }))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: getTenantInfrastructureScopeMock }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { vdcPbsPveStorage: { findFirst: (...a: unknown[]) => bindingFindFirstMock(...a) } },
}))

import { authorizeFileRestore, FILE_RESTORE_DENIED_MESSAGE, pickFileRestoreNode } from './fileRestoreScope'

const CONN = 'conn-1'
const SNAP = 'backup/vm/101/2026-01-15T10:00:00Z'

function iaas(opts: { storages?: string[]; nodes?: string[]; connId?: string } = {}) {
  const connId = opts.connId ?? CONN
  return {
    kind: 'iaas' as const,
    vdcScope: {
      connectionIds: new Set([connId]),
      storagesByConnection: new Map([[connId, new Set(opts.storages ?? ['pbs-acme', 'local-lvm'])]]),
      nodesByConnection: new Map([[connId, new Set(opts.nodes ?? [])]]),
    },
  }
}

async function expectDenied(p: ReturnType<typeof authorizeFileRestore>) {
  const res = await p
  expect(res).toBeInstanceOf(Response)
  if (!(res instanceof Response)) return
  expect(res.status).toBe(403)
  expect(await res.json()).toEqual({ error: FILE_RESTORE_DENIED_MESSAGE })
}

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentTenantIdMock.mockResolvedValue('tenant-acme')
  bindingFindFirstMock.mockResolvedValue({ id: 'b1' })
})

describe('authorizeFileRestore', () => {
  it('resolves the tenant scope on the full vDC union', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaas())
    await authorizeFileRestore(CONN, 'pbs-acme', SNAP)
    expect(getTenantInfrastructureScopeMock).toHaveBeenCalledWith('tenant-acme', { ignoreVdcContext: true })
  })

  it('lets the provider through with the legacy volume normalisation', async () => {
    getCurrentTenantIdMock.mockResolvedValue('default')
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })

    expect(await authorizeFileRestore(CONN, 'local', 'backup/vzdump-qemu-100.vma.zst')).toEqual({
      volumeId: 'local:backup/vzdump-qemu-100.vma.zst', allowedNodes: null,
    })
    expect(await authorizeFileRestore(CONN, 'local', 'other:backup/x')).toEqual({
      volumeId: 'other:backup/x', allowedNodes: null,
    })
    // A bare PBS snapshot path has colons in its timestamp: still qualified.
    expect(await authorizeFileRestore(CONN, 'pbs-main', SNAP)).toEqual({
      volumeId: `pbs-main:${SNAP}`, allowedNodes: null,
    })
    expect(bindingFindFirstMock).not.toHaveBeenCalled()
  })

  it('lets an MSP tenant through on a connection it owns', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set([CONN]) })
    expect(await authorizeFileRestore(CONN, 'local', 'backup/vzdump-qemu-100.vma.zst')).toEqual({
      volumeId: 'local:backup/vzdump-qemu-100.vma.zst', allowedNodes: null,
    })
  })

  it('refuses an MSP tenant on a connection it does not own', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['other']) })
    await expectDenied(authorizeFileRestore(CONN, 'local', SNAP))
  })

  it('accepts a tenant PBS snapshot on its own bound storage', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaas())
    expect(await authorizeFileRestore(CONN, 'pbs-acme', SNAP)).toEqual({
      volumeId: `pbs-acme:${SNAP}`, allowedNodes: null,
    })
    expect(await authorizeFileRestore(CONN, 'pbs-acme', `pbs-acme:${SNAP}`)).toEqual({
      volumeId: `pbs-acme:${SNAP}`, allowedNodes: null,
    })
    expect(bindingFindFirstMock).toHaveBeenCalledWith({
      where: {
        pveConnectionId: CONN,
        pveStorageName: 'pbs-acme',
        vdcPbsNamespace: { vdc: { tenantId: 'tenant-acme', enabled: true, connectionId: CONN } },
      },
      select: { id: true },
    })
  })

  it('accepts a container snapshot', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaas())
    const res = await authorizeFileRestore(CONN, 'pbs-acme', 'backup/ct/200/2026-01-15T10:00:00Z')
    expect(res).not.toBeInstanceOf(Response)
  })

  it('refuses a storage outside the tenant vDC storages', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaas())
    await expectDenied(authorizeFileRestore(CONN, 'pbs-other', SNAP))
    expect(bindingFindFirstMock).not.toHaveBeenCalled()
  })

  it('refuses a connection where the tenant has no vDC', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaas({ connId: 'conn-2' }))
    await expectDenied(authorizeFileRestore(CONN, 'pbs-acme', SNAP))
  })

  it('refuses a volume whose storage prefix differs from the storage', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaas())
    await expectDenied(authorizeFileRestore(CONN, 'pbs-acme', `pbs-other:${SNAP}`))
    expect(bindingFindFirstMock).not.toHaveBeenCalled()
  })

  it('refuses vzdump archives, even on a tenant storage', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaas())
    await expectDenied(authorizeFileRestore(CONN, 'local-lvm', 'local-lvm:backup/vzdump-qemu-101-2026_01_15-10_00_00.vma.zst'))
    await expectDenied(authorizeFileRestore(CONN, 'pbs-acme', 'backup/vzdump-qemu-101.vma.zst'))
  })

  it('refuses malformed snapshot paths', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaas())
    for (const v of [
      'backup/vm/101/2026-01-15T10:00:00Z/extra',
      'backup/host/srv/2026-01-15T10:00:00Z',
      'backup/vm/abc/2026-01-15T10:00:00Z',
      'backup/vm/101/../../vm/102/2026-01-15T10:00:00Z',
    ]) {
      await expectDenied(authorizeFileRestore(CONN, 'pbs-acme', v))
    }
  })

  it('refuses a snapshot when the storage is not bound to one of the tenant PBS namespaces', async () => {
    // A guest's snapshot reached through a storage that is in the vDC but not
    // a PBS binding of this tenant (another tenant's namespace, or a plain
    // storage): ownership cannot be established.
    getTenantInfrastructureScopeMock.mockResolvedValue(iaas())
    bindingFindFirstMock.mockResolvedValue(null)
    await expectDenied(authorizeFileRestore(CONN, 'pbs-acme', 'backup/vm/999/2026-01-15T10:00:00Z'))
  })

  it('returns the vDC nodes when the vDC restricts nodes', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaas({ nodes: ['pve1', 'pve2'] }))
    const res = await authorizeFileRestore(CONN, 'pbs-acme', SNAP)
    expect(res instanceof Response ? null : [...(res.allowedNodes ?? [])]).toEqual(['pve1', 'pve2'])
  })
})

describe('pickFileRestoreNode', () => {
  const resources = [
    { type: 'node', node: 'pve1', status: 'online' },
    { type: 'node', node: 'pve2', status: 'online' },
    { type: 'node', node: 'pve3', status: 'offline' },
    { type: 'storage', node: 'pve3', storage: 'pbs-acme', status: 'available' },
    { type: 'storage', node: 'pve1', storage: 'pbs-acme', status: 'available' },
    { type: 'storage', node: 'pve2', storage: 'pbs-acme', status: 'available' },
  ]

  it('keeps the legacy choice without restriction', () => {
    expect(pickFileRestoreNode(resources, 'pbs-acme', null)).toBe('pve1')
    expect(pickFileRestoreNode(resources, 'missing', null)).toBe('pve1')
    expect(pickFileRestoreNode([], 'pbs-acme', null)).toBeNull()
  })

  it('only picks among allowed nodes', () => {
    expect(pickFileRestoreNode(resources, 'pbs-acme', new Set(['pve2']))).toBe('pve2')
    expect(pickFileRestoreNode(resources, 'pbs-acme', new Set(['pve3']))).toBe('pve3')
  })

  it('returns null when no allowed node qualifies', () => {
    expect(pickFileRestoreNode(resources, 'pbs-acme', new Set(['pve9']))).toBeNull()
  })
})
