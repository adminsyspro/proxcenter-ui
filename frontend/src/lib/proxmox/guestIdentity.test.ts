/**
 * Proxmox VE 9.3 guest identity: a restore over a guest refuses a backup of
 * another guest. Configs copied from the lab on 26/11/2026 (PVE-DR 9.3.1,
 * VMs 9930/9931).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const pveFetchMock = vi.fn<(conn: any, path: string) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

const { findIdentityMismatch, guestUidFromArchiveConfig, guestUidFromMeta } = await import('./guestIdentity')

const conn = { baseUrl: 'https://dr:8006', apiToken: 't' }
const META_9930 = 'creation-qemu=11.1.3,ctime=1795721109,rtime=1795721109025,uid=p4l2rclc4u4xzaq2vh5t'
const META_9931 = 'creation-qemu=11.1.3,ctime=1795721110,rtime=1795721110034,uid=ya4v66n3dt7o3nss4aku'
const ARCHIVE = 'local:backup/vzdump-qemu-9930-2026_11_26-20_25_11.vma.zst'
const archiveConfig = (meta?: string) =>
  [meta ? `meta: ${meta}` : '', 'memory: 128', 'name: pve93-src-a', 'scsi0: CephStoragePool:vm-9930-disk-0,size=1G', '', '[pve93snap]', 'meta: uid=snapshot-section'].filter(Boolean).join('\n')

function pve(routes: Record<string, any>) {
  pveFetchMock.mockImplementation(async (_conn, path) => {
    if (!(path in routes)) throw new Error(`unexpected PVE call ${path}`)
    const value = routes[path]
    if (value instanceof Error) throw value

    return value
  })
}

beforeEach(() => {
  pveFetchMock.mockReset()
})

describe('guestUidFromMeta', () => {
  it('reads the uid of a meta property', () => {
    expect(guestUidFromMeta(META_9930)).toBe('p4l2rclc4u4xzaq2vh5t')
  })

  it('is null for a guest without identity (PVE before 9.3)', () => {
    expect(guestUidFromMeta('creation-qemu=9.0.2,ctime=1720000000')).toBeNull()
    expect(guestUidFromMeta(undefined)).toBeNull()
  })
})

describe('guestUidFromArchiveConfig', () => {
  it('reads the current section only, not a snapshot section', () => {
    expect(guestUidFromArchiveConfig(archiveConfig(META_9930))).toBe('p4l2rclc4u4xzaq2vh5t')
    expect(guestUidFromArchiveConfig(archiveConfig())).toBeNull()
  })
})

describe('findIdentityMismatch', () => {
  const guest = { node: 'pve2-dr', type: 'qemu', vmid: 9931 }
  const routes = (backupMeta?: string, guestMeta?: string) => ({
    '/nodes/pve2-dr/qemu/9931/config': { name: 'pve93-dst-b', ...(guestMeta ? { meta: guestMeta } : {}) },
    [`/nodes/pve2-dr/vzdump/extractconfig?volume=${encodeURIComponent(ARCHIVE)}`]: archiveConfig(backupMeta),
  })

  it('reports a backup of another guest (the lab case)', async () => {
    pve(routes(META_9930, META_9931))
    expect(await findIdentityMismatch(conn, 'pve2-dr', ARCHIVE, guest)).toEqual({ backupUid: 'p4l2rclc4u4xzaq2vh5t', guestUid: 'ya4v66n3dt7o3nss4aku' })
  })

  it('lets a backup of the same guest through', async () => {
    pve(routes(META_9931, META_9931))
    expect(await findIdentityMismatch(conn, 'pve2-dr', ARCHIVE, guest)).toBeNull()
  })

  it('lets PVE decide when either side has no uid', async () => {
    pve(routes(undefined, META_9931))
    expect(await findIdentityMismatch(conn, 'pve2-dr', ARCHIVE, guest)).toBeNull()
    pve(routes(META_9930, undefined))
    expect(await findIdentityMismatch(conn, 'pve2-dr', ARCHIVE, guest)).toBeNull()
  })

  it('lets PVE decide when a config cannot be read', async () => {
    pve({ ...routes(META_9930, META_9931), [`/nodes/pve2-dr/vzdump/extractconfig?volume=${encodeURIComponent(ARCHIVE)}`]: new Error('500') })
    expect(await findIdentityMismatch(conn, 'pve2-dr', ARCHIVE, guest)).toBeNull()
  })

  it('reads a container config on its own endpoint', async () => {
    pve({
      '/nodes/pve3-dr/lxc/120/config': { meta: META_9931 },
      [`/nodes/pve2-dr/vzdump/extractconfig?volume=${encodeURIComponent(ARCHIVE)}`]: archiveConfig(META_9930),
    })
    expect(await findIdentityMismatch(conn, 'pve2-dr', ARCHIVE, { node: 'pve3-dr', type: 'lxc', vmid: '120' })).not.toBeNull()
  })
})
