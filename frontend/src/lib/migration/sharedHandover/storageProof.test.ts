import { describe, expect, it, vi } from 'vitest'

import { proveSharedStorages, type PveCall } from './storageProof'

const SRC = { conn: { id: 'src' } as any, node: 'pve1' }
const TGT = { conn: { id: 'tgt' } as any, node: 'pve1-dr' }

type Pool = string[]

/**
 * Two clusters over storage pools: each storage ID of each cluster points at
 * a pool (an array of volume names). Two IDs that share an array are the same
 * backend, whatever their names.
 */
function fakePve(opts: {
  sourceStorages: { storage: string; type: string; pool: Pool }[]
  targetStorages: { storage: string; type: string; pool: Pool; content?: string; active?: number }[]
  allocFails?: string
  deleteFails?: boolean
}) {
  const calls: string[] = []
  const pve: PveCall = vi.fn(async (conn: any, path: string, init?: RequestInit) => {
    const method = init?.method || 'GET'
    calls.push(`${conn.id} ${method} ${path}`)
    if (conn.id === 'src' && path === '/storage') return opts.sourceStorages.map(s => ({ storage: s.storage, type: s.type }))
    if (conn.id === 'tgt' && path === `/nodes/${TGT.node}/storage`) {
      return opts.targetStorages.map(s => ({ storage: s.storage, type: s.type, content: s.content ?? 'images,rootdir', active: s.active ?? 1, enabled: 1 }))
    }
    const content = /^\/nodes\/[^/]+\/storage\/([^/]+)\/content(?:\/(.+))?$/.exec(path.split('?')[0])
    if (content && conn.id === 'src') {
      const pool = opts.sourceStorages.find(s => s.storage === content[1])!.pool
      if (method === 'POST') {
        if (opts.allocFails) throw new Error(opts.allocFails)
        const filename = new URLSearchParams(String(init?.body)).get('filename')!
        pool.push(filename)

        return `${content[1]}:${filename}`
      }
      if (method === 'DELETE') {
        if (opts.deleteFails) throw new Error('storage busy')
        const name = decodeURIComponent(content[2]).split(':')[1]
        pool.splice(pool.indexOf(name), 1)

        return 'UPID:imgdel'
      }
    }
    if (content && conn.id === 'tgt' && method === 'GET') {
      const pool = opts.targetStorages.find(s => s.storage === content[1])!.pool

      return pool.map(name => ({ volid: `${content[1]}:${name}`, vmid: 100 }))
    }
    throw new Error(`unexpected ${conn.id} ${method} ${path}`)
  }) as unknown as PveCall

  return { pve, calls }
}

const volumes = (storage: string, ...names: string[]) =>
  names.map(n => ({ section: 'main', key: 'scsi0', storage, volid: `${storage}:${n}` }))

describe('proveSharedStorages', () => {
  it('proves a target storage of another name that holds the same pool', async () => {
    const pool = ['vm-100-disk-0']
    const { pve } = fakePve({
      sourceStorages: [{ storage: 'CephStoragePool', type: 'rbd', pool }],
      targetStorages: [{ storage: 'XC-ProdCeph', type: 'rbd', pool }],
    })

    const proofs = await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: volumes('CephStoragePool', 'vm-100-disk-0'), pve, randomId: () => 'ab12' })

    expect(proofs).toEqual([{ storage: 'CephStoragePool', ok: true, target: 'XC-ProdCeph' }])
  })

  it('never trusts a storage of the same name on another backend (the lab case: two Ceph clusters, one name)', async () => {
    const { pve } = fakePve({
      sourceStorages: [{ storage: 'CephStoragePool', type: 'rbd', pool: ['vm-100-disk-0'] }],
      targetStorages: [{ storage: 'CephStoragePool', type: 'rbd', pool: ['vm-100-disk-0'] }],
    })

    const [proof] = await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: volumes('CephStoragePool', 'vm-100-disk-0'), pve, randomId: () => 'ab12' })

    expect(proof).toEqual({ storage: 'CephStoragePool', ok: false, reason: 'not-visible' })
  })

  it('removes the probe volume once the target was read, and before answering', async () => {
    const pool = ['vm-100-disk-0']
    const { pve, calls } = fakePve({
      sourceStorages: [{ storage: 'A', type: 'rbd', pool }],
      targetStorages: [{ storage: 'B', type: 'rbd', pool }],
    })

    await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: volumes('A', 'vm-100-disk-0'), pve, randomId: () => 'ab12' })

    expect(pool).toEqual(['vm-100-disk-0'])
    expect(calls).toEqual([
      'src GET /storage',
      'tgt GET /nodes/pve1-dr/storage',
      'src POST /nodes/pve1/storage/A/content',
      'tgt GET /nodes/pve1-dr/storage/B/content?vmid=100',
      'src DELETE /nodes/pve1/storage/A/content/A%3Avm-100-pxcprobe-ab12',
    ])
  })

  it('removes the probe volume when the target cannot be read', async () => {
    const pool = ['vm-100-disk-0']
    const { pve } = fakePve({ sourceStorages: [{ storage: 'A', type: 'rbd', pool }], targetStorages: [{ storage: 'B', type: 'rbd', pool }] })
    const failing: PveCall = (async (conn: any, path: string, init?: RequestInit) => {
      if (conn.id === 'tgt' && path.includes('/content')) throw new Error('target down')

      return pve(conn, path, init)
    }) as PveCall

    const [proof] = await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: volumes('A', 'vm-100-disk-0'), pve: failing, randomId: () => 'ab12' })

    expect(pool).toEqual(['vm-100-disk-0'])
    expect(proof).toMatchObject({ ok: false, reason: 'not-visible' })
  })

  it('matches a probe that a file storage stored as <vmid>/<name>.raw', async () => {
    const src = ['100/vm-100-disk-0.raw']
    const { pve } = fakePve({ sourceStorages: [{ storage: 'NFS-A', type: 'nfs', pool: src }], targetStorages: [{ storage: 'NFS-B', type: 'nfs', pool: src }] })
    const asFile: PveCall = (async (conn: any, path: string, init?: RequestInit) => {
      const out: any = await pve(conn, path, init)
      if (conn.id === 'tgt' && path.includes('/content?')) return out.map((e: any) => ({ ...e, volid: e.volid.replace(/:(vm-100-pxcprobe-ab12)$/, ':100/$1.raw') }))

      return out
    }) as PveCall

    const [proof] = await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: volumes('NFS-A', '100/vm-100-disk-0.raw'), pve: asFile, randomId: () => 'ab12' })

    expect(proof).toEqual({ storage: 'NFS-A', ok: true, target: 'NFS-B' })
  })

  it('refuses a proven storage that lacks one of the guest volumes (another namespace of the same pool)', async () => {
    const pool = ['vm-100-disk-0']
    const { pve } = fakePve({ sourceStorages: [{ storage: 'A', type: 'rbd', pool }], targetStorages: [{ storage: 'B', type: 'rbd', pool }] })

    const [proof] = await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: volumes('A', 'vm-100-disk-0', 'vm-100-disk-1'), pve, randomId: () => 'ab12' })

    expect(proof).toEqual({ storage: 'A', ok: false, reason: 'volumes-missing', missing: ['A:vm-100-disk-1'] })
  })

  it('tries the target storages of the same type only, the one of the same name first', async () => {
    const pool = ['vm-100-disk-0']
    const { pve, calls } = fakePve({
      sourceStorages: [{ storage: 'A', type: 'rbd', pool }],
      targetStorages: [
        { storage: 'nfs', type: 'nfs', pool: [] },
        { storage: 'Z', type: 'rbd', pool },
        { storage: 'A', type: 'rbd', pool: [] },
      ],
    })

    const [proof] = await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: volumes('A', 'vm-100-disk-0'), pve, randomId: () => 'ab12' })

    expect(proof).toEqual({ storage: 'A', ok: true, target: 'Z' })
    expect(calls.filter(c => c.startsWith('tgt GET') && c.includes('/content'))).toEqual([
      'tgt GET /nodes/pve1-dr/storage/A/content?vmid=100',
      'tgt GET /nodes/pve1-dr/storage/Z/content?vmid=100',
    ])
  })

  it('skips an inactive target storage and one that cannot hold the guest kind', async () => {
    const pool: string[] = []
    const { pve } = fakePve({
      sourceStorages: [{ storage: 'A', type: 'rbd', pool }],
      targetStorages: [
        { storage: 'off', type: 'rbd', pool, active: 0 },
        { storage: 'imgonly', type: 'rbd', pool, content: 'images' },
      ],
    })

    const [proof] = await proveSharedStorages({ source: SRC, target: TGT, vmid: '101', type: 'lxc', volumes: volumes('A', 'vm-101-disk-0'), pve, randomId: () => 'ab12' })

    expect(proof).toEqual({ storage: 'A', ok: false, reason: 'no-candidate' })
  })

  it('does not probe a storage type that is local by nature', async () => {
    const { pve, calls } = fakePve({
      sourceStorages: [{ storage: 'local-zfs', type: 'zfspool', pool: [] }],
      targetStorages: [{ storage: 'local-zfs', type: 'zfspool', pool: [] }],
    })

    const [proof] = await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: volumes('local-zfs', 'vm-100-disk-0'), pve })

    expect(proof).toEqual({ storage: 'local-zfs', ok: false, reason: 'local-type' })
    expect(calls.some(c => c.includes('POST'))).toBe(false)
  })

  it('reports a storage where Proxmox refuses the probe (an iSCSI LUN storage, a full pool)', async () => {
    const { pve } = fakePve({
      sourceStorages: [{ storage: 'A', type: 'rbd', pool: [] }],
      targetStorages: [{ storage: 'B', type: 'rbd', pool: [] }],
      allocFails: 'pool is full',
    })

    const [proof] = await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: volumes('A', 'vm-100-disk-0'), pve, randomId: () => 'ab12' })

    expect(proof).toEqual({ storage: 'A', ok: false, reason: 'probe-failed', detail: 'pool is full' })
  })

  it('keeps a proof when only the probe removal fails', async () => {
    const pool = ['vm-100-disk-0']
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { pve } = fakePve({ sourceStorages: [{ storage: 'A', type: 'rbd', pool }], targetStorages: [{ storage: 'B', type: 'rbd', pool }], deleteFails: true })

    const [proof] = await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: volumes('A', 'vm-100-disk-0'), pve, randomId: () => 'ab12' })

    expect(proof).toEqual({ storage: 'A', ok: true, target: 'B' })
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('proves nothing for a guest without disks', async () => {
    const { pve, calls } = fakePve({ sourceStorages: [], targetStorages: [] })

    expect(await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: [], pve })).toEqual([])
    expect(calls).toEqual([])
  })

  it('answers no-candidate for a storage unknown to the source cluster', async () => {
    const { pve } = fakePve({ sourceStorages: [], targetStorages: [] })

    const [proof] = await proveSharedStorages({ source: SRC, target: TGT, vmid: '100', type: 'qemu', volumes: volumes('Gone', 'vm-100-disk-0'), pve })

    expect(proof).toEqual({ storage: 'Gone', ok: false, reason: 'no-candidate' })
  })

  it('proves each storage of the guest once', async () => {
    const a: string[] = ['vm-100-disk-0']
    const b: string[] = ['vm-100-disk-1']
    const { pve } = fakePve({
      sourceStorages: [{ storage: 'A', type: 'rbd', pool: a }, { storage: 'N', type: 'nfs', pool: b }],
      targetStorages: [{ storage: 'A2', type: 'rbd', pool: a }, { storage: 'N2', type: 'nfs', pool: b }],
    })

    const proofs = await proveSharedStorages({
      source: SRC, target: TGT, vmid: '100', type: 'qemu',
      volumes: [...volumes('A', 'vm-100-disk-0'), ...volumes('N', 'vm-100-disk-1'), ...volumes('A', 'vm-100-disk-0')],
      pve, randomId: () => 'ab12',
    })

    expect(proofs).toEqual([
      { storage: 'A', ok: true, target: 'A2' },
      { storage: 'N', ok: true, target: 'N2' },
    ])
  })
})
