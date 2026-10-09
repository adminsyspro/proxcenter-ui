import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findFirstMock } = vi.hoisted(() => ({ findFirstMock: vi.fn() }))

vi.mock('@/lib/db/prisma', () => ({ prisma: { managedHost: { findFirst: (...a: any[]) => findFirstMock(...a) } } }))
vi.mock('@/lib/connections/getConnection', () => ({ getPbsConnectionById: vi.fn(), getPbsConnectionByIdUnscoped: vi.fn() }))
vi.mock('@/lib/proxmox/client', () => ({ getInsecureAgent: () => 'insecure-agent' }))
vi.mock('@/lib/proxmox/fileRestoreTarget', () => ({ resolveFileRestoreTarget: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ checkPermission: vi.fn(), PERMISSIONS: {} }))
vi.mock('@/lib/vdc/scope', () => ({ assertVdcPbsAccess: vi.fn() }))

import { NextResponse } from 'next/server'

import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from '@/lib/connections/getConnection'
import { resolveFileRestoreTarget } from '@/lib/proxmox/fileRestoreTarget'
import { checkPermission } from '@/lib/rbac'
import { assertVdcPbsAccess } from '@/lib/vdc/scope'

import { _impl, openSourceStream, resolveGuestRestoreSource, sourceLabel, sourceRequest, storageNodeBaseUrl, type ResolvedSource } from './sources'
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

const realFindNodeIp = _impl.findNodeIp

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

describe('sourceLabel', () => {
  it('labels PVE and PBS sources, with and without a namespace', () => {
    expect(sourceLabel({ kind: 'pve', connId: 'c1', storage: 'pbs', volume: 'backup/vm/1/t' } as any)).toBe('pbs:backup/vm/1/t')
    const pbs = { kind: 'pbs', pbsId: 'p1', datastore: 'ds', backupType: 'vm', backupId: '100', backupTime: 5, archive: 'drive.img.fidx' } as any
    expect(sourceLabel(pbs)).toBe('ds:vm/100/5 (drive.img.fidx)')
    expect(sourceLabel({ ...pbs, namespace: 'team' })).toBe('ds:team/vm/100/5 (drive.img.fidx)')
  })
})

describe('_impl.findNodeIp', () => {
  it('reads the enabled managed host address of the node', async () => {
    findFirstMock.mockResolvedValueOnce({ ip: '10.0.0.3' }).mockResolvedValueOnce(null)
    expect(await realFindNodeIp('c1', 'pve3')).toBe('10.0.0.3')
    expect(findFirstMock.mock.calls[0][0].where).toEqual({ connectionId: 'c1', node: 'pve3', enabled: true, ip: { not: null } })
    expect(await realFindNodeIp('c1', 'pve4')).toBeNull()
  })
})

describe('storageNodeBaseUrl with a malformed connection URL', () => {
  it('is undefined', async () => {
    _impl.findNodeIp = vi.fn(async () => '10.0.0.3')
    expect(await storageNodeBaseUrl('c1', 'pve3', 'not a url')).toBeUndefined()
  })
})

describe('resolveGuestRestoreSource', () => {
  const pveIn = { kind: 'pve', connId: 'c1', storage: 'pbs', volume: 'backup/vm/1/t' } as any
  const pbsIn = { kind: 'pbs', pbsId: 'p1', datastore: 'ds', namespace: 'team', backupType: 'vm', backupId: '100', backupTime: 5, archive: 'a.pxar.didx' } as any
  const forbidden = () => NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  beforeEach(() => {
    vi.mocked(checkPermission).mockReset().mockResolvedValue(null as any)
    vi.mocked(resolveFileRestoreTarget).mockReset()
    vi.mocked(assertVdcPbsAccess).mockReset().mockResolvedValue({ kind: 'admin' })
    vi.mocked(getPbsConnectionById).mockReset().mockResolvedValue({ id: 'p1', scoped: true } as any)
    vi.mocked(getPbsConnectionByIdUnscoped).mockReset().mockResolvedValue({ id: 'p1', scoped: false } as any)
  })

  it('resolves a PVE source with the storage node address', async () => {
    _impl.findNodeIp = vi.fn(async () => '10.0.0.3')
    vi.mocked(resolveFileRestoreTarget).mockResolvedValue({ conn: { baseUrl: 'https://pve1:8006' }, dispatcher: undefined, nodeName: 'pve3', volumeId: 'pbs:backup/vm/1/t' } as any)
    expect(await resolveGuestRestoreSource(pveIn)).toMatchObject({ kind: 'pve', nodeName: 'pve3', storage: 'pbs', volumeId: 'pbs:backup/vm/1/t', nodeBaseUrl: 'https://10.0.0.3:8006' })
    expect(checkPermission).toHaveBeenCalledWith(undefined, 'connection', 'c1')
  })

  it('returns the PVE RBAC denial or the target lookup response', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce(forbidden() as any)
    expect(((await resolveGuestRestoreSource(pveIn)) as Response).status).toBe(403)
    vi.mocked(resolveFileRestoreTarget).mockResolvedValue(NextResponse.json({}, { status: 404 }) as any)
    expect(((await resolveGuestRestoreSource(pveIn)) as Response).status).toBe(404)
  })

  it('resolves a PBS source for an admin through the scoped lookup', async () => {
    const r = await resolveGuestRestoreSource(pbsIn)
    expect(r).toMatchObject({ kind: 'pbs', conn: { scoped: true }, datastore: 'ds', namespace: 'team', backupId: '100', archive: 'a.pxar.didx' })
  })

  it('resolves a PBS source for a tenant bound to the namespace through the unscoped lookup', async () => {
    vi.mocked(assertVdcPbsAccess).mockResolvedValue({ kind: 'tenant', allowed: [{ datastore: 'ds', namespace: 'team' }] })
    expect(await resolveGuestRestoreSource(pbsIn)).toMatchObject({ conn: { scoped: false } })
  })

  it('refuses a tenant another namespace, defaulting a missing namespace to the root', async () => {
    vi.mocked(assertVdcPbsAccess).mockResolvedValue({ kind: 'tenant', allowed: [{ datastore: 'ds', namespace: 'team' }] })
    const r = (await resolveGuestRestoreSource({ ...pbsIn, namespace: undefined })) as Response
    expect(r.status).toBe(403)
  })

  it('returns the PBS RBAC and vDC denials', async () => {
    vi.mocked(checkPermission).mockResolvedValueOnce(forbidden() as any)
    expect(((await resolveGuestRestoreSource(pbsIn)) as Response).status).toBe(403)
    vi.mocked(assertVdcPbsAccess).mockResolvedValue(forbidden())
    expect(((await resolveGuestRestoreSource(pbsIn)) as Response).status).toBe(403)
  })
})

describe('sourceRequest PBS options', () => {
  it('sends the namespace and the insecure agent', () => {
    const req = sourceRequest({ ...pbsSource, namespace: 'team', conn: { ...(pbsSource as any).conn, insecureDev: true } } as ResolvedSource, { path: 'etc//hosts', directory: false })
    const params = new URL(req.url).searchParams
    expect(params.get('ns')).toBe('team')
    expect(params.get('filepath')).toBe(b64('root.pxar.didx/etc/hosts'))
    expect(req.dispatcher).toBe('insecure-agent')
    expect(req.headers.Authorization).toBe('PBSAPIToken=u@pbs!t=s')
  })
})

describe('openSourceStream failures', () => {
  const opts = { stallTimeoutMs: 1000 }
  const refused = (statusCode: number, text: string | Error) => ({
    statusCode,
    headers: {},
    body: { text: async () => { if (text instanceof Error) throw text; return text } },
  })
  const open = (src: ResolvedSource = pveSource(), signal = new AbortController().signal) =>
    openSourceStream(src, { path: '/x/f', directory: false }, signal, opts)

  it.each([
    [JSON.stringify({ errors: { volume: 'bad volume' } }), 'Download failed (bad volume)'],
    [JSON.stringify({ errors: { filepath: 'bad path' } }), 'Download failed (bad path)'],
    [JSON.stringify({ error: 'nope' }), 'Download failed (nope)'],
    [JSON.stringify({ error: { code: 1 } }), 'Download failed (HTTP 500)'],
    ['  upstream timeout  ', 'Download failed (HTTP 500: upstream timeout)'],
    ['', 'Download failed (HTTP 500)'],
  ])('maps the refused body %j', async (text, message) => {
    _impl.request = vi.fn(async () => refused(500, text)) as any
    await expect(open()).rejects.toThrow(message)
  })

  it('reports the status alone when the error body cannot be read, and refuses a 1xx/3xx answer', async () => {
    _impl.request = vi.fn(async () => refused(502, new Error('socket'))) as any
    await expect(open()).rejects.toThrow('Download failed (HTTP 502)')
    _impl.request = vi.fn(async () => refused(304, '')) as any
    await expect(open()).rejects.toThrow('Download failed (HTTP 304)')
  })

  it('rethrows a request error without a storage node to fall back from', async () => {
    _impl.request = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as any
    await expect(open()).rejects.toThrow('ECONNREFUSED')
    await expect(open(pbsSource)).rejects.toThrow('ECONNREFUSED')
    expect(_impl.request).toHaveBeenCalledTimes(2)
  })

  it('rethrows when the job was cancelled instead of retrying through the connection', async () => {
    const ac = new AbortController()
    ac.abort()
    _impl.request = vi.fn(async () => { throw new Error('aborted') }) as any
    await expect(open(pveSource('https://10.0.0.3:8006'), ac.signal)).rejects.toThrow('aborted')
    expect(_impl.request).toHaveBeenCalledTimes(1)
  })

  it('logs a non-Error failure of the storage node', async () => {
    _impl.request = vi.fn()
      .mockRejectedValueOnce('refused')
      .mockResolvedValueOnce({ statusCode: 200, headers: {}, body: Readable.from([Buffer.from('ok')]) }) as any
    const log = vi.fn()
    const { body } = await openSourceStream(pveSource('https://10.0.0.3:8006'), { path: '/x', directory: false }, new AbortController().signal, { ...opts, log })
    body.resume()
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('(refused)'))
  })

  it('forwards a socket error and closes the socket when the consumer tears down', async () => {
    const raw = new Readable({ read() {} })
    _impl.request = vi.fn(async () => ({ statusCode: 200, headers: {}, body: raw })) as any
    const { body } = await open()
    const err = new Promise<Error>(resolve => body.on('error', resolve))
    raw.emit('error', new Error('reset'))
    expect((await err).message).toBe('reset')

    const raw2 = new Readable({ read() {} })
    _impl.request = vi.fn(async () => ({ statusCode: 200, headers: {}, body: raw2 })) as any
    const second = await open()
    const closed = new Promise<void>(resolve => raw2.on('close', resolve))
    second.body.destroy()
    await closed
    expect(raw2.destroyed).toBe(true)
  })
})
