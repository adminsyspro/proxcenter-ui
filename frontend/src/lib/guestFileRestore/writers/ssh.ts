// src/lib/guestFileRestore/writers/ssh.ts
//
// Guest writer over SSH/SFTP with credentials given for the job (memory only,
// never persisted). Works for VMs and containers, Linux (any POSIX guest with
// an SFTP server) and Windows (OpenSSH for Windows, SFTP paths `/C:/...`).
// The host key is pinned per job: the probe reports the fingerprint the
// guest presents, the operator confirms it in the dialog, and the job's
// connection refuses any other key. Guests are not written to the host key
// store.

import { createHash, randomBytes } from 'node:crypto'
import type { Readable } from 'node:stream'

import { Client } from 'ssh2'
import type { ConnectConfig, SFTPWrapper, Stats } from 'ssh2'

import { stripTrailing } from '../paths'
import { chunkStream } from '../stream'
import type { GuestFileRestoreProbeResult, GuestOs, GuestRestoreSshCredentials, SshProbeErrorClass } from '../types'
import { GuestWriterError, errorMessage, type GuestWriter, type WriteMeta, type WriteOptions } from './writer'

// Same keepalive policy as src/lib/ssh/exec.ts: a probe every 15 s, dead
// after 4 unanswered ones, so a dropped link fails fast instead of hanging.
const SSH_KEEPALIVE_INTERVAL_MS = 15_000
const SSH_KEEPALIVE_COUNT_MAX = 4

/** SFTP status code of "no such file". */
const SFTP_NO_SUCH_FILE = 2

/** Directory part of a guest path, native separators, without the trailing separator. */
function guestDirOf(path: string, os: GuestOs): string {
  const i = os === 'windows' ? Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/')) : path.lastIndexOf('/')
  if (i <= 0) return os === 'windows' ? path.slice(0, 2) : ''
  return path.slice(0, i)
}

/**
 * One SFTP WRITE per chunk (ssh2 splits anything above ~32 KiB into
 * sequential packets) and up to 64 of them in flight: a 2 MiB window, so a
 * large file is not paced by one round trip per packet.
 */
export const SFTP_WRITE_CHUNK = 32 * 1024 - 256
export const SFTP_WRITE_WINDOW = 64

export interface SshConnection {
  client: Client
  fingerprint: string
}

export function sshFingerprint(key: Buffer): string {
  return 'SHA256:' + stripTrailing(createHash('sha256').update(key).digest('base64'), '=')
}

/** True when the presented key is the one the operator confirmed. */
export function hostKeyMatches(key: Buffer, expectedFingerprint: string): boolean {
  return sshFingerprint(key) === expectedFingerprint.trim()
}

export const HOST_KEY_MISMATCH_MESSAGE = 'SSH host key does not match the fingerprint confirmed in the dialog'

/** Generic class of an SSH failure, so a probe never echoes raw socket text. */
export function classifySshError(err: unknown): { errorClass: SshProbeErrorClass; message: string } {
  const raw = errorMessage(err)
  if (raw.includes(HOST_KEY_MISMATCH_MESSAGE)) return { errorClass: 'host_key', message: HOST_KEY_MISMATCH_MESSAGE }
  if (/authentication methods failed|authentication failed|permission denied|cannot parse privateKey|encrypted private key|bad passphrase|passphrase/i.test(raw)) {
    return { errorClass: 'auth_failed', message: 'SSH authentication failed: check the user name, password or private key' }
  }
  if (/timed out|timeout|ETIMEDOUT/i.test(raw)) return { errorClass: 'timeout', message: 'SSH connection timed out' }
  if (/ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|EAI_AGAIN|ECONNRESET|connection closed/i.test(raw)) {
    return { errorClass: 'unreachable', message: 'SSH host unreachable: check the address, the port and the firewall' }
  }
  if (/unsupported guest os/i.test(raw)) return { errorClass: 'unsupported_os', message: 'Unsupported guest OS over SSH: only Linux and Windows guests are supported' }
  return { errorClass: 'error', message: 'SSH connection failed' }
}

/**
 * Open the connection. With `expectedFingerprint` (a job) the host key must
 * match it; without (a probe) the key is accepted and reported.
 */
export function connectSsh(creds: GuestRestoreSshCredentials, connectTimeoutMs: number, expectedFingerprint?: string): Promise<SshConnection> {
  return new Promise((resolve, reject) => {
    const client = new Client()
    let fingerprint = ''
    let mismatch = false
    let settled = false
    const fail = (err: unknown) => {
      if (settled) return
      settled = true
      try { client.end() } catch { /* already closed */ }
      if (mismatch) {
        reject(new GuestWriterError(`${HOST_KEY_MISMATCH_MESSAGE} (presented ${fingerprint}, expected ${expectedFingerprint})`, true))
        return
      }
      reject(new GuestWriterError(`SSH connection failed: ${errorMessage(err)}`, true))
    }
    client.on('ready', () => {
      if (settled) return
      settled = true
      resolve({ client, fingerprint })
    })
    client.on('error', fail)
    client.on('close', () => fail(new Error('connection closed')))
    client.on('keyboard-interactive', (_name, _instructions, _lang, _prompts, finish) => {
      finish([creds.password ?? ''])
    })

    const cfg: ConnectConfig = {
      host: creds.host,
      port: creds.port ?? 22,
      username: creds.username,
      readyTimeout: connectTimeoutMs,
      keepaliveInterval: SSH_KEEPALIVE_INTERVAL_MS,
      keepaliveCountMax: SSH_KEEPALIVE_COUNT_MAX,
      hostVerifier: (key: Buffer) => {
        fingerprint = sshFingerprint(key)
        if (expectedFingerprint === undefined) return true
        mismatch = !hostKeyMatches(key, expectedFingerprint)
        return !mismatch
      },
    }
    if (creds.privateKey) {
      cfg.privateKey = creds.privateKey
      if (creds.passphrase) cfg.passphrase = creds.passphrase
    }
    if (creds.password) {
      cfg.password = creds.password
      cfg.tryKeyboard = true
    }
    try {
      client.connect(cfg)
    } catch (err) {
      fail(err)
    }
  })
}

export interface SshExecResult {
  code: number
  out: string
  err: string
}

export function sshExec(client: Client, command: string): Promise<SshExecResult> {
  return new Promise((resolve, reject) => {
    client.exec(command, (err, stream) => {
      if (err) return reject(err)
      let out = ''
      let errOut = ''
      stream.on('data', (d: Buffer) => { out += d.toString() })
      stream.stderr.on('data', (d: Buffer) => { errOut += d.toString() })
      stream.on('close', (code: number | null) => resolve({ code: code ?? -1, out, err: errOut }))
      stream.on('error', reject)
    })
  })
}

/** Linux first (`uname -s`), then Windows (`cmd /c ver`); anything else is refused. */
export async function detectSshOs(client: Client): Promise<{ os: GuestOs; label: string }> {
  const uname = await sshExec(client, 'uname -s')
  if (uname.code === 0 && uname.out.trim()) {
    return { os: 'linux', label: uname.out.trim() }
  }
  const ver = await sshExec(client, 'cmd /c ver')
  if (/windows/i.test(ver.out)) {
    return { os: 'windows', label: ver.out.trim().split(/\r?\n/).filter(Boolean)[0] || 'Windows' }
  }
  throw new GuestWriterError('Unsupported guest OS over SSH: neither a POSIX `uname` nor a Windows shell answered', true)
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => (err ? reject(new GuestWriterError(`SFTP not available: ${err.message}`, true)) : resolve(sftp)))
  })
}

export async function probeSsh(creds: GuestRestoreSshCredentials, connectTimeoutMs: number): Promise<GuestFileRestoreProbeResult> {
  let conn: SshConnection | null = null
  try {
    conn = await connectSsh(creds, connectTimeoutMs)
    const info = await detectSshOs(conn.client)
    const sftp = await openSftp(conn.client)
    sftp.end()
    let hostname: string | undefined
    try {
      const res = await sshExec(conn.client, 'hostname')
      hostname = res.out.trim() || undefined
    } catch {
      // optional
    }
    return { ok: true, os: info.os, hostname, hostKeyFingerprint: conn.fingerprint, details: { fingerprint: conn.fingerprint, os: info.label } }
  } catch (err) {
    const { errorClass, message } = classifySshError(err)
    console.warn(`[guest-file-restore] ssh probe failed (${errorClass}): ${errorMessage(err).replace(/[\r\n]+/g, ' ').slice(0, 300)}`)
    return { ok: false, error: message, errorClass }
  } finally {
    conn?.client.end()
  }
}

export interface SshWriterOptions {
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
}

export class SshWriter implements GuestWriter {
  readonly os: GuestOs
  readonly description: string
  readonly fingerprint: string
  /** Files the runner may keep in flight: every SFTP request is independent. */
  readonly pipelineDepth = 32

  private closed = false
  private readonly knownDirs = new Set<string>()

  private constructor(
    private readonly client: Client,
    private readonly sftp: SFTPWrapper,
    info: { os: GuestOs; label: string },
    fingerprint: string,
    private readonly username: string,
    /** Numeric uid of the SSH user (linux), for the symlink owner check. */
    private readonly uid: number | null,
    private readonly opts: SshWriterOptions,
  ) {
    this.os = info.os
    this.fingerprint = fingerprint
    this.description = `SSH/SFTP as ${username}, ${info.label}, host key ${fingerprint}`
    client.on('close', () => { this.closed = true })
    client.on('error', () => { this.closed = true })
  }

  static async connect(creds: GuestRestoreSshCredentials, connectTimeoutMs: number, opts: SshWriterOptions): Promise<SshWriter> {
    if (!creds.hostKeyFingerprint) {
      throw new GuestWriterError('SSH host key fingerprint missing: run the connection test and confirm the host key first', true)
    }
    const { client, fingerprint } = await connectSsh(creds, connectTimeoutMs, creds.hostKeyFingerprint)
    try {
      const info = await detectSshOs(client)
      const sftp = await openSftp(client)
      let uid: number | null = null
      if (info.os === 'linux') {
        const res = await sshExec(client, 'id -u').catch(() => null)
        if (res && res.code === 0 && /^\d+\s*$/.test(res.out)) uid = Number(res.out.trim())
      }
      return new SshWriter(client, sftp, info, fingerprint, creds.username, uid, opts)
    } catch (err) {
      client.end()
      throw err
    }
  }

  /** SFTP form of a guest path: Windows `C:\a\b` becomes `/C:/a/b`. */
  sftpPath(path: string): string {
    return this.os === 'windows' ? '/' + path.replace(/\\/g, '/') : path
  }

  private op<T>(run: (cb: (err: Error | null | undefined, value?: T) => void) => void): Promise<T> {
    if (this.closed) return Promise.reject(new GuestWriterError('SSH connection closed', true))
    return new Promise<T>((resolve, reject) => {
      try {
        run((err, value) => (err ? reject(err) : resolve(value as T)))
      } catch (err) {
        reject(err)
      }
    })
  }

  private wrap(err: unknown, what: string): GuestWriterError {
    if (err instanceof GuestWriterError) return err
    return new GuestWriterError(`${what}: ${errorMessage(err)}`, this.closed)
  }

  private async tryStat(path: string): Promise<Stats | null> {
    try {
      return await this.op<Stats>(cb => this.sftp.stat(this.sftpPath(path), cb))
    } catch (err) {
      if ((err as { code?: number }).code === SFTP_NO_SUCH_FILE) return null
      throw this.wrap(err, `Cannot stat ${path}`)
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.op<Stats>(cb => this.sftp.lstat(this.sftpPath(path), cb))
      return true
    } catch (err) {
      if ((err as { code?: number }).code === SFTP_NO_SUCH_FILE) return false
      throw this.wrap(err, `Cannot stat ${path}`)
    }
  }

  private async tryLstat(path: string): Promise<Stats | null> {
    try {
      return await this.op<Stats>(cb => this.sftp.lstat(this.sftpPath(path), cb))
    } catch (err) {
      if ((err as { code?: number }).code === SFTP_NO_SUCH_FILE) return null
      throw this.wrap(err, `Cannot stat ${path}`)
    }
  }

  /**
   * A symlinked component is only accepted when root or the SSH user owns
   * it: a merged-usr guest links /bin to /usr/bin, while a link planted by
   * another local user would redirect the restore.
   */
  private symlinkTrusted(st: Stats): boolean {
    if (this.os !== 'linux') return false
    const owner = (st as { uid?: number }).uid
    return owner === 0 || (this.uid !== null && owner === this.uid)
  }

  async mkdirp(path: string): Promise<void> {
    if (this.knownDirs.has(path)) return
    const segs = path.split(/[\\/]+/).filter(Boolean)
    let cur = ''
    for (const seg of segs) {
      if (this.os === 'windows') {
        cur = cur ? `${cur}\\${seg}` : seg
        if (/^[A-Za-z]:$/.test(cur)) continue
      } else {
        cur = `${cur}/${seg}`
      }
      if (this.knownDirs.has(cur)) continue
      let st = await this.tryLstat(cur)
      if (!st) {
        try {
          await this.op<void>(cb => this.sftp.mkdir(this.sftpPath(cur), cb))
        } catch (err) {
          // Lost a race with the guest itself: fine as long as it is a directory now.
          st = await this.tryLstat(cur)
          if (!st) throw this.wrap(err, `Cannot create directory ${cur}`)
        }
      }
      if (st?.isSymbolicLink()) {
        if (!this.symlinkTrusted(st)) {
          throw new GuestWriterError(`Cannot use ${cur}: it is a symlink owned by uid ${(st as { uid?: number }).uid ?? '?'}`)
        }
        st = await this.tryStat(cur)
      }
      if (st && !st.isDirectory()) {
        throw new GuestWriterError(`${cur} exists and is not a directory`)
      }
      this.knownDirs.add(cur)
    }
    this.knownDirs.add(path)
  }

  private async unlinkQuiet(path: string): Promise<void> {
    try {
      await this.op<void>(cb => this.sftp.unlink(this.sftpPath(path), cb))
    } catch (err) {
      if ((err as { code?: number }).code !== SFTP_NO_SUCH_FILE) throw err
    }
  }

  /** Move the partial onto its target: posix-rename when the server has it, else unlink + rename. */
  private async replace(partial: string, target: string): Promise<void> {
    const src = this.sftpPath(partial)
    const dst = this.sftpPath(target)
    try {
      await this.op<void>(cb => this.sftp.rename(src, dst, cb))
      return
    } catch {
      // target probably exists (overwrite): fall through
    }
    try {
      await this.op<void>(cb => this.sftp.ext_openssh_rename(src, dst, cb))
      return
    } catch {
      // extension not supported
    }
    try {
      await this.unlinkQuiet(target)
      await this.op<void>(cb => this.sftp.rename(src, dst, cb))
    } catch (err) {
      await this.unlinkQuiet(partial).catch(() => {})
      throw this.wrap(err, `Cannot move ${partial} into place`)
    }
  }

  /** Attributes set on the open handle in one request (owner only as root: anything else is refused as a whole). */
  private handleAttrs(meta: WriteMeta): Record<string, number> | null {
    const attrs: Record<string, number> = {}
    if (this.os === 'linux' && meta.mode !== undefined) attrs.mode = meta.mode & 0o7777
    if (meta.mtime) {
      const t = Math.floor(meta.mtime.getTime() / 1000)
      attrs.atime = t
      attrs.mtime = t
    }
    if (this.os === 'linux' && this.username === 'root' && meta.uid !== undefined && meta.gid !== undefined) {
      attrs.uid = meta.uid
      attrs.gid = meta.gid
    }
    return Object.keys(attrs).length > 0 ? attrs : null
  }

  /**
   * Streams `body` into `<path>.pxc-partial` with pipelined SFTP writes,
   * sets the attributes on the open handle, closes it and renames it onto
   * the target: three round trips per file on top of the data, and every
   * request is independent so the runner may overlap several files.
   */
  async writeFile(path: string, body: Readable, meta: WriteMeta, onBytes: (n: number) => void, signal: AbortSignal, opts: WriteOptions = {}): Promise<void> {
    if (this.closed) throw new GuestWriterError('SSH connection closed', true)
    // What is at the target decides before a byte moves: a symlink is only
    // replaced (by the rename, never written through) with overwrite, a
    // directory never.
    const at = await this.tryLstat(path)
    if (at?.isSymbolicLink() && opts.overwrite !== true) {
      body.destroy()
      throw new GuestWriterError(`Cannot write ${path}: refused, it is a symlink`)
    }
    if (at?.isDirectory()) {
      body.destroy()
      throw new GuestWriterError(`Cannot write ${path}: refused, it is a directory`)
    }
    // Unpredictable name, created exclusively: an existing path (planted or
    // not) fails the open instead of being followed or truncated.
    const partial = `${guestDirOf(path, this.os)}${this.os === 'windows' ? '\\' : '/'}.pxc-${randomBytes(8).toString('hex')}`
    const sp = this.sftpPath(partial)
    let handle: Buffer
    try {
      handle = await this.op<Buffer>(cb => this.sftp.open(sp, 'wx', this.os === 'linux' && meta.mode !== undefined ? meta.mode & 0o7777 : 0o644, cb))
    } catch (err) {
      body.destroy()
      throw this.wrap(err, `Cannot create ${partial}`)
    }

    const inflight = new Set<Promise<void>>()
    let failure: unknown = null
    let handleOpen = true
    const onAbort = () => body.destroy(new Error('Cancelled'))
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      let position = 0
      for await (const chunk of chunkStream(body, SFTP_WRITE_CHUNK)) {
        if (failure) throw failure
        if (signal.aborted) throw new GuestWriterError('Cancelled', true)
        const at = position
        position += chunk.length
        const write: Promise<void> = this.op<void>(cb => this.sftp.write(handle, chunk, 0, chunk.length, at, cb))
          .then(() => onBytes(chunk.length))
          .catch(err => { failure ??= err })
          .finally(() => inflight.delete(write))
        inflight.add(write)
        if (inflight.size >= SFTP_WRITE_WINDOW) await Promise.race(inflight)
      }
      await Promise.all(inflight)
      if (failure) throw failure
      if (signal.aborted) throw new GuestWriterError('Cancelled', true)
      // Attributes go on the open handle, before the rename: nothing is done
      // on the final path afterwards. Owner last and alone, so a refused
      // chown (not root) does not take mode and times down with it.
      const attrs = this.handleAttrs(meta)
      const { uid, gid, ...rest } = attrs ?? {}
      const setstat = (async () => {
        if (Object.keys(rest).length > 0) await this.op<void>(cb => this.sftp.fsetstat(handle, rest, cb)).catch(() => {})
        if (uid !== undefined && gid !== undefined) await this.op<void>(cb => this.sftp.fsetstat(handle, { uid, gid }, cb)).catch(() => {})
      })()
      handleOpen = false
      const close = setstat.then(() => this.op<void>(cb => this.sftp.close(handle, cb)))
      await close
    } catch (err) {
      await Promise.allSettled(inflight)
      if (handleOpen) await this.op<void>(cb => this.sftp.close(handle, cb)).catch(() => {})
      await this.unlinkQuiet(partial).catch(() => {})
      if (signal.aborted) throw new GuestWriterError('Cancelled', true)
      throw this.wrap(err, `Cannot write ${partial}`)
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
    await this.replace(partial, path)
  }

  /** Mode, times and owner of a directory the job created; never through a link. */
  private async applyMeta(path: string, meta: WriteMeta): Promise<void> {
    const p = this.sftpPath(path)
    const st = await this.tryLstat(path)
    if (!st || st.isSymbolicLink()) return
    if (this.os === 'linux' && meta.mode !== undefined) {
      await this.op<void>(cb => this.sftp.chmod(p, meta.mode! & 0o7777, cb)).catch(() => {})
    }
    if (meta.mtime) {
      const t = Math.floor(meta.mtime.getTime() / 1000)
      await this.op<void>(cb => this.sftp.utimes(p, t, t, cb)).catch(() => {})
    }
    if (this.os === 'linux' && this.username === 'root' && meta.uid !== undefined && meta.gid !== undefined) {
      await this.op<void>(cb => this.sftp.chown(p, meta.uid!, meta.gid!, cb)).catch(() => {})
    }
  }

  async setMeta(path: string, meta: WriteMeta): Promise<void> {
    await this.applyMeta(path, meta)
  }

  // SFTP has no lchown: the link belongs to the SSH user.
  async symlink(path: string, target: string): Promise<void> {
    if (this.os === 'windows') {
      this.opts.log('warn', `Symlink skipped on Windows: ${path}`)
      return
    }
    const at = await this.tryLstat(path)
    if (at?.isDirectory()) throw new GuestWriterError(`Cannot create symlink ${path}: refused, it is a directory`)
    try {
      await this.unlinkQuiet(path)
      await this.op<void>(cb => this.sftp.symlink(target, this.sftpPath(path), cb))
    } catch (err) {
      throw this.wrap(err, `Cannot create symlink ${path}`)
    }
  }

  close(): Promise<void> {
    try { this.sftp.end() } catch { /* already gone */ }
    try { this.client.end() } catch { /* already gone */ }
    this.closed = true
    return Promise.resolve()
  }
}
