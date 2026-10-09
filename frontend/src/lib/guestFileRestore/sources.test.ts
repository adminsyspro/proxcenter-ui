import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/connections/getConnection', () => ({ getPbsConnectionById: vi.fn(), getPbsConnectionByIdUnscoped: vi.fn() }))
vi.mock('@/lib/proxmox/client', () => ({ getInsecureAgent: () => undefined }))
vi.mock('@/lib/proxmox/fileRestoreTarget', () => ({ resolveFileRestoreTarget: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(), PERMISSIONS: {} }))
vi.mock('@/lib/vdc/scope', () => ({ assertVdcPbsAccess: vi.fn() }))

import { _impl, openSourceStream, sourceRequest, storageNodeBaseUrl, type ResolvedSource } from './sources'
import { SourceStallError } from './stream'

const b64 = (s: string) => Buffer.from(s).toString('base64')

function pveSource(nodeBaseUrl?: string): ResolvedSource {
  return {
    kind: 'pve',
    conn: { id: 'c1', baseUrl: 'https://pve1.lab:8006', apiToken: 'user@pam!t=secret' } as any,
    dispatcher: undefined,
    nodeName: 'pve3',
    storage: 'pbs',
    volumeId: 'pbs:backup/vm/109/x',
    nodeBaseUrl,
  }
}

const pbsSource: ResolvedSource = {
  kind: 'pbs',
  conn: { id: 'p1', baseUrl: 'https://pbs.lab:8007/', apiToken: 'u@pbs!t=s', insecureDev: false } as any,
  datastore: 'ds',
  namespace: '',
  backupType: 'ct',
  backupId: '200',
  backupTime: 1700000000,
  archive: 'root.pxar.didx',
}

beforeEach(() => {
  _impl.findNodeIp = vi.fn(async () => null)
  _impl.request = vi.fn() as any
})

describe('storageNodeBaseUrl', () => {
  it('builds the node address with the port of the connection', async () => {
    _impl.findNodeIp = vi.fn(async () => '10.42.0.103')
    expect(await storageNodeBaseUrl('c1', 'pve3', 'https://pve1.lab:8006/')).toBe('https://10.42.0.103:8006')
    _impl.findNodeIp = vi.fn(async () => 'fd00::3')
    expect(await storageNodeBaseUrl('c1', 'pve3', 'https://pve1.lab:8006')).toBe('https://[fd00::3]:8006')
  })

  it('is undefined when the connection already points at the node or the node is unknown', async () => {
    _impl.findNodeIp = vi.fn(async () => '10.42.0.101')
    expect(await storageNodeBaseUrl('c1', 'pve1', 'https://10.42.0.101:8006')).toBeUndefined()
    expect(await storageNodeBaseUrl('c1', 'pve1', 'https://PVE1:8006')).toBeUndefined()
    _impl.findNodeIp = vi.fn(async () => null)
    expect(await storageNodeBaseUrl('c1', 'pve3', 'https://pve1.lab:8006')).toBeUndefined()
    _impl.findNodeIp = vi.fn(async () => { throw new Error('db down') })
    expect(await storageNodeBaseUrl('c1', 'pve3', 'https://pve1.lab:8006')).toBeUndefined()
  })
})

describe('sourceRequest', () => {
  it('asks PVE for a tar even for a file, on the storage node when it has an address', () => {
    const req = sourceRequest(pveSource('https://10.42.0.103:8006'), { path: '/drive-scsi0.img.fidx/part/1/etc/hosts', directory: false })
    const url = new URL(req.url)
    expect(url.origin).toBe('https://10.42.0.103:8006')
    expect(url.pathname).toBe('/api2/json/nodes/pve3/storage/pbs/file-restore/download')
    expect(url.searchParams.get('tar')).toBe('1')
    expect(url.searchParams.get('filepath')).toBe(b64('/drive-scsi0.img.fidx/part/1/etc/hosts'))
    expect(req).toMatchObject({ tar: true, proxied: false })
    expect(req.headers.Authorization).toBe('PVEAPIToken=user@pam!t=secret')

    const via = sourceRequest(pveSource('https://10.42.0.103:8006'), { path: '/x', directory: true }, { viaConnection: true })
    expect(new URL(via.url).origin).toBe('https://pve1.lab:8006')
    expect(via.proxied).toBe(true)

    const noNode = sourceRequest(pveSource(), { path: '/x', directory: true })
    expect(new URL(noNode.url).origin).toBe('https://pve1.lab:8006')
    expect(noNode.proxied).toBe(false)
  })

  it('asks PBS for a tar only for a directory', () => {
    const dir = sourceRequest(pbsSource, { path: '/etc/apt', directory: true })
    const params = new URL(dir.url).searchParams
    expect(dir.tar).toBe(true)
    expect(params.get('tar')).toBe('1')
    expect(params.get('filepath')).toBe(b64('root.pxar.didx/etc/apt'))
    const file = sourceRequest(pbsSource, { path: '/etc/hosts', directory: false })
    expect(file.tar).toBe(false)
    expect(new URL(file.url).searchParams.get('tar')).toBeNull()
  })
})

describe('openSourceStream', () => {
  const okResponse = (chunks: Buffer[]) => ({ statusCode: 200, headers: {}, body: Readable.from(chunks) })

  it('streams the body through the watchdog and reports the bytes', async () => {
    _impl.request = vi.fn(async () => okResponse([Buffer.from('abc'), Buffer.from('de')])) as any
    const read: number[] = []
    const { body, tar } = await openSourceStream(pveSource(), { path: '/x/f', directory: false }, new AbortController().signal, { stallTimeoutMs: 1000, onBytes: n => read.push(n) })
    const chunks: Buffer[] = []
    for await (const c of body) chunks.push(c)
    expect(Buffer.concat(chunks).toString()).toBe('abcde')
    expect(read).toEqual([3, 2])
    expect(tar).toBe(true)
    const init = (_impl.request as any).mock.calls[0][1]
    expect(init).toMatchObject({ bodyTimeout: 0, headersTimeout: 0 })
  })

  it('fails a stalled download instead of hanging', async () => {
    const stalled = new Readable({ read() { /* never ends, never sends */ } })
    _impl.request = vi.fn(async () => ({ statusCode: 200, headers: {}, body: stalled })) as any
    const { body } = await openSourceStream(pveSource(), { path: '/x/f', directory: false }, new AbortController().signal, { stallTimeoutMs: 30 })
    const err = await new Promise<Error>(resolve => { body.on('error', resolve); body.resume() })
    expect(err).toBeInstanceOf(SourceStallError)
  })

  it('falls back to the connection node when the storage node is unreachable, once per source', async () => {
    const src = pveSource('https://10.42.0.103:8006')
    _impl.request = vi.fn(async (url: string) => {
      if (url.startsWith('https://10.42.0.103')) throw new Error('connect ECONNREFUSED 10.42.0.103:8006')
      return okResponse([Buffer.from('ok')])
    }) as any
    const log = vi.fn()
    const first = await openSourceStream(src, { path: '/x/a', directory: false }, new AbortController().signal, { stallTimeoutMs: 1000, log })
    first.body.resume()
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Storage node pve3 not reachable at https://10.42.0.103:8006'))
    expect((_impl.request as any).mock.calls.map((c: any[]) => new URL(c[0]).origin)).toEqual(['https://10.42.0.103:8006', 'https://pve1.lab:8006'])

    const second = await openSourceStream(src, { path: '/x/b', directory: false }, new AbortController().signal, { stallTimeoutMs: 1000, log })
    second.body.resume()
    expect((_impl.request as any).mock.calls).toHaveLength(3)
    expect(new URL((_impl.request as any).mock.calls[2][0]).origin).toBe('https://pve1.lab:8006')
    expect(log).toHaveBeenCalledTimes(1)
  })

  it('reports the Proxmox error message of a refused download', async () => {
    _impl.request = vi.fn(async () => ({ statusCode: 400, headers: {}, body: { text: async () => JSON.stringify({ message: 'no such file' }) } })) as any
    await expect(openSourceStream(pveSource(), { path: '/x/f', directory: false }, new AbortController().signal, { stallTimeoutMs: 1000 })).rejects.toThrow('Download failed (no such file)')
  })
})
