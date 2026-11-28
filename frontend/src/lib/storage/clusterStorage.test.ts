import { beforeEach, describe, expect, it, vi } from 'vitest'

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/proxmox/client', () => {
  class PveApplicationError extends Error {
    statusCode: number

    constructor(message: string, statusCode: number) {
      super(message)
      this.statusCode = statusCode
    }
  }

  return { pveFetch: (...a: any[]) => pveFetchMock(...a), PveApplicationError }
})

import { PveApplicationError } from '@/lib/proxmox/client'

import {
  buildStorageParams,
  ClusterStorageError,
  pveMessage,
  redactSecrets,
  resetScanLocks,
  scanStorageTarget,
  SCAN_HOLD_MS,
  sanLunsOfTarget,
  scrubStorageConfig,
  storageActivation,
  storageUsage,
  STATUS_RETRIES,
  STATUS_RETRY_DELAY_MS,
  STATUS_TIMEOUT_MS,
  wwidOfVolid,
} from './clusterStorage'
import { formatBwlimit, isClusterStorageType, parseBwlimit } from './clusterStorageTypes'

const conn = { id: 'c1', baseUrl: 'https://pve', apiToken: 't' } as any

beforeEach(() => {
  pveFetchMock.mockReset()
  resetScanLocks()
  vi.useRealTimers()
})

describe('buildStorageParams: create', () => {
  it('builds an NFS storage with its contents, nodes, disabled flag and limits', () => {
    expect(buildStorageParams({
      type: 'nfs',
      storage: 'nfs-1',
      fields: { server: ' 10.0.0.5 ', export: '/srv', options: 'vers=4.2' },
      content: ['images', 'iso', 'images'],
      nodes: ['pve1', 'pve2'],
      enabled: false,
      bwlimit: { default: 100, restore: null },
    }, 'create')).toEqual({
      params: {
        storage: 'nfs-1', type: 'nfs', server: '10.0.0.5', export: '/srv', options: 'vers=4.2',
        content: 'images,iso', nodes: 'pve1,pve2', disable: '1', bwlimit: 'default=102400',
      },
      deletes: [],
    })
  })

  it('keeps a CIFS password and drops the default SMB version', () => {
    const { params } = buildStorageParams({
      type: 'cifs', storage: 'smb', fields: { server: 's', share: 'x', username: 'u', password: 'p@ss', smbversion: 'default' }, content: ['iso'],
    }, 'create')

    expect(params).toMatchObject({ username: 'u', password: 'p@ss', share: 'x' })
    expect(params.smbversion).toBeUndefined()
  })

  it('sends booleans as 0/1 and the shared choice where the type has one', () => {
    const { params } = buildStorageParams({
      type: 'lvm', storage: 'vg', fields: { vgname: 'vg0', base: 'iscsi:0.0.0.scsi-1', saferemove: true }, content: ['images'], shared: true,
    }, 'create')

    expect(params).toMatchObject({ vgname: 'vg0', base: 'iscsi:0.0.0.scsi-1', saferemove: '1', shared: '1' })
  })

  it('needs the LIO portal group only for the LIO provider', () => {
    const base = { type: 'zfs' as const, storage: 'z1', fields: { portal: 'p', pool: 'tank', target: 't' }, content: ['images'] }

    expect(() => buildStorageParams({ ...base, fields: { ...base.fields, iscsiprovider: 'LIO' } }, 'create')).toThrow('lio_tpg is required')
    expect(buildStorageParams({ ...base, fields: { ...base.fields, iscsiprovider: 'comstar', lio_tpg: 'tpg1' } }, 'create').params.lio_tpg).toBeUndefined()
    expect(buildStorageParams({ ...base, fields: { ...base.fields, iscsiprovider: 'LIO', lio_tpg: 'tpg1' } }, 'create').params.lio_tpg).toBe('tpg1')
  })

  it('accepts a multi-line keyring and refuses a control character elsewhere', () => {
    const keyring = '[client.admin]\n\tkey = abc=='

    expect(buildStorageParams({ type: 'rbd', storage: 'ext', fields: { monhost: 'm', pool: 'p', username: 'admin', keyring }, content: ['images'] }, 'create').params.keyring).toBe(keyring)
    expect(() => buildStorageParams({ type: 'dir', storage: 'd1', fields: { path: '/a\nb' }, content: ['iso'] }, 'create')).toThrow('control character')
  })

  it.each([
    [{ type: 'glusterfs' }, 'Unsupported storage type'],
    [{ type: 'dir', storage: '1abc', fields: { path: '/x' }, content: ['iso'] }, 'Invalid storage id'],
    [{ type: 'dir', storage: 'd1', fields: {}, content: ['iso'] }, 'path is required'],
    [{ type: 'dir', storage: 'd1', fields: { path: '/x' }, content: [] }, 'Pick at least one content type'],
    [{ type: 'dir', storage: 'd1', fields: { path: '/x' }, content: ['none'] }, 'Content type not allowed for this storage'],
    [{ type: 'iscsi', storage: 'i1', fields: { portal: 'p', target: 't' }, content: ['images', 'none'] }, 'Content type not allowed for this storage'],
    [{ type: 'dir', storage: 'd1', fields: { path: '/x' }, content: ['iso'], nodes: ['bad node'] }, 'Invalid node name'],
    [{ type: 'cifs', storage: 'c1', fields: { server: 's', share: 'x', smbversion: '1.0' }, content: ['iso'] }, 'Invalid smbversion'],
    [{ type: 'lvm', storage: 'l1', fields: { vgname: 'v', base: 'not a volid' }, content: ['images'] }, 'Invalid base volume'],
    [{ type: 'dir', storage: 'd1', fields: { path: 'x'.repeat(1025) }, content: ['iso'] }, 'path is too long'],
  ])('refuses %j', (input, message) => {
    expect(() => buildStorageParams(input as any, 'create')).toThrow(message)
  })
})

describe('buildStorageParams: update', () => {
  it('skips the fixed fields, keeps a blank secret and clears emptied optional ones', () => {
    expect(buildStorageParams({
      type: 'cifs',
      fields: { server: 'other', share: 'other', username: 'u', password: '', domain: '', smbversion: 'default', subdir: '' },
      content: ['iso'],
      nodes: [],
      enabled: true,
      bwlimit: {},
    }, 'update')).toEqual({
      params: { username: 'u', content: 'iso' },
      deletes: ['domain', 'smbversion', 'subdir', 'nodes', 'disable', 'bwlimit'],
    })
  })

  it('writes a new secret and never names the storage or its type', () => {
    const { params } = buildStorageParams({ type: 'rbd', fields: { monhost: 'm', username: 'admin', keyring: 'new' }, content: ['images'] }, 'update')

    expect(params).toMatchObject({ keyring: 'new', monhost: 'm' })
    expect(params.storage).toBeUndefined()
    expect(params.type).toBeUndefined()
  })
})

describe('helpers', () => {
  it('converts bandwidth limits between MiB/s and Proxmox KiB/s', () => {
    expect(parseBwlimit('clone=1024,default=51200,bogus=1,move=x')).toEqual({ clone: 1, default: 50 })
    expect(parseBwlimit(undefined)).toEqual({})
    expect(formatBwlimit({ default: 50, migration: 0, restore: null, move: 2 })).toBe('default=51200,move=2048')
    expect(formatBwlimit(null)).toBe('')
  })

  it('recognises the managed types', () => {
    expect(isClusterStorageType('nfs')).toBe(true)
    expect(isClusterStorageType('pbs')).toBe(false)
    expect(isClusterStorageType(3)).toBe(false)
  })

  it('scrubs secrets out of a config and out of a message', () => {
    expect(scrubStorageConfig({ type: 'cifs', password: 'x', keyring: 'y', 'encryption-key': 'z', server: 's' })).toEqual({ type: 'cifs', server: 's' })
    expect(redactSecrets('login p@ss failed for p@ss', ['p@ss', undefined, 'ab'])).toBe('login *** failed for ***')
  })

  it("reads Proxmox's sentence out of a PVE error", () => {
    expect(pveMessage(new Error('PVE 400 /storage: {"message":"bad","errors":{"server":"invalid"}}'))).toBe('bad server: invalid')
    expect(pveMessage(new Error('PVE 500 /storage: not json'))).toBe('PVE 500 /storage: not json')
    expect(pveMessage(new Error('plain'))).toBe('plain')
  })
})

describe('scanStorageTarget', () => {
  it('maps each scan to entries and sends only what it needs', async () => {
    pveFetchMock.mockResolvedValueOnce([{ path: '/srv', options: '10.0.0.0/24' }])
    expect(await scanStorageTarget(conn, 'c1', 'pve1', { type: 'nfs', server: 'n' })).toEqual([{ value: '/srv', detail: '10.0.0.0/24' }])
    expect(pveFetchMock.mock.calls[0][1]).toBe('/nodes/pve1/scan/nfs?server=n')
    expect(pveFetchMock.mock.calls[0][3]).toEqual({ timeoutMs: 20_000 })

    pveFetchMock.mockResolvedValueOnce([{ share: 'data', description: 'Data' }])
    expect(await scanStorageTarget(conn, 'c1', 'pve1', { type: 'cifs', server: 's', username: 'u', password: 'p' })).toEqual([{ value: 'data', detail: 'Data' }])
    expect(pveFetchMock.mock.calls[1][1]).toBe('/nodes/pve1/scan/cifs?server=s&username=u&password=p')

    pveFetchMock.mockResolvedValueOnce([{ target: 'iqn.x', portal: '1.2.3.4:3260' }])
    expect(await scanStorageTarget(conn, 'c1', 'pve1', { type: 'iscsi', portal: '1.2.3.4' })).toEqual([{ value: 'iqn.x', detail: '1.2.3.4:3260' }])

    pveFetchMock.mockResolvedValueOnce([{ vg: 'pve', free: 10 }, { vg: 'data' }])
    expect(await scanStorageTarget(conn, 'c1', 'pve1', { type: 'lvm' })).toEqual([{ value: 'pve', detail: '10' }, { value: 'data', detail: null }])
    expect(pveFetchMock.mock.calls[3][1]).toBe('/nodes/pve1/scan/lvm')
  })

  it.each([
    [{ type: 'zfs' }, 'Unsupported scan'],
    [{ type: 'nfs' }, 'server is required'],
    [{ type: 'iscsi' }, 'portal is required'],
  ])('refuses %j before calling Proxmox', async (req, message) => {
    await expect(scanStorageTarget(conn, 'c1', 'pve1', req as any)).rejects.toThrow(message)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('refuses a bad node name', async () => {
    await expect(scanStorageTarget(conn, 'c1', '../x', { type: 'lvm' })).rejects.toThrow('Invalid node name')
  })

  it('reports a Proxmox refusal without the password, and frees the node', async () => {
    pveFetchMock.mockRejectedValueOnce(new (PveApplicationError as any)('PVE 500 /scan: {"message":"denied for secret1"}', 500))

    const err = await scanStorageTarget(conn, 'c1', 'pve1', { type: 'cifs', server: 's', password: 'secret1' }).catch(e => e)

    expect(err).toBeInstanceOf(ClusterStorageError)
    expect(err).toMatchObject({ status: 422, code: 'SCAN_FAILED', message: 'denied for ***' })
    pveFetchMock.mockResolvedValueOnce([])
    await expect(scanStorageTarget(conn, 'c1', 'pve1', { type: 'lvm' })).resolves.toEqual([])
  })

  it('holds the node after a timeout, one scan per node, until the hold lapses', async () => {
    vi.useFakeTimers()
    pveFetchMock.mockRejectedValueOnce(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))

    await expect(scanStorageTarget(conn, 'c1', 'pve1', { type: 'nfs', server: 'dead' })).rejects.toMatchObject({ status: 504, code: 'SCAN_TIMEOUT' })
    await expect(scanStorageTarget(conn, 'c1', 'pve1', { type: 'lvm' })).rejects.toMatchObject({ status: 409, code: 'SCAN_BUSY' })

    pveFetchMock.mockResolvedValue([])
    // Another node, or another cluster, is not held.
    await expect(scanStorageTarget(conn, 'c1', 'pve2', { type: 'lvm' })).resolves.toEqual([])
    await expect(scanStorageTarget(conn, 'c2', 'pve1', { type: 'lvm' })).resolves.toEqual([])

    vi.advanceTimersByTime(SCAN_HOLD_MS + 1)
    await expect(scanStorageTarget(conn, 'c1', 'pve1', { type: 'lvm' })).resolves.toEqual([])
  })
})

describe('storageUsage', () => {
  const route = (map: Record<string, any>) => pveFetchMock.mockImplementation(async (_c: any, path: string) => {
    if (path in map) {
      const v = map[path]
      if (v instanceof Error) throw v
      return v
    }
    throw new Error(`unexpected ${path}`)
  })

  it('lists a shared storage from the first node that answers', async () => {
    route({
      '/nodes/pve1/storage/nfs/content': new Error('down'),
      '/nodes/pve2/storage/nfs/content': [
        { volid: 'nfs:101/vm-101-disk-0.qcow2', vmid: 101, content: 'images' },
        { volid: 'nfs:iso/a.iso', content: 'iso' },
        { volid: 'nfs:backup/vzdump-qemu-102.vma', vmid: 102, content: 'backup' },
      ],
      '/cluster/backup': [{ id: 'job1', storage: 'nfs' }, { id: 'job2', storage: 'other' }],
      '/storage': [{ storage: 'nfs' }],
    })

    expect(await storageUsage(conn, 'nfs', { type: 'nfs' }, ['pve1', 'pve2', 'pve3'])).toEqual({
      volumes: [{ volid: 'nfs:101/vm-101-disk-0.qcow2', vmid: 101 }],
      backupJobs: ['job1'],
      dependents: [],
      unverified: [],
    })
    expect(pveFetchMock.mock.calls.map(c => c[1])).not.toContain('/nodes/pve3/storage/nfs/content')
  })

  it('lists a local storage on each of its nodes and names what it could not read', async () => {
    route({
      '/nodes/a/storage/d/content': [{ volid: 'd:200/vm-200-disk-0.raw', vmid: 200, content: 'images' }],
      '/nodes/b/storage/d/content': new Error('offline'),
      '/nodes/c/storage/d/content': [{ volid: 'd:subvol-300-disk-0', vmid: 300, content: 'rootdir' }],
      '/cluster/backup': new Error('x'),
      '/storage': [{ storage: 'lvm1', base: 'd:0.0.1' }, { storage: 'd' }],
    })

    expect(await storageUsage(conn, 'd', { type: 'dir', nodes: 'a,b,c' }, ['a', 'b', 'c', 'z'])).toEqual({
      volumes: [{ volid: 'd:200/vm-200-disk-0.raw', vmid: 200 }, { volid: 'd:subvol-300-disk-0', vmid: 300 }],
      backupJobs: [],
      dependents: ['lvm1'],
      unverified: ['b', 'backup jobs'],
    })
  })

  it('reports every node of a shared storage when none answers, and an unreadable storage.cfg', async () => {
    route({ '/cluster/backup': [], '/storage': new Error('x') })

    const usage = await storageUsage(conn, 's', { type: 'rbd' }, ['a', 'b'])

    expect(usage.unverified).toEqual(['a', 'b', 'storage.cfg'])
  })
})

describe('buildStorageParams: managed multipath (PVE 9.3)', () => {
  it('sends managed-multipath only when the dialog set it', () => {
    const on = buildStorageParams({ type: 'iscsi', storage: 'san', fields: { portal: '10.0.0.1', target: 'iqn.x', 'managed-multipath': true }, content: ['none'] }, 'create')
    const unset = buildStorageParams({ type: 'iscsi', storage: 'san', fields: { portal: '10.0.0.1', target: 'iqn.x' }, content: ['none'] }, 'create')

    expect(on.params['managed-multipath']).toBe('1')
    expect(unset.params).not.toHaveProperty('managed-multipath')
  })

  it('lets an update switch it off, the portal and target staying fixed', () => {
    const out = buildStorageParams({ type: 'iscsi', fields: { portal: 'x', target: 'y', 'managed-multipath': false }, content: ['images'] }, 'update')

    expect(out.params).toEqual({ 'managed-multipath': '0', content: 'images' })
  })
})

describe('storageActivation', () => {
  const route = (map: Record<string, any>) => pveFetchMock.mockImplementation(async (_c: any, path: string) => {
    if (path in map) {
      const v = map[path]
      if (v instanceof Error) throw v
      return v
    }
    throw new Error(`unexpected ${path}`)
  })

  it('names the nodes where the new storage is not active and those it could not read', async () => {
    route({
      '/nodes': [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }, { node: 'pve3', status: 'online' }, { node: 'pve4', status: 'offline' }],
      '/nodes/pve1/storage/lvm1/status': { active: 1 },
      '/nodes/pve2/storage/lvm1/status': { active: 0 },
      '/nodes/pve3/storage/lvm1/status': new Error('timeout'),
    })

    expect(await storageActivation(conn, 'lvm1', [], { retryDelayMs: 0 })).toEqual({ inactive: ['pve2'], unverified: ['pve3', 'pve4'] })
    // An inactive node is read again before it counts: 1 + STATUS_RETRIES reads.
    expect(pveFetchMock.mock.calls.filter(c => c[1] === '/nodes/pve2/storage/lvm1/status')).toHaveLength(1 + STATUS_RETRIES)
    expect(pveFetchMock.mock.calls.filter(c => c[1] === '/nodes/pve1/storage/lvm1/status')).toHaveLength(1)
    expect(pveFetchMock.mock.calls.find(c => c[1] === '/nodes/pve1/storage/lvm1/status')?.[3]).toEqual({ timeoutMs: STATUS_TIMEOUT_MS })
  })

  it('reads only the nodes the storage is restricted to, two at a time', async () => {
    let inFlight = 0
    let peak = 0
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 5))
      inFlight--
      if (path === '/nodes/b/storage/s%20x/status') return { active: '0' }
      return { active: 1 }
    })

    expect(await storageActivation(conn, 's x', ['a', 'b', 'c'], { retryDelayMs: 0 })).toEqual({ inactive: ['b'], unverified: [] })
    expect(peak).toBe(2)
    expect(pveFetchMock.mock.calls.map(c => c[1])).not.toContain('/nodes')
  })

  it('counts a node active once a later read finds it so (first activation still running)', async () => {
    let reads = 0
    pveFetchMock.mockImplementation(async () => ({ active: ++reads >= 2 ? 1 : 0 }))

    expect(await storageActivation(conn, 'san', ['pve2'], { retryDelayMs: 0 })).toEqual({ inactive: [], unverified: [] })
    expect(reads).toBe(2)
  })

  it('waits between two reads of an inactive node', async () => {
    vi.useFakeTimers()
    pveFetchMock.mockResolvedValue({ active: 0 })

    const done = storageActivation(conn, 'san', ['pve2'])
    await vi.advanceTimersByTimeAsync(STATUS_RETRY_DELAY_MS - 1)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(STATUS_RETRIES * STATUS_RETRY_DELAY_MS)
    expect(await done).toEqual({ inactive: ['pve2'], unverified: [] })
    expect(pveFetchMock).toHaveBeenCalledTimes(1 + STATUS_RETRIES)
  })

  it('checks nothing when the node list cannot be read', async () => {
    route({ '/nodes': new Error('x') })

    expect(await storageActivation(conn, 's', [])).toEqual({ inactive: [], unverified: [] })
  })
})

describe('SAN LUNs (PVE 9.3)', () => {
  it('reads the WWID out of a plain or a multipath LUN volume', () => {
    expect(wwidOfVolid('san:0.0.0.scsi-360014055da67a6945b74cdb9c27d4503')).toBe('360014055da67a6945b74cdb9c27d4503')
    expect(wwidOfVolid('san:0.0.1.dm-uuid-mpath-36001405eec39c111ab048b1bd34c9f44')).toBe('36001405eec39c111ab048b1bd34c9f44')
    expect(wwidOfVolid('san:something-else')).toBeNull()
  })

  it("keeps the LUNs of one target, with their paths, health and usage", async () => {
    pveFetchMock.mockResolvedValueOnce([
      { wwid: 'w1', 'iscsi-target': 'iqn.a', state: 'optimal', 'paths-active': 2, 'paths-total': 2, usage: 'unused', size: 4294967296 },
      { wwid: 'w2', 'iscsi-target': 'iqn.a', state: 'degraded', 'paths-active': 1, 'paths-total': 2, usage: 'lvm' },
      { wwid: 'w3', 'iscsi-target': 'iqn.other', state: 'optimal', usage: 'unused' },
      { wwid: 'w4', transport: 'fc', state: 'optimal' },
    ])

    expect(await sanLunsOfTarget(conn, 'pve1', 'iqn.a')).toEqual([
      { wwid: 'w1', state: 'optimal', pathsActive: 2, pathsTotal: 2, usage: 'unused' },
      { wwid: 'w2', state: 'degraded', pathsActive: 1, pathsTotal: 2, usage: 'lvm' },
    ])
    expect(pveFetchMock.mock.calls[0][1]).toBe('/nodes/pve1/san/luns')
  })

  it('answers null where Proxmox has no SAN view (before 9.3) or the node fails', async () => {
    pveFetchMock.mockRejectedValueOnce(new PveApplicationError('PVE 501 /nodes/pve1/san/luns: Method not implemented', 501))
    expect(await sanLunsOfTarget(conn, 'pve1', 'iqn.a')).toBeNull()

    pveFetchMock.mockRejectedValueOnce(new Error('down'))
    expect(await sanLunsOfTarget(conn, 'pve1', 'iqn.a')).toBeNull()
  })

  it('refuses a bad node name', async () => {
    await expect(sanLunsOfTarget(conn, '../x', 'iqn.a')).rejects.toThrow('Invalid node name')
  })
})
