import { Readable } from 'node:stream'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pveFetchMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn() }))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

import { AGENT_CHUNK_BYTES, AGENT_STAGING_TEMPLATE, AgentWriter, SH, _impl, agentExec, probeAgent, psCommand, shCommand } from './agent'
import { GuestWriterError } from './writer'

const conn = { id: 'c1', name: 'pve', baseUrl: 'https://pve:8006', apiToken: 'u@pam!t=secret', insecureDev: true, behindProxy: false }
const target = { conn, node: 'pve1', vmid: 9990 }

type Call = { path: string; body?: any; method?: string }

function calls(): Call[] {
  return pveFetchMock.mock.calls.map(([, path, init]) => ({
    path,
    method: init?.method,
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
  }))
}

/** Default PVE answers: linux guest, every exec exits 0 unless `execExit` says otherwise. */
function installPve(opts: { os?: 'linux' | 'windows'; execExit?: (argv: string[], input?: string) => { exitcode: number; out?: string; err?: string } } = {}) {
  let pid = 0
  const results = new Map<number, { exitcode: number; out?: string; err?: string }>()
  pveFetchMock.mockImplementation(async (_conn: any, path: string, init: any) => {
    if (path.endsWith('/agent/ping')) return null
    if (path.endsWith('/agent/get-osinfo')) {
      return opts.os === 'windows'
        ? { result: { id: 'mswindows', name: 'Microsoft Windows', 'pretty-name': 'Windows Server 2022' } }
        : { result: { id: 'debian', name: 'Debian GNU/Linux', 'pretty-name': 'Debian GNU/Linux 13', 'kernel-release': '6.12' } }
    }
    if (path.endsWith('/agent/file-write')) return null
    if (path.endsWith('/agent/exec')) {
      const body = JSON.parse(init.body)
      pid += 1
      const custom = opts.execExit?.(body.command, body['input-data'])
      results.set(pid, custom ?? defaultExec(body.command))
      return { pid }
    }
    const m = /exec-status\?pid=(\d+)$/.exec(path)
    if (m) {
      const r = results.get(Number(m[1]))!
      return { exited: 1, exitcode: r.exitcode, 'out-data': r.out ?? '', 'err-data': r.err ?? '' }
    }
    throw new Error(`unexpected path ${path}`)
  })
}

const STAGING = '/var/tmp/.pxc-restore-Ab12Cd34'
const WIN_STAGING = 'C:\\Windows\\TEMP\\pxc-restore-0123456789abcdef0123456789abcdef'

/** What the guest answers by default: the staging directory for mktemp, success otherwise. */
function defaultExec(argv: string[]): { exitcode: number; out?: string; err?: string } {
  if (argv[0] === 'sh' && argv[2].startsWith('mktemp -d')) return { exitcode: 0, out: `${STAGING}\n` }
  if (argv[0] === 'powershell.exe') {
    const script = Buffer.from(argv[6], 'base64').toString('utf16le')
    if (script.includes('NewGuid')) return { exitcode: 0, out: `${WIN_STAGING}\r\n` }
  }
  return { exitcode: 0 }
}

const log = vi.fn()

beforeEach(() => {
  pveFetchMock.mockReset()
  log.mockReset()
  _impl.sleep = async () => {}
})

describe('shCommand / psCommand', () => {
  it('passes guest paths as positional parameters, never inside the script', () => {
    const argv = shCommand('test -e "$1"', '/etc/evil; rm -rf /')
    expect(argv).toEqual(['sh', '-c', 'test -e "$1"', 'sh', '/etc/evil; rm -rf /'])
  })
  it('encodes the powershell script as UTF-16LE base64', () => {
    const argv = psCommand('exit 0')
    expect(argv.slice(0, 6)).toEqual(['powershell.exe', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand'])
    expect(Buffer.from(argv[6], 'base64').toString('utf16le')).toBe('exit 0')
  })
})

describe('agentExec', () => {
  it('starts the command as a JSON argv array and polls exec-status until exited', async () => {
    let polls = 0
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path.endsWith('/agent/exec')) return { pid: 42 }
      polls += 1
      return polls < 3 ? { exited: 0 } : { exited: 1, exitcode: 0, 'out-data': 'hi\n' }
    })
    const res = await agentExec(target, ['sh', '-c', 'echo hi'], 'stdin', new AbortController().signal)
    expect(res).toEqual({ exitcode: 0, out: 'hi\n', err: '', truncated: false })
    const [start] = calls()
    expect(start.path).toBe('/nodes/pve1/qemu/9990/agent/exec')
    expect(start.method).toBe('POST')
    expect(start.body).toEqual({ command: ['sh', '-c', 'echo hi'], 'input-data': 'stdin' })
    expect(calls()[1].path).toBe('/nodes/pve1/qemu/9990/agent/exec-status?pid=42')
  })

  it('reports a stopped agent as fatal', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE 500 /agent/exec: QEMU guest agent is not running'))
    await expect(agentExec(target, ['true'], undefined, new AbortController().signal)).rejects.toMatchObject({ fatal: true })
  })
})

describe('AgentWriter on linux', () => {
  it('detects the OS through ping + get-osinfo', async () => {
    installPve()
    const w = await AgentWriter.create(target, 'job1', { maxBytes: 1024 * 1024, log })
    expect(w.os).toBe('linux')
    expect(w.description).toContain('Debian')
    expect(calls().map(c => c.path)).toEqual(['/nodes/pve1/qemu/9990/agent/ping', '/nodes/pve1/qemu/9990/agent/info', '/nodes/pve1/qemu/9990/agent/get-osinfo'])
  })

  it('writes a small file into the staging directory with one file-write, then moves it with its metadata', async () => {
    installPve()
    const w = await AgentWriter.create(target, 'job1', { maxBytes: 1024 * 1024, log })
    const bytes: number[] = []
    await w.writeFile('/etc/apt/sources.list', Readable.from([Buffer.from('deb main\n')]), { mode: 0o100644, uid: 0, gid: 0, mtime: new Date(1_700_000_000_000) }, n => bytes.push(n), new AbortController().signal)

    const after = calls().slice(3)
    // The staging directory comes from mktemp, never from a predictable name.
    expect(after[0].path).toBe('/nodes/pve1/qemu/9990/agent/exec')
    expect(after[0].body.command.slice(2)).toEqual([SH.mktempDir, 'sh', AGENT_STAGING_TEMPLATE])
    expect(AGENT_STAGING_TEMPLATE).toMatch(/XXXXXXXX$/)
    // The fast path never file-writes at the target: file-write follows symlinks.
    const write = after.find(c => c.path.endsWith('/file-write'))!
    expect(write.body).toEqual({ file: `${STAGING}/1.file`, content: Buffer.from('deb main\n').toString('base64'), encode: 0 })
    const finish = after.find(c => c.path.endsWith('/agent/exec') && c.body.command[2] === SH.finish)!
    expect(finish.body.command.slice(3)).toEqual(['sh', `${STAGING}/1.file`, '/etc/apt/sources.list', '644', '0:0', '1700000000', '0'])
    expect(SH.finish).toContain('mv -fT -- "$s" "$t"')
    expect(SH.finish).toContain('chown -h')
    expect(calls().some(c => c.path.endsWith('/file-write') && c.body.file === '/etc/apt/sources.list')).toBe(false)
    expect(bytes).toEqual([9])
  })

  it('refuses a symlink at the target unless the policy is overwrite', async () => {
    // The guest script exits 3 for a symlink target without overwrite.
    installPve({ execExit: argv => (argv[2] === SH.finish && argv[9] !== '1' ? { exitcode: 3, err: '/etc/hosts is a symlink' } : undefined as any) })
    const w = await AgentWriter.create(target, 'job1', { maxBytes: 1024 * 1024, log })
    const err = await w.writeFile('/etc/hosts', Readable.from([Buffer.from('x')]), {}, () => {}, new AbortController().signal).catch(e => e)
    expect(err).toBeInstanceOf(GuestWriterError)
    expect(err.fatal).toBe(false)
    expect(err.message).toContain('refused, /etc/hosts is a symlink')
    // With overwrite the rename replaces the link itself.
    await w.writeFile('/etc/hosts', Readable.from([Buffer.from('x')]), {}, () => {}, new AbortController().signal, { overwrite: true })
    const finishes = calls().filter(c => c.path.endsWith('/agent/exec') && c.body.command[2] === SH.finish).map(c => c.body.command.at(-1))
    expect(finishes).toEqual(['0', '1'])
  })

  it('refuses a destination tree with a symlinked component not owned by root', async () => {
    installPve({ execExit: argv => (argv[2] === SH.mkdirp && argv[4] === '/var/tmp/proxcenter-restore/etc' ? { exitcode: 3, err: '/var/tmp/proxcenter-restore is a symlink owned by uid 1000' } : undefined as any) })
    const w = await AgentWriter.create(target, 'job1', { maxBytes: 1024, log })
    const err = await w.mkdirp('/var/tmp/proxcenter-restore/etc').catch(e => e)
    expect(err).toBeInstanceOf(GuestWriterError)
    expect(err.fatal).toBe(false)
    expect(err.message).toContain('refused, /var/tmp/proxcenter-restore is a symlink owned by uid 1000')
    expect(SH.mkdirp).toContain('stat -c %u')
    expect(SH.mkdirp.indexOf('mkdir -p')).toBeGreaterThan(SH.mkdirp.indexOf('[ -L "$p" ]'))
    await w.mkdirp('/srv/ok')
  })

  it('stages a large file in 46080-byte parts, appends them and moves the partial into place', async () => {
    installPve()
    const w = await AgentWriter.create(target, 'job1', { maxBytes: 1024 * 1024, log })
    const size = AGENT_CHUNK_BYTES * 2 + 10
    const data = Buffer.alloc(size, 1)
    const pieces = [data.subarray(0, 1000), data.subarray(1000, 50_000), data.subarray(50_000)]
    let total = 0
    await w.writeFile('/var/lib/big.bin', Readable.from(pieces), { mode: 0o644 }, n => { total += n }, new AbortController().signal)
    expect(total).toBe(size)

    const after = calls().slice(3)
    const writes = after.filter(c => c.path.endsWith('/file-write')).map(c => c.body)
    expect(writes.map(b => b.file)).toEqual([
      `${STAGING}/1.00000000`,
      `${STAGING}/1.00000001`,
      `${STAGING}/1.00000002`,
    ])
    expect(Buffer.from(writes[0].content, 'base64')).toHaveLength(AGENT_CHUNK_BYTES)
    expect(Buffer.from(writes[2].content, 'base64')).toHaveLength(10)
    expect(Buffer.concat(writes.map(b => Buffer.from(b.content, 'base64')))).toEqual(data)

    const execs = after.filter(c => c.path.endsWith('/agent/exec')).map(c => c.body.command)
    expect(execs[0].slice(3)).toEqual(['sh', AGENT_STAGING_TEMPLATE])
    expect(execs[1].slice(3)).toEqual([
      'sh',
      `${STAGING}/1.file`,
      `${STAGING}/1.00000000`,
      `${STAGING}/1.00000001`,
      `${STAGING}/1.00000002`,
    ])
    expect(execs[1][2]).toContain('cat -- "$@" >> "$t"')
    expect(execs[2][2]).toBe(SH.finish)
    expect(execs[2].slice(3)).toEqual(['sh', `${STAGING}/1.file`, '/var/lib/big.bin', '644', '', '', '0'])
    expect(execs).toHaveLength(3)

    await w.close()
    const last = calls().at(-2)!
    expect(last.body.command[2]).toBe(SH.rmrf)
    expect(last.body.command.slice(3)).toEqual(['sh', STAGING])
  })

  it('keeps several parts in flight, appends them in index order once all are written', async () => {
    installPve()
    const base = pveFetchMock.getMockImplementation()!
    let active = 0
    let peak = 0
    let pendingWrites = 0
    const appendSawPending: number[] = []
    pveFetchMock.mockImplementation(async (conn: any, path: string, init: any) => {
      if (path.endsWith('/agent/file-write') && JSON.parse(init.body).content) {
        active++
        pendingWrites++
        peak = Math.max(peak, active)
        // Later parts finish first.
        const idx = Number(/\.(\d+)$/.exec(JSON.parse(init.body).file)?.[1] ?? 0)
        await new Promise(r => setTimeout(r, 20 - idx * 3))
        active--
        pendingWrites--
        return null
      }
      if (path.endsWith('/agent/exec') && JSON.parse(init.body).command[2]?.includes('cat --')) appendSawPending.push(pendingWrites)
      return base(conn, path, init)
    })
    const w = await AgentWriter.create(target, 'job1', { maxBytes: 1024 * 1024, parallelWrites: 3, log })
    const data = Buffer.alloc(AGENT_CHUNK_BYTES * 5 + 7, 2)
    let total = 0
    await w.writeFile('/srv/f.bin', Readable.from([data]), {}, n => { total += n }, new AbortController().signal)

    expect(total).toBe(data.length)
    expect(peak).toBe(3)
    expect(appendSawPending).toEqual([0])
    const append = calls().filter(c => c.path.endsWith('/agent/exec')).map(c => c.body.command).find(c => c[2].includes('cat --'))!
    expect(append.slice(5)).toEqual([0, 1, 2, 3, 4, 5].map(i => `${STAGING}/1.${String(i).padStart(8, '0')}`))
  })

  it('stops with a fatal error when the per-job agent cap is exceeded', async () => {
    installPve()
    const w = await AgentWriter.create(target, 'job1', { maxBytes: 100, log })
    const err = await w.writeFile('/x', Readable.from([Buffer.alloc(200)]), {}, () => {}, new AbortController().signal).catch(e => e)
    expect(err).toBeInstanceOf(GuestWriterError)
    expect(err.fatal).toBe(true)
    expect(err.message).toMatch(/SSH/)
  })

  it('maps the exit code of the exists test', async () => {
    installPve({ execExit: argv => ({ exitcode: argv[4] === '/present' ? 0 : 1 }) })
    const w = await AgentWriter.create(target, 'job1', { maxBytes: 1024, log })
    expect(await w.exists('/present')).toBe(true)
    expect(await w.exists('/absent')).toBe(false)
  })

  it('caches created directories and reports a failed mkdir as non fatal', async () => {
    installPve({ execExit: argv => (argv[4] === '/proc/x' ? { exitcode: 1, err: 'mkdir: cannot create directory' } : { exitcode: 0 }) })
    const w = await AgentWriter.create(target, 'job1', { maxBytes: 1024, log })
    await w.mkdirp('/etc/apt')
    await w.mkdirp('/etc/apt')
    expect(calls().filter(c => c.path.endsWith('/agent/exec'))).toHaveLength(1)
    const err = await w.mkdirp('/proc/x').catch(e => e)
    expect(err).toBeInstanceOf(GuestWriterError)
    expect(err.fatal).toBe(false)
  })

  it('refuses an unsupported OS', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => (path.endsWith('/get-osinfo') ? { result: { id: 'freebsd', name: 'FreeBSD' } } : null))
    await expect(AgentWriter.create(target, 'job1', { maxBytes: 1024, log })).rejects.toMatchObject({ fatal: true })
  })
})

describe('AgentWriter on windows', () => {
  it('sends powershell with JSON parameters on stdin and skips symlinks', async () => {
    const inputs: string[] = []
    installPve({
      os: 'windows',
      execExit: (argv, input) => {
        if (input) inputs.push(input)
        const script = Buffer.from(argv[6], 'base64').toString('utf16le')
        if (script.includes('NewGuid')) return { exitcode: 0, out: `${WIN_STAGING}\r\n` }
        return { exitcode: 0 }
      },
    })
    const w = await AgentWriter.create(target, 'job1', { maxBytes: 1024 * 1024, log })
    expect(w.os).toBe('windows')
    await w.mkdirp('C:\\Restore\\etc')
    expect(JSON.parse(inputs.at(-1)!)).toEqual({ path: 'C:\\Restore\\etc' })

    await w.writeFile('C:\\Restore\\big.bin', Readable.from([Buffer.alloc(AGENT_CHUNK_BYTES + 1)]), { mtime: new Date(1_700_000_000_000) }, () => {}, new AbortController().signal)
    const writes = calls().filter(c => c.path.endsWith('/file-write')).map(c => c.body.file)
    expect(writes).toEqual([`${WIN_STAGING}\\1.00000000`, `${WIN_STAGING}\\1.00000001`])
    const append = inputs.map(i => JSON.parse(i)).find(j => Array.isArray(j.parts))
    expect(append).toEqual({ target: `${WIN_STAGING}\\1.file`, parts: writes })
    expect(inputs.map(i => JSON.parse(i)).find(j => j.staged)).toEqual({ staged: `${WIN_STAGING}\\1.file`, target: 'C:\\Restore\\big.bin', mtime: '1700000000', overwrite: false })

    await w.symlink('C:\\Restore\\link', 'target')
    expect(log).toHaveBeenCalledWith('warn', expect.stringContaining('Symlink skipped'))
  })
})

describe('probeAgent', () => {
  it('answers ok with the OS and hostname', async () => {
    installPve({ execExit: () => ({ exitcode: 0, out: 'airgap-test\n' }) })
    expect(await probeAgent(target)).toEqual({ ok: true, os: 'linux', hostname: 'airgap-test', details: { os: 'Debian GNU/Linux 13', kernel: '6.12' } })
  })
  // Lab Win2025: qemu-ga runs with guest-exec, every guest-file-* and
  // guest-get-osinfo blocked; the probe must say so instead of "unknown OS".
  it('names the blocked agent commands', async () => {
    const enabled = (name: string) => !['guest-exec', 'guest-file-write', 'guest-get-osinfo'].includes(name)
    const names = ['guest-ping', 'guest-exec', 'guest-exec-status', 'guest-file-open', 'guest-file-write', 'guest-file-close', 'guest-get-osinfo']
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path.endsWith('/agent/info')) return { result: { supported_commands: names.map(name => ({ name, enabled: enabled(name) })) } }
      return null
    })
    const res = await probeAgent(target)
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('blocks guest-exec, guest-file-write') })
  })
  it('falls back to the VM ostype when get-osinfo is blocked', async () => {
    installPve({ execExit: () => ({ exitcode: 0, out: 'WIN-1\r\n' }) })
    const base = pveFetchMock.getMockImplementation()!
    const names = ['guest-exec', 'guest-exec-status', 'guest-file-open', 'guest-file-write', 'guest-file-close', 'guest-get-osinfo']
    pveFetchMock.mockImplementation(async (c: any, path: string, init: any) => {
      if (path.endsWith('/agent/info')) return { result: { supported_commands: names.map(name => ({ name, enabled: name !== 'guest-get-osinfo' })) } }
      if (path.endsWith('/qemu/9990/config')) return { ostype: 'win11' }
      if (path.endsWith('/agent/get-osinfo')) throw new Error('must not be called')
      return base(c, path, init)
    })
    expect(await probeAgent(target)).toMatchObject({ ok: true, os: 'windows', hostname: 'WIN-1', details: { os: 'Windows (win11)' } })
  })
  it('answers ok:false when the agent is not running', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE 500 /agent/ping: QEMU guest agent is not running'))
    const res = await probeAgent(target)
    expect(res.ok).toBe(false)
    expect(res).toMatchObject({ error: expect.stringContaining('not running') })
  })
})
