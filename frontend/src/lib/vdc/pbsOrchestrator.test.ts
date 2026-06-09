import { beforeEach, describe, expect, it, vi } from 'vitest'

// All external collaborators are mocked — this suite is a unit test for
// the orchestration order (namespace → token → ACL → PVE storages → DB
// row), not an end-to-end PBS / PVE integration. The DB-touching parts
// have their own real-Postgres tests in lib/db/vdcPbsBindings.test.ts.

vi.mock('@/lib/db/vdcPbsBindings', () => ({
  insertBinding: vi.fn(),
  insertPveStorage: vi.fn(),
  listPveStoragesForBinding: vi.fn(async () => []),
  deleteBinding: vi.fn(),
  deletePveStorage: vi.fn(),
  findBindingByTuple: vi.fn(async () => null),
}))
vi.mock('@/lib/proxmox/pbsNamespace', () => ({
  ensureNamespacePath: vi.fn(),
  ensureSubToken: vi.fn(async () => ({ tokenId: 'root@pam!vdc-abc', secret: 'S3CR3T' })),
  setNamespaceAcl: vi.fn(),
  setDatastoreAuditAcl: vi.fn(),
  deleteSubToken: vi.fn(),
  waitForPbsTokenReady: vi.fn(async () => undefined),
}))
vi.mock('@/lib/proxmox/pvePbsStorage', () => ({
  createPbsStorage: vi.fn(),
  deletePbsStorage: vi.fn(),
  sanitizeStorageName: vi.fn((a: string, b: string) => `pbs-${a}-${b}`),
}))
vi.mock('@/lib/connections/getConnection', () => ({
  getPbsConnectionById: vi.fn(async () => ({
    id: 'pbs1', name: 'pbs', baseUrl: 'https://pbs',
    apiToken: 'root@pam!x:y', insecureDev: true,
  })),
  getConnectionById: vi.fn(async (id: string) => ({
    id, name: id, baseUrl: 'https://pve', apiToken: 't',
    insecureDev: true, behindProxy: false,
  })),
}))

// Replaces the legacy `@/lib/db/sqlite` mock with the Prisma surface that
// pbsOrchestrator now talks to: connection / vdc / tenant / vdcNode /
// vdcStorage / vdcPbsNamespace.
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    connection: {
      findUnique: vi.fn(async () => ({
        id: 'pbs1',
        tenantId: 'default',
        type: 'pbs',
        baseUrl: 'https://pbs.example:8007',
        fingerprint: 'AA:BB:CC',
        apiTokenEnc: 'enc',
        insecureTLS: true,
      })),
      update: vi.fn(),
    },
    vdc: {
      findUnique: vi.fn(async () => ({
        id: 'v1', tenantId: 't1', slug: 'prod', connectionId: 'pve1',
        pvePoolName: 'pool-v1',
      })),
    },
    tenant: {
      findUnique: vi.fn(async () => ({ id: 't1', slug: 'acme' })),
    },
    vdcNode: {
      findMany: vi.fn(async () => [{ nodeName: 'pve01' }, { nodeName: 'pve02' }]),
    },
    vdcStorage: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    vdcPbsNamespace: {
      findUnique: vi.fn(async () => null),
    },
  },
}))

vi.mock('@/lib/crypto/secret', () => ({
  decryptSecret: () => 'root@pam!admin:secret',
  encryptSecret: (s: string) => `enc:${s}`,
}))

vi.mock('./scope', () => ({ clearVdcScopeCache: vi.fn() }))

import * as bindings from '@/lib/db/vdcPbsBindings'
import * as prismaMod from '@/lib/db/prisma'
import * as pbsNs from '@/lib/proxmox/pbsNamespace'
import * as pveStorage from '@/lib/proxmox/pvePbsStorage'

import { bindPbsToVdc, bindPbsToVdcManual, unbindFromVdc } from './pbsOrchestrator'

describe('bindPbsToVdc', () => {
  beforeEach(() => vi.clearAllMocks())

  it('orchestrates namespace + token + acl + pve storages and writes DB', async () => {
    ;(bindings.insertBinding as any).mockResolvedValue({
      id: 'b1', vdcId: 'v1', pbsConnectionId: 'pbs1',
      datastore: 'store1', namespace: 'tenant-acme/vdc-prod',
      pbsTokenId: 'root@pam!vdc-abc', pbsTokenSecret: 'S3CR3T',
      createdAt: 't',
    })

    const result = await bindPbsToVdc({
      vdcId: 'v1',
      pbsConnectionId: 'pbs1',
      datastore: 'store1',
    })

    expect(pbsNs.ensureNamespacePath).toHaveBeenCalledWith(expect.anything(), 'store1', 'tenant-acme/vdc-prod')
    expect(pbsNs.ensureSubToken).toHaveBeenCalled()
    expect(pbsNs.setNamespaceAcl).toHaveBeenCalled()
    expect(pveStorage.createPbsStorage).toHaveBeenCalledTimes(1)
    expect(bindings.insertBinding).toHaveBeenCalled()
    expect(bindings.insertPveStorage).toHaveBeenCalled()
    expect(result.binding.id).toBe('b1')
    expect(result.steps.namespace).toBe('ok')
    expect(result.steps.token).toBe('ok')
    expect(result.steps.acl).toBe('ok')
    expect(result.steps.pveStorages).toHaveLength(1)
  })

  it('rejects when fingerprint is missing on the PBS connection', async () => {
    // First call: ownership check (needs tenantId = 'default' to pass)
    ;(prismaMod.prisma.connection.findUnique as any).mockResolvedValueOnce({
      id: 'pbs1', tenantId: 'default',
    })
    // Second call: resolvePbsMeta reads the full row (fingerprint missing triggers the error)
    ;(prismaMod.prisma.connection.findUnique as any).mockResolvedValueOnce({
      id: 'pbs1', type: 'pbs', baseUrl: 'https://pbs',
      fingerprint: null, apiTokenEnc: 'e', insecureTLS: true,
    })
    await expect(bindPbsToVdc({ vdcId: 'v1', pbsConnectionId: 'pbs1', datastore: 'store1' }))
      .rejects.toThrow(/fingerprint/i)
  })
})

describe('bindPbsToVdcManual', () => {
  beforeEach(() => vi.clearAllMocks())

  it('writes a manual-mode row without touching PBS or PVE', async () => {
    ;(bindings.insertBinding as any).mockResolvedValue({
      id: 'b1', vdcId: 'v1', pbsConnectionId: 'pbs1',
      datastore: 'store1', namespace: 'tenant-acme/vdc-prod',
      mode: 'manual', pbsTokenId: null, pbsTokenSecret: null, createdAt: 't',
    })

    const result = await bindPbsToVdcManual({
      vdcId: 'v1',
      pbsConnectionId: 'pbs1',
      datastore: 'store1',
      namespace: 'tenant-acme/vdc-prod',
    })

    expect(pbsNs.ensureNamespacePath).not.toHaveBeenCalled()
    expect(pbsNs.ensureSubToken).not.toHaveBeenCalled()
    expect(pveStorage.createPbsStorage).not.toHaveBeenCalled()
    expect(bindings.insertBinding).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'manual', pbsTokenId: null }),
    )
    expect(result.steps).toEqual({ mode: 'manual', pveStorage: 'skipped' })
  })

  it('records a pre-existing PVE storage with managed=false when provided', async () => {
    ;(bindings.insertBinding as any).mockResolvedValue({
      id: 'b2', vdcId: 'v1', pbsConnectionId: 'pbs1',
      datastore: 'd', namespace: 'n', mode: 'manual',
      pbsTokenId: null, pbsTokenSecret: null, createdAt: 't',
    })
    await bindPbsToVdcManual({
      vdcId: 'v1',
      pbsConnectionId: 'pbs1',
      datastore: 'store1',
      namespace: 'tenant-acme/vdc-prod',
      pveStorageName: 'pbs-preexisting',
    })
    expect(bindings.insertPveStorage).toHaveBeenCalledWith(
      expect.objectContaining({ pveStorageName: 'pbs-preexisting', managed: false }),
    )
  })

  it('requires a namespace', async () => {
    await expect(
      bindPbsToVdcManual({ vdcId: 'v1', pbsConnectionId: 'pbs1', datastore: 'store1', namespace: '' }),
    ).rejects.toThrow(/namespace/i)
  })
})

describe('unbindFromVdc', () => {
  beforeEach(() => vi.clearAllMocks())

  it('deletes PVE storages, revokes sub-token, removes DB row', async () => {
    ;(prismaMod.prisma.vdcPbsNamespace.findUnique as any).mockResolvedValueOnce({
      id: 'b1', vdcId: 'v1', pbsConnectionId: 'pbs1', datastore: 'store1',
      namespace: 'tenant-acme/vdc-prod', pbsTokenId: 'root@pam!vdc-abc',
      pbsTokenSecret: 'S3CR3T', mode: 'auto',
    })
    ;(bindings.listPveStoragesForBinding as any).mockResolvedValue([
      { id: 's1', bindingId: 'b1', pveConnectionId: 'pve1', pveStorageName: 'pbs-acme-prod', managed: true, createdAt: 't' },
    ])

    await unbindFromVdc('b1')

    expect(pveStorage.deletePbsStorage).toHaveBeenCalledWith(expect.anything(), 'pbs-acme-prod')
    expect(pbsNs.deleteSubToken).toHaveBeenCalled()
    expect(bindings.deleteBinding).toHaveBeenCalledWith('b1')
  })
})
