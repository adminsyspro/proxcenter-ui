import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: vi.fn() }))

import { _impl, listSourceDirectory, walkSourceTree } from './walk'

const pve = { kind: 'pve', conn: { id: 'c1' }, dispatcher: undefined, nodeName: 'pve3', storage: 'pbs', volumeId: 'pbs:backup/vm/109/x' } as any
const pbs = { kind: 'pbs', conn: { id: 'p1' }, datastore: 'ds', namespace: 'tenant-a', backupType: 'ct', backupId: '200', backupTime: 1700000000, archive: 'root.pxar.didx' } as any

const b64 = (s: string) => Buffer.from(s).toString('base64')

/** Fake PVE listing keyed by the decoded filepath of the request. */
function fakePveTree(tree: Record<string, any[]>) {
  _impl.pveFetch = vi.fn(async (_conn: any, path: string) => {
    const fp = new URL(`http://x${path}`).searchParams.get('filepath')!
    const dir = Buffer.from(fp, 'base64').toString()
    if (!(dir in tree)) throw new Error(`no such dir ${dir}`)
    return tree[dir]
  }) as any
}

beforeEach(() => {
  _impl.pveFetch = vi.fn() as any
  _impl.pbsFetch = vi.fn() as any
})

describe('listSourceDirectory', () => {
  it('maps a PVE file-restore listing and drops unusable names', async () => {
    fakePveTree({
      '/drive-scsi0.img.fidx/part/1/etc': [
        { text: 'hosts', type: 'f', size: 220, mtime: 1700000000, leaf: 1 },
        { text: 'apt', type: 'd', leaf: 0 },
        { text: 'rc.local', type: 'l', leaf: 1 },
        { text: 'hard', type: 'h', leaf: 1 },
        { text: '..', type: 'd' },
        { text: 'a/b', type: 'f' },
      ],
    })
    const entries = await listSourceDirectory(pve, '/drive-scsi0.img.fidx/part/1/etc')
    expect(entries).toEqual([
      { path: '/drive-scsi0.img.fidx/part/1/etc/hosts', name: 'hosts', type: 'file', size: 220, mtime: new Date(1700000000 * 1000) },
      { path: '/drive-scsi0.img.fidx/part/1/etc/apt', name: 'apt', type: 'directory', size: 0, mtime: undefined },
      { path: '/drive-scsi0.img.fidx/part/1/etc/rc.local', name: 'rc.local', type: 'symlink', size: 0, mtime: undefined },
      { path: '/drive-scsi0.img.fidx/part/1/etc/hard', name: 'hard', type: 'other', size: 0, mtime: undefined },
    ])
    const path = (_impl.pveFetch as any).mock.calls[0][1] as string
    expect(path).toContain('/nodes/pve3/storage/pbs/file-restore/list?')
    expect(new URL(`http://x${path}`).searchParams.get('volume')).toBe('pbs:backup/vm/109/x')
  })

  it('asks the PBS catalog with the archive in the base64 filepath', async () => {
    _impl.pbsFetch = vi.fn(async () => [
      { filename: 'passwd', type: 'f', size: 10, leaf: true },
      { filename: 'ssl', type: 'd', leaf: false },
    ]) as any
    const entries = await listSourceDirectory(pbs, '/etc')
    expect(entries.map(e => [e.path, e.type])).toEqual([['/etc/passwd', 'file'], ['/etc/ssl', 'directory']])
    const path = (_impl.pbsFetch as any).mock.calls[0][1] as string
    const params = new URL(`http://x${path}`).searchParams
    expect(path.startsWith('/admin/datastore/ds/catalog?')).toBe(true)
    expect(params.get('filepath')).toBe(b64('/root.pxar.didx/etc'))
    expect(params.get('ns')).toBe('tenant-a')
    expect(params.get('backup-time')).toBe('1700000000')

    await listSourceDirectory(pbs, '/')
    const rootPath = (_impl.pbsFetch as any).mock.calls[1][1] as string
    expect(new URL(`http://x${rootPath}`).searchParams.get('filepath')).toBe(b64('/root.pxar.didx'))
  })
})

describe('walkSourceTree', () => {
  it('yields directories before their content, in name order, depth first', async () => {
    fakePveTree({
      '/x/root': [
        { text: 'b.txt', type: 'f', size: 2 },
        { text: 'sub', type: 'd' },
        { text: 'a.txt', type: 'f', size: 1 },
      ],
      '/x/root/sub': [
        { text: 'deep', type: 'd' },
        { text: 'c.txt', type: 'f', size: 3 },
      ],
      '/x/root/sub/deep': [{ text: 'd.txt', type: 'f', size: 4 }],
    })
    const seen: string[] = []
    let total = 0
    for await (const e of walkSourceTree(pve, '/x/root')) {
      seen.push(e.path)
      total += e.size
    }
    expect(seen).toEqual(['/x/root/a.txt', '/x/root/b.txt', '/x/root/sub', '/x/root/sub/c.txt', '/x/root/sub/deep', '/x/root/sub/deep/d.txt'])
    expect(total).toBe(10)
  })

  it('stops past maxEntries with a clear error', async () => {
    fakePveTree({ '/x': Array.from({ length: 5 }, (_, i) => ({ text: `f${i}`, type: 'f', size: 1 })) })
    const run = async () => {
      for await (const _e of walkSourceTree(pve, '/x', undefined, { maxEntries: 3 })) {
        // consume
      }
    }
    await expect(run()).rejects.toThrow('more than 3 entries')
  })

  it('stops when the signal aborts', async () => {
    fakePveTree({ '/x': [{ text: 'd', type: 'd' }], '/x/d': [] })
    const ac = new AbortController()
    const run = async () => {
      for await (const e of walkSourceTree(pve, '/x', ac.signal)) {
        if (e.type === 'directory') ac.abort()
      }
    }
    await expect(run()).rejects.toThrow('Cancelled')
  })
})
