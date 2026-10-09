// SshWriter and probeSsh against an in-process ssh2 server whose SFTP
// subsystem is backed by a temporary directory: every request the writer
// sends hits a real file system, and per-test switches inject the failures
// a guest can produce (refused rename, refused chown, write error, ...).

import * as fs from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

import { Server, utils } from 'ssh2'
import type { Attributes, SFTPWrapper } from 'ssh2'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { SFTP_WRITE_CHUNK, SshWriter, classifySshError, probeSsh, sshExec } from './ssh'
import { GuestWriterError } from './writer'

const { STATUS_CODE } = utils.sftp

interface ServerConfig {
  os: 'linux' | 'windows' | 'none'
  idOut: string
  noSftp: boolean
  hostnameFails: boolean
  reportUid: number | null
  failWrite: boolean
  failOpen: boolean
  failChown: boolean
  failMkdir: 'no' | 'race' | 'hard'
  failRename: 'never' | 'exists' | 'always'
  failStat: boolean
  failRemove: boolean
  failSymlink: boolean
  calls: string[]
}

const defaults = (): ServerConfig => ({
  os: 'linux',
  idOut: '1000\n',
  noSftp: false,
  hostnameFails: false,
  reportUid: null,
  failWrite: false,
  failOpen: false,
  failChown: false,
  failMkdir: 'no',
  failRename: 'exists',
  failStat: false,
  failRemove: false,
  failSymlink: false,
  calls: [],
})

let cfg: ServerConfig = defaults()
// Real SSH handshakes: slower than the 5 s default on shared CI runners. A
// test that overruns keeps writing into the next test's root (`root` is
// reassigned per test), so give them room rather than let them leak.
vi.setConfig({ testTimeout: 30_000 })

let root = ''
let server: Server
let port = 0

const local = (p: string) => join(root, p.replace(/^\/[A-Za-z]:/, ''))

function codeOf(err: unknown): number {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ENOENT') return STATUS_CODE.NO_SUCH_FILE
  if (code === 'EACCES' || code === 'EPERM') return STATUS_CODE.PERMISSION_DENIED
  return STATUS_CODE.FAILURE
}

function attrsOf(st: fs.Stats): Attributes {
  return {
    mode: st.mode,
    uid: cfg.reportUid ?? st.uid,
    gid: st.gid,
    size: st.size,
    atime: Math.floor(st.atimeMs / 1000),
    mtime: Math.floor(st.mtimeMs / 1000),
  }
}

const setKeys = (attrs: Attributes) => Object.entries(attrs).filter(([, v]) => v !== undefined).map(([k]) => k).sort().join(',')

function serveSftp(sftp: SFTPWrapper) {
  const handles = new Map<string, number>()
  let next = 0
  const fdOf = (h: Buffer) => handles.get(h.toString('hex'))
  const run = (reqid: number, fn: () => void) => {
    try {
      fn()
      sftp.status(reqid, STATUS_CODE.OK)
    } catch (err) {
      sftp.status(reqid, codeOf(err))
    }
  }
  const stat = (reqid: number, path: string, link: boolean) => {
    cfg.calls.push(`${link ? 'LSTAT' : 'STAT'} ${path}`)
    if (cfg.failStat) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED)
    try {
      sftp.attrs(reqid, attrsOf(link ? fs.lstatSync(local(path)) : fs.statSync(local(path))))
    } catch (err) {
      sftp.status(reqid, codeOf(err))
    }
  }

  sftp.on('OPEN', (reqid, filename, flags, attrs) => {
    cfg.calls.push(`OPEN ${filename}`)
    if (cfg.failOpen) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED)
    try {
      const fd = fs.openSync(local(filename), utils.sftp.flagsToString(flags) ?? 'r', attrs.mode)
      const h = Buffer.alloc(4)
      h.writeUInt32BE(next++)
      handles.set(h.toString('hex'), fd)
      sftp.handle(reqid, h)
    } catch (err) {
      sftp.status(reqid, codeOf(err))
    }
  })
  sftp.on('WRITE', (reqid, handle, offset, data) => {
    if (cfg.failWrite) return sftp.status(reqid, STATUS_CODE.FAILURE)
    run(reqid, () => { fs.writeSync(fdOf(handle)!, data, 0, data.length, offset) })
  })
  sftp.on('FSETSTAT', (reqid, handle, attrs) => {
    cfg.calls.push(`FSETSTAT ${setKeys(attrs)}`)
    if (attrs.uid !== undefined && cfg.failChown) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED)
    run(reqid, () => {
      const fd = fdOf(handle)!
      if (attrs.mode !== undefined) fs.fchmodSync(fd, attrs.mode)
      if (attrs.mtime !== undefined) fs.futimesSync(fd, attrs.atime, attrs.mtime)
    })
  })
  sftp.on('CLOSE', (reqid, handle) => {
    run(reqid, () => {
      fs.closeSync(fdOf(handle)!)
      handles.delete(handle.toString('hex'))
    })
  })
  sftp.on('STAT', (reqid, path) => stat(reqid, path, false))
  sftp.on('LSTAT', (reqid, path) => stat(reqid, path, true))
  sftp.on('MKDIR', (reqid, path) => {
    cfg.calls.push(`MKDIR ${path}`)
    if (cfg.failMkdir === 'hard') return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED)
    if (cfg.failMkdir === 'race') {
      fs.mkdirSync(local(path))
      return sftp.status(reqid, STATUS_CODE.FAILURE)
    }
    run(reqid, () => fs.mkdirSync(local(path)))
  })
  sftp.on('RENAME', (reqid, oldPath, newPath) => {
    cfg.calls.push(`RENAME ${newPath}`)
    if (cfg.failRename === 'always') return sftp.status(reqid, STATUS_CODE.FAILURE)
    if (fs.existsSync(local(newPath))) return sftp.status(reqid, STATUS_CODE.FAILURE)
    run(reqid, () => fs.renameSync(local(oldPath), local(newPath)))
  })
  sftp.on('EXTENDED', (reqid, name, data) => {
    cfg.calls.push(`EXTENDED ${name}`)
    if (name !== 'posix-rename@openssh.com' || !data) return sftp.status(reqid, STATUS_CODE.OP_UNSUPPORTED)
    const oldLen = data.readUInt32BE(0)
    const oldPath = data.subarray(4, 4 + oldLen).toString()
    const newLen = data.readUInt32BE(4 + oldLen)
    const newPath = data.subarray(8 + oldLen, 8 + oldLen + newLen).toString()
    run(reqid, () => fs.renameSync(local(oldPath), local(newPath)))
  })
  sftp.on('REMOVE', (reqid, path) => {
    cfg.calls.push(`REMOVE ${path}`)
    if (cfg.failRemove) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED)
    run(reqid, () => fs.unlinkSync(local(path)))
  })
  sftp.on('SYMLINK', (reqid, linkPath, targetPath) => {
    cfg.calls.push(`SYMLINK ${linkPath} -> ${targetPath}`)
    if (cfg.failSymlink) return sftp.status(reqid, STATUS_CODE.FAILURE)
    run(reqid, () => fs.symlinkSync(targetPath, local(linkPath)))
  })
  sftp.on('SETSTAT', (reqid, path, attrs) => {
    cfg.calls.push(`SETSTAT ${setKeys(attrs)}`)
    if (attrs.uid !== undefined && cfg.failChown) return sftp.status(reqid, STATUS_CODE.PERMISSION_DENIED)
    run(reqid, () => {
      if (attrs.mode !== undefined) fs.chmodSync(local(path), attrs.mode)
      if (attrs.mtime !== undefined) fs.utimesSync(local(path), attrs.atime, attrs.mtime)
    })
  })
}

function execAnswer(command: string): { code: number; out: string; err?: string } {
  if (command === 'uname -s') return cfg.os === 'linux' ? { code: 0, out: 'Linux\n' } : { code: 127, out: '', err: 'not found' }
  if (command === 'cmd /c ver') return cfg.os === 'windows' ? { code: 0, out: '\r\nMicrosoft Windows [Version 10.0.20348]\r\n' } : { code: 127, out: '' }
  if (command === 'id -u') return { code: 0, out: cfg.idOut }
  if (command === 'hostname') return { code: 0, out: 'guest-01\n' }
  return { code: 1, out: '' }
}

beforeAll(async () => {
  const { private: privateKey } = utils.generateKeyPairSync('ed25519')
  server = new Server({ hostKeys: [privateKey] }, client => {
    client.on('authentication', ctx => {
      if (ctx.method === 'password' && ctx.password === 'ok') ctx.accept()
      else if (ctx.method === 'keyboard-interactive') ctx.reject()
      else ctx.reject(['password'])
    })
    client.on('error', () => {})
    client.on('ready', () => {
      client.on('session', accept => {
        const session = accept()
        session.on('exec', (acceptExec, rejectExec, info) => {
          if (info.command === 'hostname' && cfg.hostnameFails) return rejectExec()
          const stream = acceptExec()
          const res = execAnswer(info.command)
          if (res.out) stream.write(res.out)
          if (res.err) stream.stderr.write(res.err)
          stream.exit(res.code)
          stream.end()
        })
        session.on('sftp', (acceptSftp, rejectSftp) => {
          if (cfg.noSftp) return rejectSftp()
          serveSftp(acceptSftp())
        })
      })
    })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  port = (server.address() as AddressInfo).port
})

afterAll(async () => {
  await new Promise<void>(resolve => server.close(() => resolve()))
})

beforeEach(() => {
  cfg = defaults()
  root = fs.mkdtempSync(join(tmpdir(), 'pxc-ssh-'))
})

const open: SshWriter[] = []

afterEach(async () => {
  while (open.length) await open.pop()!.close()
  fs.rmSync(root, { recursive: true, force: true })
})

const creds = () => ({ host: '127.0.0.1', port, username: 'root', password: 'ok' })
const log = vi.fn()

// The host key is fixed for the whole file: probe it once. A probe per
// writer doubled the handshakes and pushed the multi-writer tests past the
// default timeout on the CI runners.
let cachedFingerprint: string | null = null

async function fingerprint(): Promise<string> {
  if (cachedFingerprint) return cachedFingerprint
  const res = await probeSsh(creds(), 5_000)
  if (!res.ok || !res.hostKeyFingerprint) throw new Error('probe failed')
  cachedFingerprint = res.hostKeyFingerprint
  return cachedFingerprint
}

async function writer(over: Partial<ReturnType<typeof creds>> = {}): Promise<SshWriter> {
  const fp = await fingerprint()
  const w = await SshWriter.connect({ ...creds(), ...over, hostKeyFingerprint: fp }, 5_000, { log })
  open.push(w)
  return w
}

const body = (data: string | Buffer) => Readable.from([Buffer.from(data)])
const signal = () => new AbortController().signal

describe('probeSsh', () => {
  it('reports the OS, hostname and host key of a Linux guest', async () => {
    const res = await probeSsh(creds(), 5_000)
    expect(res).toMatchObject({ ok: true, os: 'linux', hostname: 'guest-01', details: { os: 'Linux' } })
    expect(res.ok && res.hostKeyFingerprint).toMatch(/^SHA256:/)
  })

  it('detects a Windows guest and survives a failing hostname', async () => {
    cfg.os = 'windows'
    cfg.hostnameFails = true
    const res = await probeSsh(creds(), 5_000)
    expect(res).toMatchObject({ ok: true, os: 'windows', hostname: undefined, details: { os: 'Microsoft Windows [Version 10.0.20348]' } })
  })

  it('refuses a guest that answers neither uname nor ver', async () => {
    cfg.os = 'none'
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await probeSsh(creds(), 5_000)
    expect(res).toMatchObject({ ok: false, errorClass: 'unsupported_os' })
    warn.mockRestore()
  })

  it('reports a guest without an SFTP server', async () => {
    cfg.noSftp = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await probeSsh(creds(), 5_000)
    expect(res).toMatchObject({ ok: false, errorClass: 'error', error: 'SSH connection failed' })
    warn.mockRestore()
  })

  it('classifies a wrong password', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = await probeSsh({ ...creds(), password: 'nope' }, 5_000)
    expect(res).toMatchObject({ ok: false, errorClass: 'auth_failed' })
    warn.mockRestore()
  })
})

describe('classifySshError', () => {
  it('handles non-Error values and key problems', () => {
    expect(classifySshError('Cannot parse privateKey: bad')).toMatchObject({ errorClass: 'auth_failed' })
    expect(classifySshError(new Error('getaddrinfo ENOTFOUND guest'))).toMatchObject({ errorClass: 'unreachable' })
    expect(classifySshError(42)).toMatchObject({ errorClass: 'error' })
  })
})

describe('SshWriter.connect', () => {
  it('requires a confirmed host key fingerprint', async () => {
    await expect(SshWriter.connect(creds(), 5_000, { log })).rejects.toThrow(/fingerprint missing/)
  })

  it('refuses a different host key', async () => {
    const err = await SshWriter.connect({ ...creds(), hostKeyFingerprint: 'SHA256:' + 'B'.repeat(43) }, 5_000, { log }).catch(e => e)
    expect(err).toBeInstanceOf(GuestWriterError)
    expect(classifySshError(err).errorClass).toBe('host_key')
  })

  it('closes the connection when the OS is unsupported', async () => {
    const fp = await fingerprint()
    cfg.os = 'none'
    await expect(SshWriter.connect({ ...creds(), hostKeyFingerprint: fp }, 5_000, { log })).rejects.toThrow(/Unsupported guest OS/)
  })

  it('describes the connection', async () => {
    const w = await writer()
    expect(w.os).toBe('linux')
    expect(w.description).toContain('SSH/SFTP as root, Linux, host key SHA256:')
    expect(w.fingerprint).toMatch(/^SHA256:/)
  })

  it('ignores an unparsable uid', async () => {
    cfg.idOut = 'uid=1000\n'
    const w = await writer()
    expect(w.os).toBe('linux')
  })

  it('runs commands with stderr and exit code', async () => {
    const w = await writer()
    const res = await sshExec((w as unknown as { client: Parameters<typeof sshExec>[0] }).client, 'uname -s')
    expect(res).toEqual({ code: 0, out: 'Linux\n', err: '' })
  })
})

describe('SshWriter on a Linux guest', () => {
  it('exists() tells present from absent and wraps other errors', async () => {
    const w = await writer()
    fs.writeFileSync(join(root, 'a.txt'), 'x')
    expect(await w.exists('/a.txt')).toBe(true)
    expect(await w.exists('/missing')).toBe(false)
    cfg.failStat = true
    await expect(w.exists('/a.txt')).rejects.toThrow(/Cannot stat \/a.txt/)
  })

  it('mkdirp() creates the tree once and caches it', async () => {
    const w = await writer()
    await w.mkdirp('/srv/data/deep')
    expect(fs.statSync(join(root, 'srv/data/deep')).isDirectory()).toBe(true)
    const before = cfg.calls.length
    await w.mkdirp('/srv/data/deep')
    await w.mkdirp('/srv/data')
    expect(cfg.calls.length).toBe(before)
  })

  it('mkdirp() accepts a directory created concurrently by the guest', async () => {
    const w = await writer()
    cfg.failMkdir = 'race'
    await w.mkdirp('/raced')
    expect(fs.statSync(join(root, 'raced')).isDirectory()).toBe(true)
  })

  it('mkdirp() reports a refused mkdir', async () => {
    const w = await writer()
    cfg.failMkdir = 'hard'
    await expect(w.mkdirp('/nope')).rejects.toThrow(/Cannot create directory \/nope/)
  })

  it('mkdirp() refuses a file in the way', async () => {
    const w = await writer()
    fs.writeFileSync(join(root, 'file'), 'x')
    await expect(w.mkdirp('/file/sub')).rejects.toThrow('/file exists and is not a directory')
  })

  it('mkdirp() follows a symlink owned by root or the SSH user, refuses another owner', async () => {
    fs.mkdirSync(join(root, 'real'))
    fs.symlinkSync(join(root, 'real'), join(root, 'link'))
    cfg.reportUid = 0
    const w = await writer()
    await w.mkdirp('/link/sub')
    expect(fs.statSync(join(root, 'real/sub')).isDirectory()).toBe(true)

    cfg.reportUid = 1000
    const w2 = await writer()
    await w2.mkdirp('/link/sub2')

    cfg.reportUid = 4242
    const w3 = await writer()
    await expect(w3.mkdirp('/link/sub3')).rejects.toThrow('Cannot use /link: it is a symlink owned by uid 4242')
  })

  it('writeFile() writes through a private temp file and renames it, with mode and mtime', async () => {
    const w = await writer()
    const onBytes = vi.fn()
    const mtime = new Date('2024-01-02T03:04:05Z')
    await w.writeFile('/hello.txt', body('hello world'), { mode: 0o100640, mtime, uid: 1, gid: 1 }, onBytes, signal())
    const st = fs.statSync(join(root, 'hello.txt'))
    expect(fs.readFileSync(join(root, 'hello.txt'), 'utf8')).toBe('hello world')
    expect(st.mode & 0o777).toBe(0o640)
    expect(Math.floor(st.mtimeMs / 1000)).toBe(mtime.getTime() / 1000)
    expect(onBytes).toHaveBeenCalledWith(11)
    expect(cfg.calls.some(c => /^OPEN \/\.pxc-[0-9a-f]{16}$/.test(c))).toBe(true)
    expect(cfg.calls).toContain('FSETSTAT gid,uid')
    expect(fs.readdirSync(root)).toEqual(['hello.txt'])
  })

  it('writeFile() keeps going when the chown is refused', async () => {
    const w = await writer()
    cfg.failChown = true
    await w.writeFile('/owned.txt', body('x'), { uid: 5, gid: 5 }, () => {}, signal())
    expect(fs.readFileSync(join(root, 'owned.txt'), 'utf8')).toBe('x')
  })

  it('writeFile() streams a large file over a full write window', async () => {
    const w = await writer()
    const data = Buffer.alloc(SFTP_WRITE_CHUNK * 70 + 123, 7)
    let total = 0
    await w.writeFile('/big.bin', Readable.from([data]), {}, n => { total += n }, signal())
    expect(total).toBe(data.length)
    expect(fs.statSync(join(root, 'big.bin')).size).toBe(data.length)
  })

  it('writeFile() overwrites through the extension when the server has it', async () => {
    const w = await writer()
    fs.writeFileSync(join(root, 'f.txt'), 'old')
    const sftp = (w as unknown as { sftp: { _extensions: Record<string, string> } }).sftp
    sftp._extensions['posix-rename@openssh.com'] = '1'
    await w.writeFile('/f.txt', body('new'), {}, () => {}, signal())
    expect(fs.readFileSync(join(root, 'f.txt'), 'utf8')).toBe('new')
    expect(cfg.calls).toContain('EXTENDED posix-rename@openssh.com')
  })

  it('writeFile() overwrites by unlink + rename without the extension', async () => {
    const w = await writer()
    fs.writeFileSync(join(root, 'f.txt'), 'old')
    await w.writeFile('/f.txt', body('new'), {}, () => {}, signal())
    expect(fs.readFileSync(join(root, 'f.txt'), 'utf8')).toBe('new')
    expect(cfg.calls).toContain('REMOVE /f.txt')
  })

  it('writeFile() removes the partial when the final rename fails', async () => {
    const w = await writer()
    cfg.failRename = 'always'
    await expect(w.writeFile('/f.txt', body('x'), {}, () => {}, signal())).rejects.toThrow(/Cannot move \/\.pxc-[0-9a-f]+ into place/)
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('writeFile() refuses a symlink target without overwrite, replaces it with overwrite', async () => {
    const w = await writer()
    fs.writeFileSync(join(root, 'real'), 'keep')
    fs.symlinkSync(join(root, 'real'), join(root, 'link'))
    await expect(w.writeFile('/link', body('x'), {}, () => {}, signal())).rejects.toThrow('Cannot write /link: refused, it is a symlink')
    await w.writeFile('/link', body('new'), {}, () => {}, signal(), { overwrite: true })
    expect(fs.lstatSync(join(root, 'link')).isSymbolicLink()).toBe(false)
    expect(fs.readFileSync(join(root, 'real'), 'utf8')).toBe('keep')
  })

  it('writeFile() refuses a directory target', async () => {
    const w = await writer()
    fs.mkdirSync(join(root, 'dir'))
    await expect(w.writeFile('/dir', body('x'), {}, () => {}, signal(), { overwrite: true })).rejects.toThrow('refused, it is a directory')
  })

  it('writeFile() reports a refused open', async () => {
    const w = await writer()
    cfg.failOpen = true
    await expect(w.writeFile('/x.txt', body('x'), {}, () => {}, signal())).rejects.toThrow(/Cannot create \/\.pxc-/)
  })

  it('writeFile() cleans up after a write error', async () => {
    const w = await writer()
    cfg.failWrite = true
    await expect(w.writeFile('/x.txt', body('x'), {}, () => {}, signal())).rejects.toThrow(/Cannot write \/\.pxc-/)
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('writeFile() stops on a cancelled job', async () => {
    const w = await writer()
    const ac = new AbortController()
    ac.abort()
    const err = await w.writeFile('/x.txt', body('x'), {}, () => {}, ac.signal).catch(e => e)
    expect(err).toBeInstanceOf(GuestWriterError)
    expect(err.message).toBe('Cancelled')
    expect(err.fatal).toBe(true)
    expect(fs.readdirSync(root)).toEqual([])
  })

  it('setMeta() applies mode, times and owner, never through a link', async () => {
    const w = await writer()
    fs.mkdirSync(join(root, 'd'))
    cfg.failChown = true
    const mtime = new Date('2023-05-06T07:08:09Z')
    await w.setMeta('/d', { mode: 0o40750, mtime, uid: 3, gid: 3 })
    const st = fs.statSync(join(root, 'd'))
    expect(st.mode & 0o777).toBe(0o750)
    expect(Math.floor(st.mtimeMs / 1000)).toBe(mtime.getTime() / 1000)
    expect(cfg.calls).toContain('SETSTAT gid,uid')

    fs.symlinkSync(join(root, 'd'), join(root, 'l'))
    cfg.calls = []
    await w.setMeta('/l', { mode: 0o700 })
    await w.setMeta('/missing', { mode: 0o700 })
    expect(cfg.calls.filter(c => c.startsWith('SETSTAT'))).toEqual([])
  })

  it('symlink() replaces a file, refuses a directory, wraps failures', async () => {
    const w = await writer()
    fs.writeFileSync(join(root, 'l'), 'x')
    await w.symlink('/l', '/etc/target')
    expect(fs.readlinkSync(join(root, 'l'))).toBe('/etc/target')
    fs.mkdirSync(join(root, 'dir'))
    await expect(w.symlink('/dir', 't')).rejects.toThrow('refused, it is a directory')
    cfg.failSymlink = true
    await expect(w.symlink('/other', 't')).rejects.toThrow('Cannot create symlink /other')
    cfg.failSymlink = false
    cfg.failRemove = true
    await expect(w.symlink('/l', 't')).rejects.toThrow('Cannot create symlink /l')
  })

  it('refuses every operation once closed', async () => {
    const w = await writer()
    await w.close()
    await w.close()
    await expect(w.exists('/a')).rejects.toThrow('SSH connection closed')
    await expect(w.writeFile('/a', body('x'), {}, () => {}, signal())).rejects.toThrow('SSH connection closed')
  })
})

describe('SshWriter on a Windows guest', () => {
  beforeEach(() => { cfg.os = 'windows' })

  it('maps drive paths to SFTP form and skips the drive in mkdirp', async () => {
    const w = await writer()
    expect(w.os).toBe('windows')
    expect(w.sftpPath('C:\\Users\\a.txt')).toBe('/C:/Users/a.txt')
    await w.mkdirp('C:\\Restore\\Docs')
    expect(fs.statSync(join(root, 'Restore/Docs')).isDirectory()).toBe(true)
    expect(cfg.calls).not.toContain('LSTAT /C:')
  })

  it('writes a file at the drive root and in a folder, without unix mode', async () => {
    const w = await writer()
    fs.mkdirSync(join(root, 'Docs'))
    await w.writeFile('C:\\Docs\\a.txt', body('win'), { mode: 0o100600, uid: 1, gid: 1 }, () => {}, signal())
    expect(fs.readFileSync(join(root, 'Docs/a.txt'), 'utf8')).toBe('win')
    expect(cfg.calls).not.toContain('FSETSTAT gid,uid')
    await w.writeFile('C:x.txt', body('root'), {}, () => {}, signal())
    expect(fs.readFileSync(join(root, 'x.txt'), 'utf8')).toBe('root')
  })

  it('refuses symlinked components and skips symlinks', async () => {
    fs.mkdirSync(join(root, 'real'))
    fs.symlinkSync(join(root, 'real'), join(root, 'link'))
    cfg.reportUid = 0
    const w = await writer()
    await expect(w.mkdirp('C:\\link\\x')).rejects.toThrow(/symlink owned by uid 0/)
    log.mockClear()
    await w.symlink('C:\\l', 'C:\\t')
    expect(log).toHaveBeenCalledWith('warn', 'Symlink skipped on Windows: C:\\l')
  })

  it('setMeta() only sets the times', async () => {
    const w = await writer()
    fs.mkdirSync(join(root, 'd'))
    await w.setMeta('C:\\d', { mode: 0o700, mtime: new Date('2022-01-01T00:00:00Z'), uid: 1, gid: 1 })
    expect(cfg.calls.filter(c => c.startsWith('SETSTAT'))).toEqual(['SETSTAT atime,mtime'])
  })
})
