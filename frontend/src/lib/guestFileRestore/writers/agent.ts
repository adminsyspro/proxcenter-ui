// src/lib/guestFileRestore/writers/agent.ts
//
// Guest writer over the QEMU guest agent (PVE API, no credential). Bytes go
// through `agent/file-write` (content is base64, 60 KiB max per call, so
// 46080 raw bytes); everything else is an `agent/exec` with an argv array,
// never a shell string built from a guest path. Linux gets `sh -c SCRIPT sh
// args...`, Windows a base64-encoded PowerShell script reading its
// parameters as JSON on stdin (`input-data`).
//
// The agent runs as root in the guest and `file-write` opens its path for
// writing, following any symlink a local user planted there. So nothing is
// ever written at a predictable or user-reachable path: every file is
// assembled, with its metadata, inside a staging directory created by
// `mktemp -d` (root only), then moved onto its target with one rename, which
// replaces a symlink instead of writing through it. A symlink or a directory
// at the target is refused unless the policy is overwrite, and the
// destination tree is checked for symlinked components not owned by root.

import type { Readable } from 'node:stream'

import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { getOsType } from '@/lib/proxmox/guestOs'

import { joinGuestPath } from '../paths'
import { chunkStream, sleep } from '../stream'
import type { GuestFileRestoreProbeResult, GuestOs } from '../types'
import { GuestWriterError, errorMessage, type GuestWriter, type WriteMeta, type WriteOptions } from './writer'

/** 46080 raw bytes = 61440 base64 chars = the `content` maxLength of file-write. */
export const AGENT_CHUNK_BYTES = 46080
export const AGENT_EXEC_TIMEOUT_MS = 120_000
/** Staged parts appended to the partial file per exec (keeps argv far below the 512 KiB POST limit). */
export const AGENT_APPEND_BATCH = 128

export interface AgentTarget {
  conn: PveConn
  node: string
  vmid: number
}

export interface AgentExecResult {
  exitcode: number
  out: string
  err: string
  truncated: boolean
}

/** Indirection so tests can shorten the exec-status polling. */
export const _impl = { sleep }

function agentPath(t: AgentTarget, cmd: string): string {
  return `/nodes/${encodeURIComponent(t.node)}/qemu/${encodeURIComponent(String(t.vmid))}/agent/${cmd}`
}

const FATAL_RE = /guest agent is not running|not running|no qemu guest agent|timed out|timeout|econn|ehostunreach|enotfound|aborted|cancel/i

function classify(err: unknown): GuestWriterError {
  if (err instanceof GuestWriterError) return err
  const msg = errorMessage(err)
  return new GuestWriterError(msg, FATAL_RE.test(msg))
}

export async function agentExec(
  target: AgentTarget,
  command: string[],
  inputData: string | undefined,
  signal: AbortSignal,
  timeoutMs = AGENT_EXEC_TIMEOUT_MS,
): Promise<AgentExecResult> {
  const body: Record<string, unknown> = { command }
  if (inputData !== undefined) body['input-data'] = inputData

  let started: { pid?: number } | null
  try {
    started = await pveFetch<{ pid?: number } | null>(target.conn, agentPath(target, 'exec'), {
      method: 'POST',
      body: JSON.stringify(body),
      signal,
    })
  } catch (err) {
    throw classify(err)
  }
  const pid = started?.pid
  if (typeof pid !== 'number') throw new GuestWriterError('Guest agent exec returned no pid', true)

  const deadline = Date.now() + timeoutMs
  let delay = 100
  for (;;) {
    if (signal.aborted) throw new GuestWriterError('Cancelled', true)
    let status: any
    try {
      status = await pveFetch<any>(target.conn, agentPath(target, `exec-status?pid=${pid}`), { signal })
    } catch (err) {
      throw classify(err)
    }
    if (status?.exited) {
      return {
        exitcode: Number(status.exitcode ?? -1),
        out: String(status['out-data'] ?? ''),
        err: String(status['err-data'] ?? ''),
        truncated: Boolean(status['out-truncated']),
      }
    }
    if (Date.now() > deadline) {
      throw new GuestWriterError(`Guest command timed out after ${Math.round(timeoutMs / 1000)} s`)
    }
    await _impl.sleep(delay, signal)
    delay = Math.min(1000, delay * 2)
  }
}

// ---- command catalogue ------------------------------------------------------

/** Exit codes of the guest scripts that name a refusal (anything else is the tool's own failure). */
export const GUEST_EXIT = {
  /** The target or a path component is a symlink the policy does not allow. */
  symlink: 3,
  /** The target is a directory. */
  directory: 5,
} as const

/**
 * Walk `$1` component by component: a symlinked component must belong to
 * root (merged-usr guests link /bin to /usr/bin; a user cannot plant a
 * root-owned link). Exit 3 otherwise, 2 when it cannot be told.
 */
const SH_CHECK_COMPONENTS = 'p=""; o=$IFS; IFS=/; for c in $1; do [ -n "$c" ] || continue; p="$p/$c"; if [ -L "$p" ]; then u=$(stat -c %u -- "$p" 2>/dev/null) || exit 2; [ "$u" = 0 ] || { echo "$p is a symlink owned by uid $u" >&2; exit 3; }; fi; done; IFS=$o'

/** POSIX sh snippets; guest paths arrive as positional parameters. */
export const SH = {
  exists: 'test -e "$1" || test -L "$1"',
  // The tree is checked before mkdir (so nothing is created through a planted
  // link) and again after it.
  mkdirp: `${SH_CHECK_COMPONENTS}; mkdir -p -- "$1" || exit 1; ${SH_CHECK_COMPONENTS}; [ -d "$1" ] || exit 4; exit 0`,
  // $1 = template; prints the directory (0700, root).
  mktempDir: 'mktemp -d -- "$1"',
  // $1 = staged file, $2.. = staged parts appended in order then deleted.
  append: 't="$1"; shift; cat -- "$@" >> "$t" && rm -f -- "$@"',
  // $1 = staged file, $2 = target, $3 = octal mode, $4 = uid:gid, $5 = mtime
  // epoch (each optional), $6 = 1 when the policy is overwrite. Metadata is
  // set on the staged file, then one rename: a symlink at the target is
  // replaced, never followed; a directory is refused.
  finish: 's="$1"; t="$2"; if [ -L "$t" ] && [ "$6" != 1 ]; then echo "$t is a symlink" >&2; exit 3; fi; if [ -d "$t" ] && [ ! -L "$t" ]; then echo "$t is a directory" >&2; exit 5; fi; if [ -n "$3" ]; then chmod "$3" -- "$s" || exit 1; fi; if [ -n "$4" ]; then chown -h "$4" -- "$s" 2>/dev/null; fi; if [ -n "$5" ]; then touch -d "@$5" -- "$s" 2>/dev/null; fi; mv -fT -- "$s" "$t"',
  // $2 = octal mode, $3 = uid:gid, $4 = mtime epoch; for a directory the job created, never through a link.
  meta: 'f="$1"; if [ -L "$f" ]; then exit 3; fi; if [ -n "$2" ]; then chmod "$2" -- "$f" 2>/dev/null; fi; if [ -n "$3" ]; then chown -h "$3" -- "$f" 2>/dev/null; fi; if [ -n "$4" ]; then touch -d "@$4" -- "$f" 2>/dev/null; fi; exit 0',
  // $3 = uid:gid or empty; chown -h changes the link, never what it points to.
  symlink: 'if [ -d "$1" ] && [ ! -L "$1" ]; then echo "$1 is a directory" >&2; exit 5; fi; ln -sfn -- "$2" "$1" || exit $?; if [ -n "$3" ]; then chown -h "$3" -- "$1" 2>/dev/null; fi; exit 0',
  rmrf: 'if [ -d "$1" ] && [ ! -L "$1" ]; then rm -rf -- "$1"; fi',
  hostname: 'hostname 2>/dev/null || cat /etc/hostname 2>/dev/null',
  owner: 'stat -c %u:%g -- "$1"',
}

/** Any reparse point (symlink, junction) among the components of $p fails with 3. */
const PS_CHECK_COMPONENTS =
  '$acc=""; foreach ($c in ($p -split "[\\\\/]+")) { if (-not $c) { continue }; $acc = if ($acc) { $acc + "\\" + $c } else { $c }; if ($acc -match "^[A-Za-z]:$") { continue }; ' +
  '$it=Get-Item -LiteralPath $acc -Force -ErrorAction SilentlyContinue; if ($it -and ($it.Attributes -band [IO.FileAttributes]::ReparsePoint)) { [Console]::Error.WriteLine("$acc is a reparse point"); exit 3 } }'

/** PowerShell snippets; parameters come as a JSON object on stdin. */
export const PS = {
  exists: '$j=[Console]::In.ReadToEnd()|ConvertFrom-Json; if (Test-Path -LiteralPath $j.path) { exit 0 } else { exit 1 }',
  mkdirp:
    '$j=[Console]::In.ReadToEnd()|ConvertFrom-Json; $p=[string]$j.path; ' +
    `${PS_CHECK_COMPONENTS}; New-Item -ItemType Directory -Force -LiteralPath $p | Out-Null; ${PS_CHECK_COMPONENTS}; exit 0`,
  // A fresh GUID-named directory under TEMP; fails if it already exists.
  mktempDir:
    "$ErrorActionPreference='Stop'; $d=Join-Path $env:TEMP ('pxc-restore-' + [guid]::NewGuid().ToString('N')); " +
    'New-Item -ItemType Directory -Path $d | Out-Null; Write-Output $d',
  append:
    "$ErrorActionPreference='Stop'; $j=[Console]::In.ReadToEnd()|ConvertFrom-Json; " +
    '$out=[IO.File]::Open([string]$j.target,[IO.FileMode]::Append); ' +
    'try { foreach ($p in @($j.parts)) { $in=[IO.File]::OpenRead([string]$p); try { $in.CopyTo($out) } finally { $in.Dispose() } } } finally { $out.Dispose() }; ' +
    'foreach ($p in @($j.parts)) { Remove-Item -LiteralPath $p -Force -ErrorAction SilentlyContinue }; exit 0',
  // staged -> target: mtime on the staged file first, then one move; a reparse
  // point at the target is refused unless overwrite, a directory always.
  finish:
    "$ErrorActionPreference='Stop'; $j=[Console]::In.ReadToEnd()|ConvertFrom-Json; $t=[string]$j.target; $s=[string]$j.staged; " +
    '$it=Get-Item -LiteralPath $t -Force -ErrorAction SilentlyContinue; ' +
    'if ($it -and ($it.Attributes -band [IO.FileAttributes]::ReparsePoint) -and -not $j.overwrite) { [Console]::Error.WriteLine("$t is a reparse point"); exit 3 }; ' +
    'if ($it -and $it.PSIsContainer -and -not ($it.Attributes -band [IO.FileAttributes]::ReparsePoint)) { [Console]::Error.WriteLine("$t is a directory"); exit 5 }; ' +
    'if ($j.mtime) { (Get-Item -LiteralPath $s).LastWriteTimeUtc=[DateTimeOffset]::FromUnixTimeSeconds([int64]$j.mtime).UtcDateTime }; ' +
    'Move-Item -LiteralPath $s -Destination $t -Force; exit 0',
  meta:
    '$j=[Console]::In.ReadToEnd()|ConvertFrom-Json; $it=Get-Item -LiteralPath $j.path -Force; if ($it.Attributes -band [IO.FileAttributes]::ReparsePoint) { exit 3 }; ' +
    'if ($j.mtime) { $it.LastWriteTimeUtc=[DateTimeOffset]::FromUnixTimeSeconds([int64]$j.mtime).UtcDateTime }; exit 0',
  rmrf: '$j=[Console]::In.ReadToEnd()|ConvertFrom-Json; Remove-Item -LiteralPath $j.path -Recurse -Force -ErrorAction SilentlyContinue; exit 0',
  hostname: '[System.Net.Dns]::GetHostName()',
}

export function shCommand(script: string, ...args: string[]): string[] {
  return ['sh', '-c', script, 'sh', ...args]
}

export function psCommand(script: string): string[] {
  return [
    'powershell.exe',
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-EncodedCommand',
    Buffer.from(script, 'utf16le').toString('base64'),
  ]
}

// ---- OS detection / probe ---------------------------------------------------

export interface AgentOsInfo {
  os: GuestOs
  label: string
  kernel?: string
}

/** Agent commands the writer cannot work without (qemu-ga names). */
export const REQUIRED_AGENT_COMMANDS = [
  'guest-exec', 'guest-exec-status', 'guest-file-open', 'guest-file-write', 'guest-file-close',
] as const

/**
 * qemu-ga can run with an allow/block list (`--allow-rpcs` / `--block-rpcs`,
 * seen on the lab Win2025 template where guest-exec and every file command
 * are blocked). `info` lists each command with `enabled`; a blocked one would
 * otherwise only surface as "command is not allowed" in the middle of a job.
 * Returns the disabled required commands, and whether get-osinfo is usable.
 */
async function agentCapabilities(target: AgentTarget, signal?: AbortSignal): Promise<{ blocked: string[]; osinfo: boolean }> {
  let data: any
  try {
    data = await pveFetch<any>(target.conn, agentPath(target, 'info'), { signal })
  } catch {
    // Old agents without `info`: assume everything is there, a real refusal
    // still fails the job with the agent's own message.
    return { blocked: [], osinfo: true }
  }
  const commands: Array<{ name?: string; enabled?: boolean }> = data?.result?.supported_commands || data?.supported_commands || []
  if (commands.length === 0) return { blocked: [], osinfo: true }
  const enabled = new Set(commands.filter(c => c.enabled !== false).map(c => String(c.name)))
  return {
    blocked: REQUIRED_AGENT_COMMANDS.filter(c => !enabled.has(c)),
    osinfo: enabled.has('guest-get-osinfo'),
  }
}

/** OS family from the VM config `ostype` (win*, l24/l26), when the agent will not say. */
async function osFromConfig(target: AgentTarget, signal?: AbortSignal): Promise<AgentOsInfo | null> {
  try {
    const conf = await pveFetch<any>(target.conn, `/nodes/${encodeURIComponent(target.node)}/qemu/${encodeURIComponent(String(target.vmid))}/config`, { signal })
    const ostype = String(conf?.ostype || '')
    if (/^win/.test(ostype)) return { os: 'windows', label: `Windows (${ostype})` }
    if (/^l2[46]$/.test(ostype)) return { os: 'linux', label: 'Linux' }
  } catch {
    // fall through
  }
  return null
}

export async function detectAgentOs(target: AgentTarget, signal?: AbortSignal): Promise<AgentOsInfo> {
  try {
    await pveFetch(target.conn, agentPath(target, 'ping'), { method: 'POST', signal })
  } catch (err) {
    throw new GuestWriterError(`Guest agent not reachable: ${errorMessage(err)}`, true)
  }
  const caps = await agentCapabilities(target, signal)
  if (caps.blocked.length > 0) {
    throw new GuestWriterError(
      `The guest agent of this VM blocks ${caps.blocked.join(', ')} (qemu-ga allow/block list). Allow them in the agent configuration or restore over SSH.`,
      true,
    )
  }

  if (!caps.osinfo) {
    const fromConfig = await osFromConfig(target, signal)
    if (fromConfig) return fromConfig
    throw new GuestWriterError('The guest agent blocks guest-get-osinfo and the VM OS type is not set: cannot tell Linux from Windows', true)
  }
  let osData: any
  try {
    osData = await pveFetch<any>(target.conn, agentPath(target, 'get-osinfo'), { signal })
  } catch (err) {
    const fromConfig = await osFromConfig(target, signal)
    if (fromConfig) return fromConfig
    throw new GuestWriterError(`Guest agent get-osinfo failed: ${errorMessage(err)}`, true)
  }
  const result = osData?.result || osData || {}
  const os = getOsType(result)
  const label = String(result['pretty-name'] || result.name || result.id || 'unknown')
  if (os === 'other') {
    throw new GuestWriterError(`Unsupported guest OS "${label}": only Linux and Windows guests are supported`, true)
  }
  return { os, label, kernel: result['kernel-release'] ? String(result['kernel-release']) : undefined }
}

export async function probeAgent(target: AgentTarget): Promise<GuestFileRestoreProbeResult> {
  // Under the 60 s an nginx front cuts API calls at.
  const signal = AbortSignal.timeout(45_000)
  try {
    const info = await detectAgentOs(target, signal)
    let hostname: string | undefined
    try {
      const res = await agentExec(
        target,
        info.os === 'windows' ? psCommand(PS.hostname) : shCommand(SH.hostname),
        undefined,
        signal,
        30_000,
      )
      hostname = res.out.trim() || undefined
    } catch {
      // The OS answer is enough for a probe.
    }
    const details: Record<string, string> = { os: info.label }
    if (info.kernel) details.kernel = info.kernel
    return { ok: true, os: info.os, hostname, details }
  } catch (err) {
    return { ok: false, error: errorMessage(err) }
  }
}

// ---- writer -----------------------------------------------------------------

export interface AgentWriterOptions {
  maxBytes: number
  /** file-write calls in flight at once (defaults to 1). */
  parallelWrites?: number
  log: (level: 'info' | 'warn' | 'error', msg: string) => void
}

/** mktemp template of the per-job staging directory (0700, root). */
export const AGENT_STAGING_TEMPLATE = '/var/tmp/.pxc-restore-XXXXXXXX'

export class AgentWriter implements GuestWriter {
  readonly os: GuestOs
  readonly description: string

  private bytes = 0
  private seq = 0
  private stagingDir: string | null = null
  private readonly knownDirs = new Set<string>()

  private constructor(
    private readonly target: AgentTarget,
    info: AgentOsInfo,
    private readonly opts: AgentWriterOptions,
  ) {
    this.os = info.os
    this.description = `QEMU guest agent, ${info.label}`
  }

  static async create(target: AgentTarget, _jobId: string, opts: AgentWriterOptions): Promise<AgentWriter> {
    const info = await detectAgentOs(target)
    return new AgentWriter(target, info, opts)
  }

  /** Bytes pushed through the agent so far (for the transfer cap). */
  get bytesWritten(): number {
    return this.bytes
  }

  private exec(linux: string[], windows: { script: string; input: unknown }, signal: AbortSignal, timeoutMs?: number) {
    return this.os === 'windows'
      ? agentExec(this.target, psCommand(windows.script), JSON.stringify(windows.input), signal, timeoutMs)
      : agentExec(this.target, linux, undefined, signal, timeoutMs)
  }

  private account(n: number): void {
    this.bytes += n
    if (this.bytes > this.opts.maxBytes) {
      const mib = Math.round(this.opts.maxBytes / (1024 * 1024))
      throw new GuestWriterError(
        `Agent transfer limit reached (${mib} MiB per job): use the SSH method for larger restores`,
        true,
      )
    }
  }

  private async fileWrite(path: string, buf: Buffer, signal: AbortSignal): Promise<void> {
    try {
      await pveFetch(
        this.target.conn,
        agentPath(this.target, 'file-write'),
        { method: 'POST', body: JSON.stringify({ file: path, content: buf.toString('base64'), encode: 0 }), signal },
        { timeoutMs: 60_000 },
      )
    } catch (err) {
      throw classify(err)
    }
  }

  /** Failure message of a guest script, with the refusals named. */
  private refusal(res: AgentExecResult, what: string): GuestWriterError {
    const detail = res.err.trim() || `exit code ${res.exitcode}`
    if (res.exitcode === GUEST_EXIT.symlink) return new GuestWriterError(`${what}: refused, ${detail}`)
    if (res.exitcode === GUEST_EXIT.directory) return new GuestWriterError(`${what}: refused, ${detail}`)
    return new GuestWriterError(`${what}: ${detail}`)
  }

  async exists(path: string): Promise<boolean> {
    const res = await this.exec(shCommand(SH.exists, path), { script: PS.exists, input: { path } }, new AbortController().signal)
    if (res.exitcode === 0) return true
    if (res.exitcode === 1) return false
    throw new GuestWriterError(`Cannot stat ${path}: ${res.err.trim() || `exit code ${res.exitcode}`}`)
  }

  async mkdirp(path: string): Promise<void> {
    if (this.knownDirs.has(path)) return
    const res = await this.exec(shCommand(SH.mkdirp, path), { script: PS.mkdirp, input: { path } }, new AbortController().signal)
    if (res.exitcode !== 0) throw this.refusal(res, `Cannot create directory ${path}`)
    this.knownDirs.add(path)
  }

  /** The per-job staging directory, created by the guest with an unpredictable name. */
  private async ensureStaging(signal: AbortSignal): Promise<string> {
    if (this.stagingDir) return this.stagingDir
    const res = await this.exec(shCommand(SH.mktempDir, AGENT_STAGING_TEMPLATE), { script: PS.mktempDir, input: {} }, signal, 30_000)
    const dir = res.out.trim().split(/\r?\n/).filter(Boolean).at(-1) ?? ''
    const valid = this.os === 'windows' ? /^[A-Za-z]:\\.+pxc-restore-[0-9a-f]{32}$/i.test(dir) : /^\/var\/tmp\/\.pxc-restore-[A-Za-z0-9]{8}$/.test(dir)
    if (res.exitcode !== 0 || !valid) {
      throw new GuestWriterError(`Cannot create the staging directory in the guest: ${res.err.trim() || res.out.trim() || `exit code ${res.exitcode}`}`, true)
    }
    this.stagingDir = dir
    this.opts.log('info', `Staging directory ${dir}`)
    return dir
  }

  private async appendParts(staged: string, parts: string[], signal: AbortSignal): Promise<void> {
    const timeout = Math.max(AGENT_EXEC_TIMEOUT_MS, parts.length * 5_000)
    const res = await this.exec(
      shCommand(SH.append, staged, ...parts),
      { script: PS.append, input: { target: staged, parts } },
      signal,
      timeout,
    )
    if (res.exitcode !== 0) {
      throw new GuestWriterError(`Cannot assemble ${staged}: ${res.err.trim() || `exit code ${res.exitcode}`}`)
    }
  }

  private metaArgs(meta: WriteMeta): { mode: string; owner: string; mtime: string } {
    return {
      mode: this.os === 'linux' && meta.mode !== undefined ? (meta.mode & 0o7777).toString(8) : '',
      owner: this.os === 'linux' && meta.uid !== undefined && meta.gid !== undefined ? `${meta.uid}:${meta.gid}` : '',
      mtime: meta.mtime ? String(Math.floor(meta.mtime.getTime() / 1000)) : '',
    }
  }

  /** Metadata onto the staged file, then one rename onto the target. */
  private async finish(staged: string, path: string, meta: WriteMeta, overwrite: boolean, signal: AbortSignal): Promise<void> {
    const { mode, owner, mtime } = this.metaArgs(meta)
    const res = await this.exec(
      shCommand(SH.finish, staged, path, mode, owner, mtime, overwrite ? '1' : '0'),
      { script: PS.finish, input: { staged, target: path, mtime, overwrite } },
      signal,
      60_000,
    )
    if (res.exitcode !== 0) throw this.refusal(res, `Cannot move the restored file onto ${path}`)
  }

  /**
   * Every file, even a single-chunk one, lands in the staging directory
   * first: `file-write` follows symlinks, a rename does not.
   */
  async writeFile(path: string, body: Readable, meta: WriteMeta, onBytes: (n: number) => void, signal: AbortSignal, opts: WriteOptions = {}): Promise<void> {
    const staging = await this.ensureStaging(signal)
    const seq = ++this.seq
    const staged = joinGuestPath(this.os, staging, `${seq}.file`)
    const chunks = chunkStream(body, AGENT_CHUNK_BYTES)
    const first = await chunks.next()
    if (first.done) {
      await this.fileWrite(staged, Buffer.alloc(0), signal)
      await this.finish(staged, path, meta, opts.overwrite === true, signal)
      return
    }
    const second = await chunks.next()
    if (second.done) {
      // Fast path: one call writes the whole file into the staging directory.
      this.account(first.value.length)
      await this.fileWrite(staged, first.value, signal)
      onBytes(first.value.length)
      await this.finish(staged, path, meta, opts.overwrite === true, signal)
      return
    }

    // Large file: 46 KiB parts next to the staged file, appended to it in
    // batches, then the rename.
    // Each file-write costs the guest agent about a second on PVE 9.2 (lab,
    // 2026-10-09) while parallel calls overlap well, so several parts are
    // kept in flight. Parts keep their index, the append order never depends
    // on which write finishes first.
    const parallel = Math.max(1, this.opts.parallelWrites ?? 1)
    const inflight = new Set<Promise<void>>()
    let failure: unknown = null
    const settle = async () => {
      await Promise.all(inflight)
      if (failure) throw failure
    }

    let index = 0
    let batch: string[] = []
    const flush = async () => {
      await settle()
      if (batch.length === 0) return
      const parts = batch
      batch = []
      await this.appendParts(staged, parts, signal)
    }
    const push = async (buf: Buffer) => {
      if (signal.aborted) throw new GuestWriterError('Cancelled', true)
      if (failure) throw failure
      this.account(buf.length)
      const part = joinGuestPath(this.os, staging, `${seq}.${String(index++).padStart(8, '0')}`)
      batch.push(part)
      const write: Promise<void> = this.fileWrite(part, buf, signal)
        .then(() => onBytes(buf.length))
        .catch(err => { failure ??= err })
        .finally(() => inflight.delete(write))
      inflight.add(write)
      if (inflight.size >= parallel) await Promise.race(inflight)
      if (batch.length >= AGENT_APPEND_BATCH) await flush()
    }

    await push(first.value)
    await push(second.value)
    try {
      for await (const buf of chunks) {
        await push(buf)
      }
      await flush()
    } finally {
      // Never leave a write running behind an error or a cancel.
      await Promise.allSettled(inflight)
    }

    await this.finish(staged, path, meta, opts.overwrite === true, signal)
  }

  /** uid:gid of a path (linux only; the link itself for a symlink). */
  async ownerOf(path: string): Promise<{ uid: number; gid: number } | null> {
    if (this.os === 'windows') return null
    const res = await agentExec(this.target, shCommand(SH.owner, path), undefined, new AbortController().signal, 30_000)
    const m = /^(\d+):(\d+)\s*$/.exec(res.out)
    if (res.exitcode !== 0 || !m) return null
    return { uid: Number(m[1]), gid: Number(m[2]) }
  }

  async setMeta(path: string, meta: WriteMeta): Promise<void> {
    const { mode, owner, mtime } = this.metaArgs(meta)
    if (this.os === 'windows') {
      if (!mtime) return
      await this.exec([], { script: PS.meta, input: { path, mtime } }, new AbortController().signal, 30_000)
      return
    }
    if (!mode && !owner && !mtime) return
    await agentExec(this.target, shCommand(SH.meta, path, mode, owner, mtime), undefined, new AbortController().signal, 30_000)
  }

  async symlink(path: string, target: string, meta?: Pick<WriteMeta, 'uid' | 'gid'>): Promise<void> {
    if (this.os === 'windows') {
      this.opts.log('warn', `Symlink skipped on Windows: ${path}`)
      return
    }
    const owner = meta?.uid !== undefined && meta?.gid !== undefined ? `${meta.uid}:${meta.gid}` : ''
    const res = await agentExec(this.target, shCommand(SH.symlink, path, target, owner), undefined, new AbortController().signal, 30_000)
    if (res.exitcode !== 0) throw this.refusal(res, `Cannot create symlink ${path}`)
  }

  async close(): Promise<void> {
    if (!this.stagingDir) return
    const dir = this.stagingDir
    this.stagingDir = null
    try {
      await this.exec(shCommand(SH.rmrf, dir), { script: PS.rmrf, input: { path: dir } }, AbortSignal.timeout(60_000), 60_000)
    } catch (err) {
      this.opts.log('warn', `Staging directory ${dir} could not be removed: ${errorMessage(err)}`)
    }
  }
}
