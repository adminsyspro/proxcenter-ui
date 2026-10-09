// Failure paths and the less travelled branches of the agent writer.

import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pveFetchMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn() }))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

import { AGENT_APPEND_BATCH, AGENT_CHUNK_BYTES, AgentWriter, SH, _impl, agentExec, detectAgentOs } from './agent'
import { GuestWriterError } from './writer'

const conn = { id: 'c1', name: 'pve', baseUrl: 'https://pve:8006', apiToken: 'u@pam!t=secret', insecureDev: true, behindProxy: false }
const target = { conn, node: 'pve1', vmid: 9990 } as any
const STAGING = '/var/lib/.pxc-restore/job-Ab12Cd34'
const WIN_STAGING = 'C:\\Windows\\TEMP\\pxc-restore-0123456789abcdef0123456789abcdef'

type ExecAnswer = { exitcode: number; out?: string; err?: string }

interface PveOptions {
  os?: 'linux' | 'windows'
  exec?: (argv: string[], input?: string) => ExecAnswer | undefined
  fileWrite?: (file: string) => Promise<void> | void
  override?: (path: string) => unknown
}

function script(argv: string[]): string {
  return argv[0] === 'powershell.exe' ? Buffer.from(argv[6], 'base64').toString('utf16le') : argv[2]
}

function installPve(opts: PveOptions = {}) {
  let pid = 0
  const results = new Map<number, ExecAnswer>()
  pveFetchMock.mockImplementation(async (_c: any, path: string, init: any) => {
    const o = opts.override?.(path)
    if (o instanceof Error) throw o
    if (o !== undefined) return o
    if (path.endsWith('/agent/ping') || path.endsWith('/agent/info')) return null
    if (path.endsWith('/agent/get-osinfo')) {
      return opts.os === 'windows'
        ? { result: { id: 'mswindows', name: 'Microsoft Windows' } }
        : { result: { id: 'debian', name: 'Debian GNU/Linux' } }
    }
    if (path.endsWith('/agent/file-write')) {
      await opts.fileWrite?.(JSON.parse(init.body).file)
      return null
    }
    if (path.endsWith('/agent/exec')) {
      const body = JSON.parse(init.body)
      pid += 1
      const s = script(body.command)
      const custom = opts.exec?.(body.command, body['input-data'])
      const fallback = s.includes('mktemp -d') ? { exitcode: 0, out: `${STAGING}\n` } : s.includes('NewGuid') ? { exitcode: 0, out: `${WIN_STAGING}\r\n` } : { exitcode: 0 }
      results.set(pid, custom ?? fallback)
      return { pid }
    }
    const m = /exec-status\?pid=(\d+)$/.exec(path)
    if (m) {
      const r = results.get(Number(m[1]))!
      return { exited: 1, exitcode: r.exitcode, 'out-data': r.out, 'err-data': r.err }
    }
    throw new Error(`unexpected path ${path}`)
  })
}

const execCalls = () => pveFetchMock.mock.calls
  .filter(([, path]) => String(path).endsWith('/agent/exec'))
  .map(([, , init]) => JSON.parse(init.body) as { command: string[]; 'input-data'?: string })

const log = vi.fn()
const signal = () => new AbortController().signal
const make = (opts: Partial<{ maxBytes: number; parallelWrites: number }> = {}) =>
  AgentWriter.create(target, 'job', { maxBytes: 64 * 1024 * 1024, log, ...opts })

beforeEach(() => {
  pveFetchMock.mockReset()
  log.mockReset()
  _impl.sleep = async () => {}
})

describe('agentExec failures', () => {
  it('refuses an exec without pid', async () => {
    pveFetchMock.mockResolvedValue(null)
    await expect(agentExec(target, ['true'], undefined, signal())).rejects.toMatchObject({ message: 'Guest agent exec returned no pid', fatal: true })
  })

  it('stops polling when cancelled', async () => {
    const ac = new AbortController()
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path.endsWith('/agent/exec')) return { pid: 1 }
      ac.abort()
      return { exited: 0 }
    })
    await expect(agentExec(target, ['true'], undefined, ac.signal)).rejects.toMatchObject({ message: 'Cancelled', fatal: true })
  })

  it('classifies an exec-status failure and keeps a GuestWriterError as is', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path.endsWith('/agent/exec')) return { pid: 1 }
      throw new Error('500 something odd')
    })
    await expect(agentExec(target, ['true'], undefined, signal())).rejects.toMatchObject({ message: '500 something odd', fatal: false })

    const own = new GuestWriterError('mine', true)
    pveFetchMock.mockRejectedValue(own)
    await expect(agentExec(target, ['true'], undefined, signal())).rejects.toBe(own)
  })

  it('times out a command that never exits', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => (path.endsWith('/agent/exec') ? { pid: 1 } : { exited: 0 }))
    await expect(agentExec(target, ['sleep'], undefined, signal(), -1)).rejects.toThrow('Guest command timed out after 0 s')
  })

  it('defaults the missing fields of an exited status', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => (path.endsWith('/agent/exec') ? { pid: 1 } : { exited: 1, 'out-truncated': 1 }))
    expect(await agentExec(target, ['true'], undefined, signal())).toEqual({ exitcode: -1, out: '', err: '', truncated: true })
  })
})

describe('detectAgentOs', () => {
  const blockedOsinfo = { supported_commands: ['guest-exec', 'guest-exec-status', 'guest-file-open', 'guest-file-write', 'guest-file-close', 'guest-get-osinfo'].map(name => ({ name, enabled: name !== 'guest-get-osinfo' })) }

  it('reads Linux from the VM ostype when get-osinfo is blocked', async () => {
    installPve({ override: p => (p.endsWith('/agent/info') ? blockedOsinfo : p.endsWith('/config') ? { ostype: 'l26' } : undefined) })
    expect(await detectAgentOs(target)).toEqual({ os: 'linux', label: 'Linux' })
  })

  it('fails when get-osinfo is blocked and the ostype says nothing', async () => {
    installPve({ override: p => (p.endsWith('/agent/info') ? blockedOsinfo : p.endsWith('/config') ? { ostype: 'other' } : undefined) })
    await expect(detectAgentOs(target)).rejects.toThrow('cannot tell Linux from Windows')
    installPve({ override: p => (p.endsWith('/agent/info') ? blockedOsinfo : p.endsWith('/config') ? new Error('gone') : undefined) })
    await expect(detectAgentOs(target)).rejects.toThrow('cannot tell Linux from Windows')
  })

  it('falls back to the ostype when get-osinfo fails, else reports the failure', async () => {
    installPve({ override: p => (p.endsWith('/get-osinfo') ? new Error('boom') : p.endsWith('/config') ? { ostype: 'win10' } : undefined) })
    expect(await detectAgentOs(target)).toEqual({ os: 'windows', label: 'Windows (win10)' })
    installPve({ override: p => (p.endsWith('/get-osinfo') ? new Error('boom') : p.endsWith('/config') ? {} : undefined) })
    await expect(detectAgentOs(target)).rejects.toThrow('Guest agent get-osinfo failed: boom')
  })

  it('accepts an agent listing no command, and an unwrapped osinfo answer', async () => {
    installPve({ override: p => (p.endsWith('/agent/info') ? { result: { supported_commands: [] } } : p.endsWith('/get-osinfo') ? { id: 'ubuntu' } : undefined) })
    expect(await detectAgentOs(target)).toEqual({ os: 'linux', label: 'ubuntu', kernel: undefined })
    installPve({ override: p => (p.endsWith('/get-osinfo') ? {} : undefined) })
    await expect(detectAgentOs(target)).rejects.toThrow('Unsupported guest OS "unknown"')
  })
})

describe('AgentWriter linux edge cases', () => {
  it('writes an empty file through the staging directory', async () => {
    installPve()
    const w = await make()
    await w.writeFile('/etc/empty', Readable.from([]), {}, () => {}, signal())
    const write = pveFetchMock.mock.calls.find(([, p]) => String(p).endsWith('/file-write'))!
    expect(JSON.parse(write[2].body)).toMatchObject({ file: `${STAGING}/1.file`, content: '' })
    const finish = execCalls().find(c => c.command[2] === SH.finish)!
    expect(finish.command.slice(3)).toEqual(['sh', `${STAGING}/1.file`, '/etc/empty', '', '', '', '0'])
    expect(w.bytesWritten).toBe(0)
  })

  it('refuses a staging directory the guest did not create as expected', async () => {
    installPve({ exec: argv => (script(argv).includes('mktemp -d') ? { exitcode: 0, out: '/tmp/predictable\n' } : undefined) })
    const w = await make()
    await expect(w.writeFile('/etc/x', Readable.from([Buffer.from('x')]), {}, () => {}, signal())).rejects.toMatchObject({ fatal: true, message: expect.stringContaining('/tmp/predictable') })
    installPve({ exec: argv => (script(argv).includes('mktemp -d') ? { exitcode: 1 } : undefined) })
    const w2 = await make()
    await expect(w2.writeFile('/etc/x', Readable.from([Buffer.from('x')]), {}, () => {}, signal())).rejects.toThrow('exit code 1')
  })

  it('names a directory at the target and a failing tool', async () => {
    installPve({ exec: argv => (argv[2] === SH.finish ? { exitcode: 5, err: '/etc/x is a directory\n' } : undefined) })
    const w = await make()
    await expect(w.writeFile('/etc/x', Readable.from([Buffer.from('x')]), {}, () => {}, signal())).rejects.toThrow('Cannot move the restored file onto /etc/x: refused, /etc/x is a directory')
    installPve({ exec: argv => (argv[2] === SH.finish ? { exitcode: 1 } : undefined) })
    const w2 = await make()
    await expect(w2.writeFile('/etc/x', Readable.from([Buffer.from('x')]), {}, () => {}, signal())).rejects.toThrow('Cannot move the restored file onto /etc/x: exit code 1')
  })

  it('classifies a failed file-write', async () => {
    installPve({ fileWrite: () => { throw new Error('connect ECONNRESET') } })
    const w = await make()
    await expect(w.writeFile('/etc/x', Readable.from([Buffer.from('x')]), {}, () => {}, signal())).rejects.toMatchObject({ fatal: true })
  })

  it('reports a failed stat in exists', async () => {
    installPve({ exec: () => ({ exitcode: 2, err: 'permission denied\n' }) })
    const w = await make()
    await expect(w.exists('/root/x')).rejects.toThrow('Cannot stat /root/x: permission denied')
    installPve({ exec: () => ({ exitcode: 9 }) })
    await expect((await make()).exists('/root/x')).rejects.toThrow('exit code 9')
  })

  it('fails a large file whose part write fails, without leaving writes behind', async () => {
    let n = 0
    installPve({ fileWrite: () => { n += 1; if (n === 2) throw new Error('500 write failed') } })
    const w = await make({ parallelWrites: 1 })
    const body = Readable.from([Buffer.alloc(AGENT_CHUNK_BYTES * 4, 1)])
    await expect(w.writeFile('/srv/big', body, {}, () => {}, signal())).rejects.toThrow('500 write failed')
  })

  it('fails a large file whose last part write fails, at the final flush', async () => {
    installPve({ fileWrite: file => { if (file.endsWith('00000001')) return new Promise((_, reject) => setImmediate(() => reject(new Error('500 late failure')))) } })
    const w = await make({ parallelWrites: 8 })
    await expect(w.writeFile('/srv/big', Readable.from([Buffer.alloc(AGENT_CHUNK_BYTES * 2, 1)]), {}, () => {}, signal())).rejects.toThrow('500 late failure')
  })

  it('stops a large file on cancel', async () => {
    installPve()
    const w = await make()
    const ac = new AbortController()
    async function* gen() {
      yield Buffer.alloc(AGENT_CHUNK_BYTES, 1)
      yield Buffer.alloc(AGENT_CHUNK_BYTES, 1)
      ac.abort()
      yield Buffer.alloc(AGENT_CHUNK_BYTES, 1)
    }
    await expect(w.writeFile('/srv/big', Readable.from(gen()), {}, () => {}, ac.signal)).rejects.toMatchObject({ message: 'Cancelled' })
  })

  it('reports a failed assembly of the parts', async () => {
    installPve({ exec: argv => (argv[2] === SH.append ? { exitcode: 1, err: 'No space left on device\n' } : undefined) })
    const w = await make()
    await expect(w.writeFile('/srv/big', Readable.from([Buffer.alloc(AGENT_CHUNK_BYTES * 2, 1)]), {}, () => {}, signal())).rejects.toThrow(`Cannot assemble ${STAGING}/1.file: No space left on device`)
  })

  it('appends in batches of AGENT_APPEND_BATCH parts', async () => {
    installPve()
    const w = await make({ parallelWrites: 16 })
    const parts = AGENT_APPEND_BATCH + 2
    await w.writeFile('/srv/huge', Readable.from([Buffer.alloc(AGENT_CHUNK_BYTES * parts, 1)]), {}, () => {}, signal())
    const appends = execCalls().filter(c => c.command[2] === SH.append)
    expect(appends.map(c => c.command.length - 5)).toEqual([AGENT_APPEND_BATCH, 2])
  }, 20_000)

  it('flushes nothing more when the parts end on a batch boundary', async () => {
    installPve()
    const w = await make({ parallelWrites: 16 })
    await w.writeFile('/srv/exact', Readable.from([Buffer.alloc(AGENT_CHUNK_BYTES * AGENT_APPEND_BATCH, 1)]), {}, () => {}, signal())
    expect(execCalls().filter(c => c.command[2] === SH.append)).toHaveLength(1)
  }, 20_000)

  it('reads the owner of a path', async () => {
    installPve({ exec: argv => (argv[2] === SH.owner ? { exitcode: 0, out: '1000:100\n' } : undefined) })
    const w = await make()
    expect(await w.ownerOf('/home/u')).toEqual({ uid: 1000, gid: 100 })
    installPve({ exec: argv => (argv[2] === SH.owner ? { exitcode: 0, out: 'garbage' } : undefined) })
    expect(await w.ownerOf('/home/u')).toBeNull()
    installPve({ exec: argv => (argv[2] === SH.owner ? { exitcode: 1, out: '0:0' } : undefined) })
    expect(await w.ownerOf('/home/u')).toBeNull()
  })

  it('sets metadata only when there is some', async () => {
    installPve()
    const w = await make()
    await w.setMeta('/srv/d', {})
    expect(execCalls().filter(c => c.command[2] === SH.meta)).toHaveLength(0)
    await w.setMeta('/srv/d', { mode: 0o40755, uid: 1, gid: 2, mtime: new Date(5_000) })
    expect(execCalls().find(c => c.command[2] === SH.meta)!.command.slice(3)).toEqual(['sh', '/srv/d', '755', '1:2', '5'])
  })

  it('creates a symlink with or without its owner and names a refusal', async () => {
    installPve()
    const w = await make()
    await w.symlink('/srv/l', 'target', { uid: 3, gid: 4 })
    await w.symlink('/srv/l2', 'target')
    const links = execCalls().filter(c => c.command[2] === SH.symlink).map(c => c.command.slice(4))
    expect(links).toEqual([['/srv/l', 'target', '3:4'], ['/srv/l2', 'target', '']])
    installPve({ exec: argv => (argv[2] === SH.symlink ? { exitcode: 5, err: '/srv/l is a directory' } : undefined) })
    await expect(w.symlink('/srv/l', 'target')).rejects.toThrow('Cannot create symlink /srv/l: refused, /srv/l is a directory')
  })

  it('closes without a staging directory, and logs a failed cleanup', async () => {
    installPve()
    const w = await make()
    await w.close()
    expect(execCalls().filter(c => c.command[2] === SH.rmrf)).toHaveLength(0)

    await w.writeFile('/etc/x', Readable.from([Buffer.from('x')]), {}, () => {}, signal())
    installPve({ override: p => (p.endsWith('/agent/exec') ? new Error('500 agent gone') : undefined) })
    await w.close()
    expect(log).toHaveBeenCalledWith('warn', `Staging directory ${STAGING} could not be removed: 500 agent gone`)
  })
})

describe('AgentWriter windows edge cases', () => {
  it('reads no owner, sets only the times and skips metadata without mtime', async () => {
    installPve({ os: 'windows' })
    const w = await make()
    expect(await w.ownerOf('C:\\x')).toBeNull()
    await w.setMeta('C:\\x', { mode: 0o644 })
    expect(execCalls()).toHaveLength(0)
    await w.setMeta('C:\\x', { mtime: new Date(9_000) })
    const [call] = execCalls()
    expect(JSON.parse(call['input-data']!)).toEqual({ path: 'C:\\x', mtime: '9' })
  })
})
