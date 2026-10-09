import { randomBytes } from 'node:crypto'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { updateMock, findUniqueMock, auditMock } = vi.hoisted(() => ({
  updateMock: vi.fn(async (args: any) => args),
  findUniqueMock: vi.fn(async () => ({ createdById: 'u1', createdByEmail: 'alice@example.org', guestName: 'web-01' })),
  auditMock: vi.fn(async (_entry: any) => 'audit-id'),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: { guestFileRestoreJob: { update: updateMock, findUnique: findUniqueMock } } }))
vi.mock('@/lib/audit', () => ({ audit: auditMock }))
vi.mock('./writers/agent', () => ({ AgentWriter: { create: vi.fn() } }))
vi.mock('./writers/ssh', () => ({ SshWriter: { connect: vi.fn() } }))

import { buildTarZst, readAll, streamOf } from './fixtures.test-helpers'
import { resetRegistry } from './registry'
import { _impl, cancelGuestFileRestoreJob, runGuestFileRestoreJob, type RunContext } from './runner'
import { DEFAULT_GUEST_FILE_RESTORE_SETTINGS } from './settings'
import { _impl as spoolImpl } from './spool'
import type { GuestOs, GuestRestoreItem } from './types'
import type { SourceTreeEntry } from './walk'
import { GuestWriterError, type GuestWriter, type WriteMeta } from './writers/writer'

class FakeWriter implements GuestWriter {
  readonly description = 'fake writer'
  readonly files = new Map<string, Buffer>()
  readonly metas = new Map<string, WriteMeta>()
  readonly dirs = new Set<string>()
  readonly symlinks = new Map<string, string>()
  closed = false
  failOn: ((path: string) => Error | null) | null = null
  onWrite: ((path: string) => Promise<void> | void) | null = null

  pipelineDepth = 1

  constructor(readonly os: GuestOs = 'linux') {}

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path) || this.symlinks.has(path)
  }
  async mkdirp(path: string): Promise<void> {
    this.dirs.add(path)
  }
  async writeFile(path: string, body: Readable, meta: WriteMeta, onBytes: (n: number) => void, signal: AbortSignal): Promise<void> {
    const err = this.failOn?.(path)
    if (err) throw err
    await this.onWrite?.(path)
    if (signal.aborted) throw new GuestWriterError('Cancelled', true)
    const chunks: Buffer[] = []
    for await (const c of body) {
      chunks.push(c)
      onBytes(c.length)
    }
    this.files.set(path, Buffer.concat(chunks))
    this.metas.set(path, meta)
  }
  readonly setMetas = new Map<string, WriteMeta>()
  async setMeta(path: string, meta: WriteMeta): Promise<void> {
    this.setMetas.set(path, meta)
  }
  readonly symlinkMetas = new Map<string, unknown>()
  async symlink(path: string, target: string, meta?: unknown): Promise<void> {
    this.symlinkMetas.set(path, meta)
    this.symlinks.set(path, target)
  }
  owners = new Map<string, { uid: number; gid: number }>()
  async ownerOf(path: string): Promise<{ uid: number; gid: number } | null> {
    return this.owners.get(path) ?? null
  }
  async close(): Promise<void> {
    this.closed = true
  }
}

const source = { kind: 'pve', conn: { id: 'c1' }, dispatcher: undefined, nodeName: 'pve1', storage: 'pbs', volumeId: 'pbs:backup/vm/100/x' } as any
const sourceSpec = { kind: 'pve' as const, connId: 'c1', storage: 'pbs', volume: 'backup/vm/100/x' }

function context(over: Partial<RunContext> = {}): RunContext {
  return {
    source,
    sourceSpec,
    target: { conn: { id: 'c1' } as any, node: 'pve1', vmid: 100, type: 'qemu' },
    items: [],
    // The streamed, tar-per-item flow is the SSH one; agent cases set the method.
    method: 'ssh',
    destination: { mode: 'original' },
    conflict: 'keep',
    settings: { ...DEFAULT_GUEST_FILE_RESTORE_SETTINGS },
    ...over,
  }
}

/**
 * Serve items from an in-memory map: a Buffer is raw for a file and tar.zst
 * for a directory; `{ tar, buf }` says so explicitly (a file asked as tar).
 */
const served = new Map<string, { body: Readable; consumed: number; size: number }>()

function serve(contents: Record<string, Buffer | { tar: boolean; buf: Buffer }>) {
  served.clear()
  _impl.openSourceStream = async (_src: any, item: Pick<GuestRestoreItem, 'path' | 'directory'>, _signal: AbortSignal, opts: any) => {
    const found = contents[item.path]
    if (!found) throw new Error(`no such item ${item.path}`)
    const { tar, buf } = Buffer.isBuffer(found) ? { tar: item.directory, buf: found } : found
    const body = streamOf(buf, 700)
    const record = { body, consumed: 0, size: buf.length }
    served.set(item.path, record)
    body.on('data', (c: Buffer) => { record.consumed += c.length; opts?.onBytes?.(c.length) })
    return { body, tar }
  }
}

/** Fake tree walk: entries per directory path, in the order the walk yields them. */
function walk(trees: Record<string, SourceTreeEntry[]>) {
  _impl.walkSourceTree = async function* (_src: any, dir: string) {
    const entries = trees[dir]
    if (!entries) throw new Error(`cannot list ${dir}`)
    yield* entries
  }
}

function fakeFree(bytes: number) {
  vi.spyOn(spoolImpl, 'statfs').mockResolvedValue({ bavail: BigInt(Math.floor(bytes / 4096)), bsize: BigInt(4096) } as any)
}

function lastUpdate() {
  return updateMock.mock.calls.at(-1)![0].data
}

let writer: FakeWriter
let spoolDir: string

beforeEach(async () => {
  resetRegistry()
  updateMock.mockClear()
  findUniqueMock.mockClear()
  auditMock.mockClear()
  writer = new FakeWriter()
  _impl.createWriter = async () => writer
  _impl.now = () => Date.now()
  _impl.walkSourceTree = async function* () { throw new Error('walk not expected') }
  spoolDir = join(await mkdtemp(join(tmpdir(), 'pxc-runner-test-')), 'spool')
})

afterEach(async () => {
  vi.restoreAllMocks()
  await rm(join(spoolDir, '..'), { recursive: true, force: true })
})

/** Settings pointing the spool at the test folder. */
function settingsWithSpool(over: Partial<typeof DEFAULT_GUEST_FILE_RESTORE_SETTINGS> = {}) {
  return { ...DEFAULT_GUEST_FILE_RESTORE_SETTINGS, spoolDir, spoolMinFreeBytes: 1024, ...over }
}

describe('runGuestFileRestoreJob', () => {
  it('restores a file and a directory to their original location and completes', async () => {
    const dir = await buildTarZst([
      { name: 'apt', type: 'directory', mode: 0o755 },
      { name: 'apt/sources.list', content: 'deb main\n', mode: 0o644, uid: 0, gid: 0, mtime: new Date(1_700_000_000_000) },
      { name: 'apt/link', type: 'symlink', linkname: 'sources.list' },
    ])
    serve({ '/drive-scsi0.img.fidx/part/1/etc/hosts': Buffer.from('127.0.0.1 localhost\n'), '/drive-scsi0.img.fidx/part/1/etc/apt': dir })

    await runGuestFileRestoreJob('job1', context({
      items: [
        { path: '/drive-scsi0.img.fidx/part/1/etc/hosts', directory: false, size: 20 },
        { path: '/drive-scsi0.img.fidx/part/1/etc/apt', directory: true },
      ],
    }))

    expect([...writer.files.keys()]).toEqual(['/etc/hosts', '/etc/apt/sources.list'])
    expect(writer.files.get('/etc/apt/sources.list')?.toString()).toBe('deb main\n')
    expect(writer.metas.get('/etc/apt/sources.list')).toMatchObject({ mode: 0o644, uid: 0, gid: 0 })
    expect(writer.dirs.has('/etc/apt')).toBe(true)
    expect(writer.symlinks.get('/etc/apt/link')).toBe('sources.list')
    expect(writer.closed).toBe(true)

    const final = lastUpdate()
    expect(final).toMatchObject({ status: 'completed', guestOs: 'linux', filesDone: 3, filesSkipped: 0, filesFailed: 0, error: null, currentPath: null })
    expect(final.bytesDone).toBe(BigInt(29))
    expect(final.completedAt).toBeInstanceOf(Date)
    expect(updateMock.mock.calls[0][0].data).toMatchObject({ status: 'running' })

    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      action: 'restore',
      category: 'backups',
      resourceId: 'job1',
      resourceName: 'web-01',
      status: 'success',
      userId: 'u1',
      userEmail: 'alice@example.org',
      details: { operation: 'restore_files_to_guest', phase: 'end', status: 'completed', filesDone: 3 },
    })
  })

  it('writes to the custom folder with the per-OS default on windows', async () => {
    writer = new FakeWriter('windows')
    serve({ '/root.pxar.didx/etc/hosts': Buffer.from('x') })
    await runGuestFileRestoreJob('job2', context({ items: [{ path: '/root.pxar.didx/etc/hosts', directory: false }], destination: { mode: 'custom' } }))
    expect([...writer.files.keys()]).toEqual(['C:\\ProxCenter-Restore\\hosts'])
    expect(writer.dirs.has('C:\\ProxCenter-Restore')).toBe(true)
    expect(lastUpdate()).toMatchObject({ status: 'completed', guestOs: 'windows' })
  })

  it('counts a file shorter than announced as failed, never as restored', async () => {
    // Lab, 2026-10-09: a download cut mid-file used to end the entry early and
    // the short file was reported as restored.
    serve({ '/root.pxar.didx/etc/hosts': Buffer.from('short') })
    await runGuestFileRestoreJob('job-trunc', context({ items: [{ path: '/root.pxar.didx/etc/hosts', directory: false, size: 50 }] }))
    expect(lastUpdate()).toMatchObject({ status: 'completed_with_errors', filesDone: 0, filesFailed: 1 })
    expect(lastUpdate().log.some((l: any) => l.msg.includes('Truncated: 5 of 50 bytes'))).toBe(true)
  })

  it('gives a created directory its backed-up mode and owner, leaves an existing one alone', async () => {
    writer.dirs.add('/srv/data')
    const dir = await buildTarZst([
      { name: 'data', type: 'directory', mode: 0o700, uid: 33, gid: 33 },
      { name: 'data/sub', type: 'directory', mode: 0o775, uid: 1000, gid: 1000 },
      { name: 'data/sub/f', content: 'x' },
    ])
    serve({ '/root.pxar.didx/srv/data': dir })
    await runGuestFileRestoreJob('job-dirs', context({ items: [{ path: '/root.pxar.didx/srv/data', directory: true }] }))
    expect(writer.setMetas.has('/srv/data')).toBe(false)
    expect(writer.setMetas.get('/srv/data/sub')).toMatchObject({ mode: 0o775, uid: 1000, gid: 1000 })
    expect(writer.setMetas.get('/srv/data/sub')?.mtime).toBeUndefined()
  })

  it('leaves an existing symlink unless the policy is overwrite, and passes the link owner', async () => {
    const dir = async () => buildTarZst([
      { name: 'd', type: 'directory' },
      { name: 'd/l', type: 'symlink', linkname: 'new-target', uid: 1000, gid: 1000 },
    ])
    writer.dirs.add('/srv/d')
    writer.symlinks.set('/srv/d/l', 'old-target')
    serve({ '/root.pxar.didx/srv/d': await dir() })
    await runGuestFileRestoreJob('job-l1', context({ items: [{ path: '/root.pxar.didx/srv/d', directory: true }], conflict: 'keep' }))
    expect(writer.symlinks.get('/srv/d/l')).toBe('old-target')
    expect(lastUpdate()).toMatchObject({ filesSkipped: 1, filesDone: 0 })

    serve({ '/root.pxar.didx/srv/d': await dir() })
    await runGuestFileRestoreJob('job-l2', context({ items: [{ path: '/root.pxar.didx/srv/d', directory: true }], conflict: 'overwrite' }))
    expect(writer.symlinks.get('/srv/d/l')).toBe('new-target')
    expect(writer.symlinkMetas.get('/srv/d/l')).toMatchObject({ uid: 1000, gid: 1000 })
  })

  it('keeps both copies with the prefix when the target exists', async () => {
    writer.files.set('/etc/hosts', Buffer.from('old'))
    writer.files.set('/etc/RESTORED-hosts', Buffer.from('older restore'))
    serve({ '/root.pxar.didx/etc/hosts': Buffer.from('new') })
    await runGuestFileRestoreJob('job3', context({ items: [{ path: '/root.pxar.didx/etc/hosts', directory: false }], conflict: 'keep' }))
    expect(writer.files.get('/etc/hosts')?.toString()).toBe('old')
    expect(writer.files.get('/etc/RESTORED-hosts-1')?.toString()).toBe('new')
    expect(lastUpdate().log.some((l: any) => l.msg.includes('restored as /etc/RESTORED-hosts-1'))).toBe(true)
  })

  it('skips an existing target with the skip policy and overwrites with overwrite', async () => {
    writer.files.set('/etc/hosts', Buffer.from('old'))
    serve({ '/root.pxar.didx/etc/hosts': Buffer.from('new') })
    const items = [{ path: '/root.pxar.didx/etc/hosts', directory: false }]

    await runGuestFileRestoreJob('job4', context({ items, conflict: 'skip' }))
    expect(writer.files.get('/etc/hosts')?.toString()).toBe('old')
    expect(lastUpdate()).toMatchObject({ status: 'completed', filesDone: 0, filesSkipped: 1 })

    await runGuestFileRestoreJob('job5', context({ items, conflict: 'overwrite' }))
    expect(writer.files.get('/etc/hosts')?.toString()).toBe('new')
    expect(lastUpdate()).toMatchObject({ status: 'completed', filesDone: 1, filesSkipped: 0 })
  })

  it('counts a per-file failure and finishes with errors', async () => {
    writer.failOn = path => (path === '/etc/b' ? new Error('EACCES') : null)
    const dir = await buildTarZst([{ name: 'etc/a', content: 'a' }, { name: 'etc/b', content: 'b' }, { name: 'etc/c', content: 'c' }])
    serve({ '/root.pxar.didx/etc': dir })
    await runGuestFileRestoreJob('job6', context({ items: [{ path: '/root.pxar.didx/etc', directory: true }] }))
    expect([...writer.files.keys()]).toEqual(['/etc/a', '/etc/c'])
    const final = lastUpdate()
    expect(final).toMatchObject({ status: 'completed_with_errors', filesDone: 2, filesFailed: 1, error: null })
    expect(final.log.some((l: any) => l.level === 'error' && l.msg.includes('etc/b: EACCES'))).toBe(true)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ status: 'warning' })
  })

  it('fails the job on a fatal writer error and records the message', async () => {
    writer.failOn = () => new GuestWriterError('Agent transfer limit reached: use the SSH method', true)
    serve({ '/root.pxar.didx/etc/hosts': Buffer.from('x') })
    await runGuestFileRestoreJob('job7', context({ items: [{ path: '/root.pxar.didx/etc/hosts', directory: false }] }))
    expect(lastUpdate()).toMatchObject({ status: 'failed', error: 'Agent transfer limit reached: use the SSH method' })
    expect(writer.closed).toBe(true)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ status: 'failure', errorMessage: 'Agent transfer limit reached: use the SSH method' })
  })

  it('fails when the writer cannot connect', async () => {
    _impl.createWriter = async () => { throw new GuestWriterError('SSH connection failed: ECONNREFUSED', true) }
    await runGuestFileRestoreJob('job8', context({ items: [{ path: '/root.pxar.didx/etc/hosts', directory: false }], method: 'ssh' }))
    expect(lastUpdate()).toMatchObject({ status: 'failed', error: 'SSH connection failed: ECONNREFUSED' })
  })

  it('counts an item whose download fails and continues with the next one', async () => {
    serve({ '/root.pxar.didx/etc/b': Buffer.from('b') })
    await runGuestFileRestoreJob('job9', context({
      items: [{ path: '/root.pxar.didx/etc/a', directory: false }, { path: '/root.pxar.didx/etc/b', directory: false }],
    }))
    expect([...writer.files.keys()]).toEqual(['/etc/b'])
    expect(lastUpdate()).toMatchObject({ status: 'completed_with_errors', filesDone: 1, filesFailed: 1 })
  })

  it('ends as cancelled when the operator aborts while the source is stalled', async () => {
    // Lab, 2026-10-09: a download that stopped sending without closing kept
    // the job "running" and the cancel button had no effect.
    _impl.openSourceStream = async () => ({ body: new PassThrough(), tar: true })
    const run = runGuestFileRestoreJob('job-stall', context({ items: [{ path: '/root.pxar.didx/etc', directory: true }] }))
    await new Promise(r => setTimeout(r, 50))
    expect(cancelGuestFileRestoreJob('job-stall')).toBe(true)
    await run
    expect(lastUpdate()).toMatchObject({ status: 'cancelled' })
  })

  it('ends as cancelled when the operator aborts during a write', async () => {
    writer.onWrite = async () => { cancelGuestFileRestoreJob('job10') }
    serve({ '/root.pxar.didx/etc/a': Buffer.from('a'), '/root.pxar.didx/etc/b': Buffer.from('b') })
    await runGuestFileRestoreJob('job10', context({
      items: [{ path: '/root.pxar.didx/etc/a', directory: false }, { path: '/root.pxar.didx/etc/b', directory: false }],
    }))
    expect(writer.files.size).toBe(0)
    expect(lastUpdate()).toMatchObject({ status: 'cancelled', error: null })
    expect(cancelGuestFileRestoreJob('job10')).toBe(false)
  })

  it('queues beyond maxConcurrentJobs and starts when a slot frees', async () => {
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const first = new FakeWriter()
    first.onWrite = () => gate
    const second = new FakeWriter()
    const writers = [first, second]
    _impl.createWriter = async () => writers.shift()!
    serve({ '/root.pxar.didx/etc/a': Buffer.from('a') })
    const items = [{ path: '/root.pxar.didx/etc/a', directory: false }]
    const settings = { ...DEFAULT_GUEST_FILE_RESTORE_SETTINGS, maxConcurrentJobs: 1 }

    const p1 = runGuestFileRestoreJob('job11', context({ items, settings }))
    const p2 = runGuestFileRestoreJob('job12', context({ items, settings }))
    await new Promise(r => setTimeout(r, 20))
    expect(updateMock.mock.calls.filter(c => c[0].where.id === 'job12')).toHaveLength(0)
    release()
    await Promise.all([p1, p2])
    expect(first.files.size).toBe(1)
    expect(second.files.size).toBe(1)
  })

  it('never writes credentials to the row or the audit', async () => {
    serve({ '/root.pxar.didx/etc/a': Buffer.from('a') })
    await runGuestFileRestoreJob('job13', context({
      items: [{ path: '/root.pxar.didx/etc/a', directory: false }],
      method: 'ssh',
      ssh: { host: '10.0.0.5', username: 'root', password: 'hunter2', privateKey: 'PRIVATE-KEY-MATERIAL' },
    }))
    const everything = JSON.stringify([updateMock.mock.calls, auditMock.mock.calls], (_k, v) => (typeof v === 'bigint' ? Number(v) : v))
    expect(everything).not.toContain('hunter2')
    expect(everything).not.toContain('PRIVATE-KEY-MATERIAL')
  })

  it('keeps several files in flight when the writer allows it (SSH pipelining)', async () => {
    writer.pipelineDepth = 4
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const started: string[] = []
    writer.onWrite = async path => {
      started.push(path)
      if (path === '/etc/a') await gate
    }
    const dir = await buildTarZst([{ name: 'etc/a', content: 'a' }, { name: 'etc/b', content: 'b' }, { name: 'etc/c', content: 'c' }])
    serve({ '/root.pxar.didx/etc': dir })
    const run = runGuestFileRestoreJob('job-pipe', context({ items: [{ path: '/root.pxar.didx/etc', directory: true }] }))
    await new Promise(r => setTimeout(r, 50))
    // b and c started while a is still being written.
    expect(started).toEqual(['/etc/a', '/etc/b', '/etc/c'])
    expect(writer.files.has('/etc/a')).toBe(false)
    release()
    await run
    expect([...writer.files.keys()].sort()).toEqual(['/etc/a', '/etc/b', '/etc/c'])
    expect(lastUpdate()).toMatchObject({ status: 'completed', filesDone: 3 })
  })

  it('stops the job on a fatal error of a pipelined write', async () => {
    writer.pipelineDepth = 4
    writer.failOn = path => (path === '/etc/a' ? new GuestWriterError('SSH connection closed', true) : null)
    const dir = await buildTarZst([{ name: 'etc/a', content: 'a' }, { name: 'etc/b', content: 'b' }])
    serve({ '/root.pxar.didx/etc': dir })
    await runGuestFileRestoreJob('job-pipe-fatal', context({ items: [{ path: '/root.pxar.didx/etc', directory: true }] }))
    expect(lastUpdate()).toMatchObject({ status: 'failed', error: 'SSH connection closed' })
  })

  it('never touches the spool folder over SSH', async () => {
    const statfs = vi.spyOn(spoolImpl, 'statfs')
    const mkdir = vi.spyOn(spoolImpl, 'mkdir')
    const dir = await buildTarZst([{ name: 'etc/a', content: 'a'.repeat(5000) }])
    serve({ '/root.pxar.didx/etc': dir, '/root.pxar.didx/big': Buffer.alloc(20000, 1) })
    await runGuestFileRestoreJob('job-ssh-nospool', context({
      items: [{ path: '/root.pxar.didx/etc', directory: true }, { path: '/root.pxar.didx/big', directory: false, size: 20000 }],
      settings: settingsWithSpool(),
    }))
    expect(lastUpdate()).toMatchObject({ status: 'completed', filesDone: 2 })
    expect(lastUpdate().bytesRead).toBeGreaterThan(BigInt(20000))
    expect(statfs).not.toHaveBeenCalled()
    expect(mkdir).not.toHaveBeenCalled()
    await expect(readdir(spoolDir)).rejects.toThrow()
  })

  describe('guest agent (staged)', () => {
    const tree = '/drive-scsi0.img.fidx/part/1/data'
    const entries: SourceTreeEntry[] = [
      { path: `${tree}/sub`, name: 'sub', type: 'directory', size: 0 },
      { path: `${tree}/sub/one.txt`, name: 'one.txt', type: 'file', size: 3 },
      { path: `${tree}/two.bin`, name: 'two.bin', type: 'file', size: 6000 },
      { path: `${tree}/link`, name: 'link', type: 'symlink', size: 0 },
      { path: `${tree}/pipe`, name: 'pipe', type: 'other', size: 0 },
    ]

    /** Directory tars start with the directory's own entry, then a large incompressible file. */
    async function dirTar(name: string, mode: number) {
      return buildTarZst([
        { name, type: 'directory', mode, uid: 1000, gid: 1000, mtime: new Date(1_700_000_000_000) },
        { name: `${name}/payload.bin`, content: randomBytes(300_000) },
      ])
    }

    async function serveLeaves() {
      serve({
        [tree]: { tar: true, buf: await dirTar('data', 0o775) },
        [`${tree}/sub`]: { tar: true, buf: await dirTar('sub', 0o700) },
        [`${tree}/sub/one.txt`]: { tar: true, buf: await buildTarZst([{ name: 'one.txt', content: 'one', mode: 0o600, uid: 1000, gid: 1000 }]) },
        [`${tree}/two.bin`]: { tar: true, buf: await buildTarZst([{ name: 'two.bin', content: Buffer.alloc(6000, 2), mode: 0o644 }]) },
        [`${tree}/link`]: { tar: true, buf: await buildTarZst([{ name: 'link', type: 'symlink', linkname: 'two.bin' }]) },
        '/drive-scsi0.img.fidx/part/1/alone.txt': { tar: true, buf: await buildTarZst([{ name: 'alone.txt', content: 'alone' }]) },
      })
    }

    it('walks the tree first, then stages one file at a time with its tar metadata', async () => {
      fakeFree(100 * 1024 * 1024)
      walk({ [tree]: entries })
      await serveLeaves()
      const seen: number[] = []
      writer.onWrite = async () => { seen.push((await readdir(spoolDir)).length) }
      await runGuestFileRestoreJob('job-agent', context({
        method: 'agent',
        items: [{ path: tree, directory: true }, { path: '/drive-scsi0.img.fidx/part/1/alone.txt', directory: false, size: 5 }],
        settings: settingsWithSpool(),
      }))
      const final = lastUpdate()
      expect(final).toMatchObject({ status: 'completed', filesDone: 4, filesSkipped: 1, filesFailed: 0 })
      expect(final.bytesTotal).toBe(BigInt(6008))
      expect(final.bytesDone).toBe(BigInt(6008))
      expect([...writer.files.keys()]).toEqual(['/data/sub/one.txt', '/data/two.bin', '/alone.txt'])
      expect(writer.metas.get('/data/sub/one.txt')).toMatchObject({ mode: 0o600, uid: 1000, gid: 1000, size: 3 })
      expect(writer.dirs.has('/data')).toBe(true)
      expect(writer.dirs.has('/data/sub')).toBe(true)
      // Created directories get the mode and owner of their own tar header (no mtime).
      expect(writer.setMetas.get('/data')).toEqual({ mode: 0o775, uid: 1000, gid: 1000 })
      expect(writer.setMetas.get('/data/sub')).toEqual({ mode: 0o700, uid: 1000, gid: 1000 })
      expect(writer.symlinks.get('/data/link')).toBe('two.bin')
      // Exactly the file being written sits in the spool, and nothing afterwards.
      expect(seen).toEqual([1, 1, 1])
      expect(await readdir(spoolDir)).toEqual([])
      expect(final.log.some((l: any) => l.level === 'warn' && l.msg.includes('Skipped data/pipe'))).toBe(true)
    })

    it('reads a created directory\'s attributes from the first header only, leaves an existing one alone', async () => {
      fakeFree(100 * 1024 * 1024)
      walk({ [tree]: entries })
      await serveLeaves()
      writer.dirs.add('/data/sub')
      await runGuestFileRestoreJob('job-agent-dirmeta', context({ method: 'agent', items: [{ path: tree, directory: true }], settings: settingsWithSpool() }))
      expect(lastUpdate()).toMatchObject({ status: 'completed', filesFailed: 0 })
      expect(writer.setMetas.get('/data')).toEqual({ mode: 0o775, uid: 1000, gid: 1000 })
      expect(writer.setMetas.has('/data/sub')).toBe(false)
      // The directory download was dropped right after its first header, not staged.
      const root = served.get(tree)!
      expect(root.body.destroyed).toBe(true)
      expect(root.consumed).toBeLessThan(root.size / 2)
      expect(served.has(`${tree}/sub`)).toBe(false)
      expect(await readdir(spoolDir)).toEqual([])
    })

    it('inherits the owner of the parent when the tar does not start with the directory itself', async () => {
      fakeFree(100 * 1024 * 1024)
      walk({ [tree]: [{ path: `${tree}/sub`, name: 'sub', type: 'directory', size: 0 }] })
      serve({
        [tree]: { tar: true, buf: await buildTarZst([{ name: 'data/x', content: 'x' }]) },
        [`${tree}/sub`]: { tar: true, buf: await buildTarZst([{ name: 'sub/y', content: 'y' }]) },
      })
      writer.owners.set('/', { uid: 0, gid: 0 })
      writer.owners.set('/data', { uid: 1000, gid: 1000 })
      await runGuestFileRestoreJob('job-agent-dirowner', context({ method: 'agent', items: [{ path: tree, directory: true }], settings: settingsWithSpool() }))
      expect(lastUpdate()).toMatchObject({ status: 'completed' })
      expect(writer.setMetas.get('/data')).toEqual({ uid: 0, gid: 0 })
      expect(writer.setMetas.get('/data/sub')).toEqual({ uid: 1000, gid: 1000 })
      expect(lastUpdate().log.filter((l: any) => l.level === 'warn' && l.msg.includes('owner inherited from the parent directory'))).toHaveLength(2)
    })

    it('fails only the file that does not fit in the free space of the spool disk', async () => {
      // 5000 bytes free after the margin: two.bin (6000) is refused, one.txt (3) goes through.
      fakeFree(1024 + 5000)
      walk({ [tree]: entries })
      await serveLeaves()
      await runGuestFileRestoreJob('job-agent-space', context({ method: 'agent', items: [{ path: tree, directory: true }], settings: settingsWithSpool() }))
      const final = lastUpdate()
      expect(final).toMatchObject({ status: 'completed_with_errors', filesDone: 2, filesFailed: 1, error: null })
      expect([...writer.files.keys()]).toEqual(['/data/sub/one.txt'])
      expect(final.log.some((l: any) => l.level === 'error' && l.msg.includes('data/two.bin: Not enough space to stage the file'))).toBe(true)
      expect(await readdir(spoolDir)).toEqual([])
    })

    it('refuses up front a selection above the agent limit, before any download', async () => {
      walk({ [tree]: [{ path: `${tree}/huge.bin`, name: 'huge.bin', type: 'file', size: 2 * 1024 * 1024 }] })
      let opened = 0
      _impl.openSourceStream = async () => { opened++; throw new Error('should not open') }
      await runGuestFileRestoreJob('job-agent-cap', context({ method: 'agent', items: [{ path: tree, directory: true }], settings: settingsWithSpool({ agentMaxBytes: 1024 * 1024 }) }))
      expect(opened).toBe(0)
      expect(lastUpdate()).toMatchObject({ status: 'failed' })
      expect(lastUpdate().error).toContain('above the guest agent limit of 1 MiB')
    })

    it('counts a directory that cannot be listed and goes on with the other items', async () => {
      fakeFree(100 * 1024 * 1024)
      walk({})
      await serveLeaves()
      await runGuestFileRestoreJob('job-agent-walk', context({
        method: 'agent',
        items: [{ path: tree, directory: true }, { path: '/drive-scsi0.img.fidx/part/1/alone.txt', directory: false, size: 5 }],
        settings: settingsWithSpool(),
      }))
      expect(lastUpdate()).toMatchObject({ status: 'completed_with_errors', filesDone: 1, filesFailed: 1 })
      expect(lastUpdate().log.some((l: any) => l.msg.includes(`Cannot list ${tree}`))).toBe(true)
    })
  })

  it('readAll helper reads a whole stream', async () => {
    expect((await readAll(Readable.from([Buffer.from('a'), Buffer.from('b')]))).toString()).toBe('ab')
  })
})
