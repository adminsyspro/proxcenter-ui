import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/proxmox/pbsConnMeta', () => ({ PBS_DEFAULT_PORT: 8007, resolvePbsMeta: vi.fn() }))
vi.mock('@/lib/proxmox/pbsNamespace', () => ({
  ensureNamespacePath: vi.fn(),
  ensureSubToken: vi.fn(),
  setNamespaceAcl: vi.fn(),
  setDatastoreAcl: vi.fn(),
  setDatastoreAuditAcl: vi.fn(),
  waitForPbsTokenReady: vi.fn(),
  deleteSubToken: vi.fn(),
}))
vi.mock('@/lib/proxmox/pvePbsStorage', () => ({
  createPbsStorage: vi.fn(), pbsStorageExists: vi.fn(), deletePbsStorage: vi.fn(),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))

import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { resolvePbsMeta } from '@/lib/proxmox/pbsConnMeta'
import * as pbsNs from '@/lib/proxmox/pbsNamespace'
import { createPbsStorage, deletePbsStorage, pbsStorageExists } from '@/lib/proxmox/pvePbsStorage'

import {
  attachPbsStorage, buildScopedTokenId, detachPbsStorage, isProxCenterToken,
  normalizeNamespace, normalizeStorageName, PbsAttachError, PXC_TOKEN_PREFIX,
  type AttachPbsStorageArgs,
} from './attachPbsStorage'

const fingerprint = Array(32).fill('AA').join(':')
const pveConn: PveConn = {
  id: 'pve1', name: 'prod', baseUrl: 'https://pve.lab:8006',
  apiToken: 'root@pam!admin:secret', insecureDev: true, behindProxy: false,
}
const sibling: PveConn = { ...pveConn, id: 'pve2', name: 'other-cluster' }
const meta = {
  conn: { baseUrl: 'https://pbs.lab:8007', apiToken: 'root@pam!admin:secret', insecureDev: true },
  host: 'pbs.lab', port: 8007, fingerprint, rootUser: 'root@pam',
}
const tokenId = 'root@pam!pxc-x'
const registeredArgs: AttachPbsStorageArgs = {
  pveConn, storage: 'pbs-main', datastore: 'store1', namespace: 'tenant/prod',
  nodes: ['n1', 'n2'], pbsConnectionId: 'pbs1',
}
const detachArgs = { pveConn, storage: 'pbs-main', pbsConnectionIds: ['pbs1'] }
const storageConfig = { type: 'pbs', server: 'pbs.lab', username: tokenId }
const tokenShortId = buildScopedTokenId({
  pveConnectionId: pveConn.id, pveConnName: pveConn.name, storage: registeredArgs.storage,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(pbsStorageExists).mockResolvedValue(false)
  vi.mocked(resolvePbsMeta).mockResolvedValue(meta)
  vi.mocked(pbsNs.ensureSubToken).mockResolvedValue({ tokenId, secret: 'S3CR3T' })
  vi.mocked(pveFetch).mockResolvedValue(storageConfig)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('normalizeStorageName', () => {
  it('trims and accepts dots, dashes and underscores', () => {
    expect(normalizeStorageName('  Pbs.main-1_backup  ')).toBe('Pbs.main-1_backup')
  })

  it.each([
    ['', 'storage_required'],
    ['a'.repeat(41), 'storage_too_long'],
    ['1pbs', 'storage_invalid'],
    ['pbs main', 'storage_invalid'],
    ['pbs/main', 'storage_invalid'],
  ])('rejects invalid storage %j with %s', (raw, code) => {
    expect(() => normalizeStorageName(raw)).toThrow(PbsAttachError)
    expect(() => normalizeStorageName(raw)).toThrow(expect.objectContaining({ status: 400, code }))
  })
})

describe('normalizeNamespace', () => {
  it.each(['', '/', null])('normalizes %j to the datastore root', raw => {
    expect(normalizeNamespace(raw)).toBe('')
  })

  it('strips leading and trailing slashes', () => {
    expect(normalizeNamespace('///tenant-1/prod_2///')).toBe('tenant-1/prod_2')
  })

  it.each([
    [Array(9).fill('level').join('/'), 'namespace_too_deep'],
    ['tenant/prod.main', 'namespace_invalid'],
    ['tenant/prod main', 'namespace_invalid'],
  ])('rejects namespace %j with %s', (raw, code) => {
    expect(() => normalizeNamespace(raw)).toThrow(expect.objectContaining({ status: 400, code }))
  })
})

describe('scoped token identity', () => {
  it('uses the ProxCenter prefix and is deterministic for the same input', () => {
    const args = { pveConnectionId: 'cluster-a', pveConnName: 'prod', storage: 'pbs-main' }

    expect(PXC_TOKEN_PREFIX).toBe('pxc-')
    expect(buildScopedTokenId(args)).toMatch(/^pxc-/)
    expect(buildScopedTokenId(args)).toBe(buildScopedTokenId({ ...args }))
  })

  it('isolates identically named clusters using their connection ids', () => {
    const args = { pveConnName: 'prod', storage: 'pbs-main' }

    expect(buildScopedTokenId({ ...args, pveConnectionId: 'cluster-a' }))
      .not.toBe(buildScopedTokenId({ ...args, pveConnectionId: 'cluster-b' }))
  })

  it.each([
    ['root@pam!pxc-prod-pbs-main-a1b2c3', true],
    ['root@pam!ansible', false],
    ['', false],
    [undefined, false],
  ])('classifies %j as managed: %s', (username, managed) => {
    expect(isProxCenterToken(username)).toBe(managed)
  })
})

describe('attachPbsStorage registered mode', () => {
  it.each([
    { namespace: 'tenant/prod', port: 8007 },
    { namespace: '', port: 8007 },
    { namespace: 'tenant/prod', port: 8008 },
    { namespace: '', port: 8008 },
  ])('attaches namespace "$namespace" on port $port with scoped credentials', async ({ namespace, port }) => {
    vi.mocked(resolvePbsMeta).mockResolvedValue({ ...meta, port })

    const result = await attachPbsStorage({ ...registeredArgs, namespace })

    expect(pbsStorageExists).toHaveBeenCalledWith(pveConn, 'pbs-main')
    expect(resolvePbsMeta).toHaveBeenCalledWith('pbs1')
    expect(pbsNs.ensureSubToken).toHaveBeenCalledWith(meta.conn, meta.rootUser, tokenShortId)
    expect(pbsNs.setDatastoreAuditAcl).toHaveBeenCalledWith(meta.conn, 'store1', tokenId)

    if (namespace) {
      expect(pbsNs.ensureNamespacePath).toHaveBeenCalledWith(meta.conn, 'store1', namespace)
      expect(pbsNs.setNamespaceAcl).toHaveBeenCalledWith(meta.conn, 'store1', namespace, tokenId, 'DatastoreBackup')
      expect(pbsNs.setDatastoreAcl).not.toHaveBeenCalled()
    } else {
      expect(pbsNs.ensureNamespacePath).not.toHaveBeenCalled()
      expect(pbsNs.setNamespaceAcl).not.toHaveBeenCalled()
      expect(pbsNs.setDatastoreAcl).toHaveBeenCalledWith(meta.conn, 'store1', tokenId, 'DatastoreBackup')
    }

    expect(pbsNs.waitForPbsTokenReady).toHaveBeenCalledWith(meta.conn, 'store1', tokenId, 'S3CR3T')
    expect(vi.mocked(pbsNs.waitForPbsTokenReady).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(createPbsStorage).mock.invocationCallOrder[0])
    expect(createPbsStorage).toHaveBeenCalledExactlyOnceWith(pveConn, {
      storage: 'pbs-main', server: 'pbs.lab', datastore: 'store1', namespace,
      username: tokenId, password: 'S3CR3T', fingerprint, nodes: ['n1', 'n2'],
      ...(port === 8008 ? { port: 8008 } : {}),
    })
    if (port === 8007) expect(vi.mocked(createPbsStorage).mock.calls[0][1]).not.toHaveProperty('port')
    expect(result).toEqual({
      storage: 'pbs-main', server: 'pbs.lab', datastore: 'store1', namespace, nodes: ['n1', 'n2'],
      credentials: 'scoped-token', tokenId,
      steps: { namespace: namespace ? 'created' : 'skipped', token: 'created', acl: 'ok' },
    })
  })

  it('rejects existing storage before any PBS interaction', async () => {
    vi.mocked(pbsStorageExists).mockResolvedValue(true)

    await expect(attachPbsStorage(registeredArgs)).rejects.toMatchObject({ status: 409, code: 'storage_exists' })
    expect(resolvePbsMeta).not.toHaveBeenCalled()
    for (const collaborator of Object.values(pbsNs)) expect(collaborator).not.toHaveBeenCalled()
    expect(createPbsStorage).not.toHaveBeenCalled()
  })

  it('deletes an existing token between mint attempts and uses the rotated secret', async () => {
    vi.mocked(pbsNs.ensureSubToken)
      .mockResolvedValueOnce({ tokenId, secret: null })
      .mockResolvedValueOnce({ tokenId, secret: 'NEW' })

    const result = await attachPbsStorage(registeredArgs)

    expect(pbsNs.ensureSubToken).toHaveBeenCalledTimes(2)
    expect(pbsNs.deleteSubToken).toHaveBeenCalledExactlyOnceWith(meta.conn, meta.rootUser, tokenShortId)
    const mintOrder = vi.mocked(pbsNs.ensureSubToken).mock.invocationCallOrder
    const deleteOrder = vi.mocked(pbsNs.deleteSubToken).mock.invocationCallOrder[0]

    expect(mintOrder[0]).toBeLessThan(deleteOrder)
    expect(deleteOrder).toBeLessThan(mintOrder[1])
    expect(createPbsStorage).toHaveBeenCalledWith(pveConn, expect.objectContaining({ password: 'NEW' }))
    expect(result.steps.token).toBe('rotated')
  })

  it('rejects when rotation still returns no secret', async () => {
    vi.mocked(pbsNs.ensureSubToken).mockResolvedValue({ tokenId, secret: null })

    await expect(attachPbsStorage(registeredArgs)).rejects.toMatchObject({ status: 502, code: 'token_secret_missing' })
    expect(pbsNs.ensureSubToken).toHaveBeenCalledTimes(2)
    expect(pbsNs.deleteSubToken).toHaveBeenCalledWith(meta.conn, meta.rootUser, tokenShortId)
    expect(createPbsStorage).not.toHaveBeenCalled()
  })

  it.each([false, true])('propagates the PVE error and rolls back the token (cleanup fails: %s)', async cleanupFails => {
    const original = new Error('PVE storage creation failed')

    vi.mocked(createPbsStorage).mockRejectedValue(original)
    if (cleanupFails) vi.mocked(pbsNs.deleteSubToken).mockRejectedValue(new Error('cleanup failed'))

    await expect(attachPbsStorage(registeredArgs)).rejects.toBe(original)
    expect(pbsNs.deleteSubToken).toHaveBeenCalledExactlyOnceWith(meta.conn, meta.rootUser, tokenShortId)
    expect(vi.mocked(createPbsStorage).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(pbsNs.deleteSubToken).mock.invocationCallOrder[0])
  })
})

describe('attachPbsStorage without a registered backup server', () => {
  it.each([undefined, ''])('rejects pbsConnectionId %j before any call', async connectionId => {
    // Hand-typed credentials are not an option: only a PBS declared in the
    // connections can be attached, so a missing id is refused outright.
    await expect(attachPbsStorage({ ...registeredArgs, pbsConnectionId: connectionId as any }))
      .rejects.toMatchObject({ status: 400, code: 'pbs_connection_required' })

    expect(pbsStorageExists).not.toHaveBeenCalled()
    expect(resolvePbsMeta).not.toHaveBeenCalled()
    expect(createPbsStorage).not.toHaveBeenCalled()
  })
})

describe('detachPbsStorage', () => {
  it('maps missing PVE storage to a 404', async () => {
    vi.mocked(pveFetch).mockRejectedValue(new Error("storage 'pbs-main' does not exist"))

    await expect(detachPbsStorage(detachArgs)).rejects.toMatchObject({ status: 404, code: 'storage_not_found' })
    expect(pveFetch).toHaveBeenCalledWith(pveConn, '/storage/pbs-main')
    expect(deletePbsStorage).not.toHaveBeenCalled()
  })

  it('propagates a PVE error that is not a missing storage', async () => {
    // A 500 from the cluster is not "the storage is gone": swallowing it would
    // report a detach that never happened.
    const boom = new Error('PVE 500 internal error')

    vi.mocked(pveFetch).mockRejectedValue(boom)

    await expect(detachPbsStorage(detachArgs)).rejects.toBe(boom)
    expect(deletePbsStorage).not.toHaveBeenCalled()
  })

  it('rejects non-PBS storage without deleting it', async () => {
    vi.mocked(pveFetch).mockResolvedValue({ type: 'nfs' })

    await expect(detachPbsStorage(detachArgs)).rejects.toMatchObject({ status: 400, code: 'storage_not_pbs' })
    expect(deletePbsStorage).not.toHaveBeenCalled()
  })

  it('deletes storage before revoking the short token id on the matching PBS host', async () => {
    const otherMeta = { ...meta, host: 'other.lab', conn: { ...meta.conn, baseUrl: 'https://other.lab:8007' } }

    vi.mocked(resolvePbsMeta).mockImplementation(async id => id === 'pbs-other' ? otherMeta : meta)

    const result = await detachPbsStorage({ ...detachArgs, pbsConnectionIds: ['pbs-other', 'pbs1'] })

    expect(resolvePbsMeta).toHaveBeenNthCalledWith(1, 'pbs-other')
    expect(resolvePbsMeta).toHaveBeenNthCalledWith(2, 'pbs1')
    expect(deletePbsStorage).toHaveBeenCalledExactlyOnceWith(pveConn, 'pbs-main')
    expect(pbsNs.deleteSubToken).toHaveBeenCalledExactlyOnceWith(meta.conn, 'root@pam', 'pxc-x')
    expect(vi.mocked(deletePbsStorage).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(pbsNs.deleteSubToken).mock.invocationCallOrder[0])
    expect(result).toEqual({ storage: 'pbs-main', token: 'revoked', tokenId })
  })

  it('keeps a token when a cluster could not even be resolved into a client', async () => {
    // The route hands over the clusters it failed to resolve: unclearable is
    // not the same as free, and revoking under one would break its backups.
    const result = await detachPbsStorage({ ...detachArgs, unverifiableConns: ['Ghost cluster'] })

    expect(deletePbsStorage).toHaveBeenCalledWith(pveConn, 'pbs-main')
    expect(pbsNs.deleteSubToken).not.toHaveBeenCalled()
    expect(result).toEqual({ storage: 'pbs-main', token: 'kept-in-use', tokenId, usedBy: ['Ghost cluster'] })
  })

  it('keeps a token referenced by a sibling PBS storage', async () => {
    vi.mocked(pveFetch).mockResolvedValueOnce(storageConfig).mockResolvedValueOnce([
      { type: 'pbs', storage: 'other-storage', username: tokenId },
    ])

    const result = await detachPbsStorage({ ...detachArgs, siblingConns: [sibling] })

    expect(pveFetch).toHaveBeenCalledWith(sibling, '/storage')
    expect(deletePbsStorage).toHaveBeenCalledWith(pveConn, 'pbs-main')
    expect(result).toEqual({ storage: 'pbs-main', token: 'kept-in-use', tokenId, usedBy: ['other-cluster'] })
    expect(pbsNs.deleteSubToken).not.toHaveBeenCalled()
  })

  it('counts an unreachable sibling as a token user', async () => {
    vi.mocked(pveFetch).mockResolvedValueOnce(storageConfig).mockRejectedValueOnce(new Error('cluster offline'))

    const result = await detachPbsStorage({ ...detachArgs, siblingConns: [sibling] })

    expect(pveFetch).toHaveBeenCalledWith(sibling, '/storage')
    expect(result).toMatchObject({ token: 'kept-in-use', usedBy: ['other-cluster'] })
    expect(pbsNs.deleteSubToken).not.toHaveBeenCalled()
  })

  it('keeps credentials minted outside ProxCenter', async () => {
    vi.mocked(pveFetch).mockResolvedValue({ ...storageConfig, username: 'root@pam!ansible' })

    await expect(detachPbsStorage(detachArgs)).resolves.toEqual({ storage: 'pbs-main', token: 'kept-unmanaged' })
    expect(deletePbsStorage).toHaveBeenCalledWith(pveConn, 'pbs-main')
    expect(pbsNs.deleteSubToken).not.toHaveBeenCalled()
  })

  it('keeps the token when no registered PBS matches the storage server', async () => {
    vi.mocked(resolvePbsMeta).mockResolvedValue({ ...meta, host: 'other.lab' })

    await expect(detachPbsStorage(detachArgs)).resolves.toEqual({ storage: 'pbs-main', token: 'kept-unknown-pbs', tokenId })
    expect(resolvePbsMeta).toHaveBeenCalledWith('pbs1')
    expect(pbsNs.deleteSubToken).not.toHaveBeenCalled()
  })

  it('resolves with revoke-failed when token deletion throws', async () => {
    vi.mocked(pbsNs.deleteSubToken).mockRejectedValue(new Error('PBS unavailable'))

    await expect(detachPbsStorage(detachArgs)).resolves.toEqual({ storage: 'pbs-main', token: 'revoke-failed', tokenId })
    expect(deletePbsStorage).toHaveBeenCalledWith(pveConn, 'pbs-main')
    expect(pbsNs.deleteSubToken).toHaveBeenCalledWith(meta.conn, 'root@pam', 'pxc-x')
  })
})
