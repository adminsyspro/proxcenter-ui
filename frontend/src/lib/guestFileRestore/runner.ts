// src/lib/guestFileRestore/runner.ts
//
// Executes one guest file restore job: opens each item on its source, walks
// the entries and hands them to the guest writer. Runs after the response
// (the route wraps it in `after()`), so everything that needed the request
// (session, RBAC, tenant scope, connection records) is resolved beforehand
// and passed in `RunContext`. Credentials live in that context only: never
// on the row, never in the log, never in the audit.
//
// Two transports, two shapes (lab, 2026-10-09):
//  - SSH streams. One download per item flows from Proxmox through the tar
//    decoder into SFTP with backpressure, nothing touches the disk here, and
//    up to `pipelineDepth` files are in flight so small files are not paced
//    by SFTP round trips.
//  - The guest agent writes a few dozen KB per round trip, so it stages. The
//    tree of a directory item is walked first (sizes: progress total and the
//    transfer cap before any byte moves), then every file is its own short
//    download (tar=1 keeps mode, owner and mtime) staged on disk, written
//    into the guest, deleted. The spool never holds more than one file and
//    a file that does not fit in the free space fails alone.

import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'

import type { Prisma } from '@prisma/client'

import { audit } from '@/lib/audit'
import type { PveConn } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { safeLog } from '@/lib/log/sanitize'

import { readRestoreEntries, type RestoreEntry } from './entries'
import { expandHomePath, guestDirname, guestTargetPath, isHomePath, keepBothCandidates, posixBasename } from './paths'
import { acquireSlot, abortJob, registerJob, releaseSlot, unregisterJob } from './registry'
import { openSourceStream, sourceLabel, type ResolvedSource } from './sources'
import { SpoolSpaceError, resolveSpoolDir, spoolToFile } from './spool'
import { drain, readAll } from './stream'
import type {
  GuestFileRestoreJobStatus,
  GuestFileRestoreLogLevel,
  GuestFileRestoreLogLine,
  GuestFileRestoreSettings,
  GuestOs,
  GuestRestoreConflict,
  GuestRestoreDestination,
  GuestRestoreItem,
  GuestRestoreMethod,
  GuestRestoreSource,
  GuestRestoreSshCredentials,
} from './types'
import { walkSourceTree, type SourceTreeEntry } from './walk'
import { SSH_CONNECT_FAILED_MESSAGE, opaqueSshErrorClass } from './guestAddresses'
import { AgentWriter } from './writers/agent'
import { SshWriter, classifySshError } from './writers/ssh'
import { GuestWriterError, errorMessage, isFatalWriterError, type GuestWriter } from './writers/writer'

export const LOG_RING_SIZE = 200
const PROGRESS_INTERVAL_MS = 1_000
/**
 * Files up to this size are read into memory before their pipelined write,
 * so the tar reader can move on while SFTP finishes them; larger ones
 * stream and are waited for. Bounded by pipelineDepth times this.
 */
export const PIPELINED_FILE_MAX_BYTES = 1024 * 1024

export interface RunContext {
  source: ResolvedSource
  /** The source as the row stores it, for labels. */
  sourceSpec: GuestRestoreSource
  target: { conn: PveConn; node: string; vmid: number; type: 'qemu' | 'lxc' }
  items: GuestRestoreItem[]
  method: GuestRestoreMethod
  destination: GuestRestoreDestination
  conflict: GuestRestoreConflict
  settings: GuestFileRestoreSettings
  ssh?: GuestRestoreSshCredentials
  /** Non-provider caller: an SSH connection failure is logged without its cause. */
  opaqueConnectErrors?: boolean
}

/** Indirection so tests can inject a fake writer, source and disk. */
export const _impl = {
  createWriter: async (jobId: string, ctx: RunContext, log: JobLog): Promise<GuestWriter> => {
    if (ctx.method === 'agent') {
      return AgentWriter.create(
        { conn: ctx.target.conn, node: ctx.target.node, vmid: ctx.target.vmid },
        jobId,
        { maxBytes: ctx.settings.agentMaxBytes, parallelWrites: ctx.settings.agentParallelWrites, log: (level, msg) => log.push(level, msg) },
      )
    }
    if (!ctx.ssh) throw new Error('SSH credentials are required for the SSH method')
    try {
      return await SshWriter.connect(ctx.ssh, ctx.settings.sshConnectTimeoutSec * 1000, { log: (level, msg) => log.push(level, msg) })
    } catch (err) {
      // The job log is visible to the caller: same rule as the probe, so a
      // job cannot serve to scan ports either.
      if (ctx.opaqueConnectErrors && opaqueSshErrorClass(classifySshError(err).errorClass)) {
        throw new GuestWriterError(SSH_CONNECT_FAILED_MESSAGE, true)
      }
      throw err
    }
  },
  openSourceStream,
  walkSourceTree,
  spoolToFile,
  now: () => Date.now(),
}

/** `~/x` against the home of the account that writes; a fatal error when it cannot be told. */
export async function resolveHome(writer: GuestWriter, path: string): Promise<string> {
  if (!isHomePath(path)) return path
  if (writer.os === 'windows') throw new GuestWriterError(`"${path}": ~ is only understood on Linux guests, use a drive path`, true)
  const home = await writer.homeDir?.()
  if (!home) throw new GuestWriterError(`Cannot tell the home folder of the guest account to resolve "${path}"`, true)
  return expandHomePath(path, home)
}

export class JobLog {
  readonly lines: GuestFileRestoreLogLine[] = []

  push(level: GuestFileRestoreLogLevel, msg: string): void {
    this.lines.push({ at: new Date(_impl.now()).toISOString(), level, msg })
    if (this.lines.length > LOG_RING_SIZE) this.lines.splice(0, this.lines.length - LOG_RING_SIZE)
    if (level === 'error') console.error(`[guest-file-restore] ${safeLog(msg)}`)
  }
}

interface Progress {
  status: GuestFileRestoreJobStatus
  guestOs: GuestOs | null
  bytesDone: number
  bytesRead: number
  bytesTotal: number | null
  filesDone: number
  filesSkipped: number
  filesFailed: number
  currentPath: string | null
}

class JobCancelled extends Error {
  constructor() {
    super('Cancelled')
    this.name = 'JobCancelled'
  }
}

export function cancelGuestFileRestoreJob(jobId: string): boolean {
  return abortJob(jobId)
}

/** Final verdict from the counters (a fatal error or a cancel is decided earlier). */
export function finalStatus(p: Pick<Progress, 'filesFailed'>): GuestFileRestoreJobStatus {
  return p.filesFailed > 0 ? 'completed_with_errors' : 'completed'
}

/** Sum of the item sizes when every item is a file of known size, else unknown. */
export function knownBytesTotal(items: Array<Pick<GuestRestoreItem, 'directory' | 'size'>>): number | null {
  if (items.length === 0 || !items.every(i => !i.directory && typeof i.size === 'number')) return null
  return items.reduce((sum, i) => sum + (i.size ?? 0), 0)
}

/** Path of a walked entry relative to the parent of its item, posix separators. */
export function walkedRelPath(itemPath: string, entryPath: string): string {
  const parent = itemPath.slice(0, itemPath.length - posixBasename(itemPath).length)
  return entryPath.startsWith(parent) ? entryPath.slice(parent.length) : posixBasename(entryPath)
}

/** How many files a writer may have in flight at once. */
function pipelineDepth(w: GuestWriter): number {
  const depth = (w as { pipelineDepth?: number }).pipelineDepth
  return typeof depth === 'number' && depth > 0 ? Math.floor(depth) : 1
}

export async function runGuestFileRestoreJob(jobId: string, ctx: RunContext): Promise<void> {
  const active = registerJob(jobId)
  const signal = active.controller.signal
  const log = new JobLog()
  const progress: Progress = {
    status: 'queued',
    guestOs: null,
    bytesDone: 0,
    bytesRead: 0,
    bytesTotal: knownBytesTotal(ctx.items),
    filesDone: 0,
    filesSkipped: 0,
    filesFailed: 0,
    currentPath: null,
  }
  let lastPersist = 0
  let persisting = false
  const persist = async (force: boolean) => {
    const now = _impl.now()
    if (!force && (persisting || now - lastPersist < PROGRESS_INTERVAL_MS)) return
    lastPersist = now
    persisting = true
    try {
      await prisma.guestFileRestoreJob.update({
        where: { id: jobId },
        data: {
          status: progress.status,
          guestOs: progress.guestOs,
          bytesDone: BigInt(progress.bytesDone),
          bytesRead: BigInt(progress.bytesRead),
          bytesTotal: progress.bytesTotal === null ? null : BigInt(progress.bytesTotal),
          filesDone: progress.filesDone,
          filesSkipped: progress.filesSkipped,
          filesFailed: progress.filesFailed,
          currentPath: progress.currentPath,
          log: log.lines as unknown as Prisma.InputJsonValue,
        },
      })
    } catch (err) {
      console.error(`[guest-file-restore] progress write failed for ${safeLog(jobId)}: ${safeLog(errorMessage(err))}`)
    } finally {
      persisting = false
    }
  }
  // Byte counters move inside one large file for minutes: keep the row alive without awaiting.
  const tick = () => { void persist(false) }

  const defaults = { linux: ctx.settings.defaultCustomDirLinux, windows: ctx.settings.defaultCustomDirWindows }
  // `~/...` folders are resolved against the writing account once connected.
  let destination = ctx.destination
  const stallTimeoutMs = ctx.settings.sourceStallTimeoutSec * 1000
  const spoolDir = resolveSpoolDir(ctx.settings.spoolDir)
  let writer: GuestWriter | null = null
  let fatal: string | null = null
  let slotHeld = false

  // Files whose write is still in flight (SSH pipelining); the first fatal
  // writer error among them stops the job at the next check.
  const inflight = new Set<Promise<void>>()
  let pendingFatal: unknown = null
  const checkFatal = () => {
    if (pendingFatal) {
      const err = pendingFatal
      pendingFatal = null
      throw err
    }
  }
  const settleInflight = async () => {
    await Promise.all(inflight)
    checkFatal()
  }

  const open = (item: Pick<GuestRestoreItem, 'path' | 'directory'>) =>
    _impl.openSourceStream(ctx.source, item, signal, {
      stallTimeoutMs,
      onBytes: n => { progress.bytesRead += n; tick() },
      log: (level, msg) => log.push(level, msg),
    })

  const pickFreePath = async (w: GuestWriter, target: string): Promise<string> => {
    for (const candidate of keepBothCandidates(target, w.os, ctx.settings.restoredPrefix)) {
      if (!(await w.exists(candidate))) return candidate
    }
    throw new Error(`No free name next to ${target}`)
  }

  /** Account one file-level failure, or arm the job stop when the guest is gone. */
  const fileFailed = (what: string, err: unknown) => {
    if (signal.aborted) return
    if (isFatalWriterError(err)) {
      pendingFatal ??= err
      return
    }
    log.push('error', `${what}: ${errorMessage(err)}`)
    progress.filesFailed++
  }

  /** Write one file body (streamed or staged) to `dest` and count it. */
  const writeBody = async (w: GuestWriter, dest: string, body: Readable, entry: RestoreEntry, size: number | undefined): Promise<void> => {
    let written = 0
    await w.writeFile(
      dest,
      body,
      { size, mode: entry.mode, uid: entry.uid, gid: entry.gid, mtime: entry.mtime },
      n => { written += n; progress.bytesDone += n; tick() },
      signal,
      { overwrite: ctx.conflict === 'overwrite' },
    )
    // A short read must never pass for a restored file.
    if (size != null && written !== size) {
      throw new Error(`Truncated: ${written} of ${size} bytes written to ${dest}`)
    }
    progress.filesDone++
  }

  /**
   * One entry of an item. `relPath` is where it goes relative to the item's
   * parent. With `stage` the body is spooled to disk first (agent); without,
   * it streams and the write may stay in flight after this returns (SSH).
   */
  const handleEntry = async (w: GuestWriter, item: GuestRestoreItem, entry: RestoreEntry, relPath: string, stage: boolean): Promise<void> => {
    const target = guestTargetPath({
      os: w.os,
      destination,
      sourceKind: ctx.source.kind,
      itemPath: item.path,
      relPath,
      defaults,
    })
    progress.currentPath = target

    if (entry.type === 'directory') {
      // A directory the restore creates gets the mode and owner it had in the
      // backup (not its mtime: writing its children moves it again). An
      // existing one is merged into and left as it is.
      const existed = await w.exists(target)
      await w.mkdirp(target)
      if (!existed) await w.setMeta(target, { mode: entry.mode, uid: entry.uid, gid: entry.gid })
      return
    }

    if (entry.type === 'symlink') {
      if (w.os === 'windows') {
        log.push('warn', `Symlink skipped on Windows: ${target}`)
        progress.filesSkipped++
        return
      }
      await w.mkdirp(guestDirname(target, w.os))
      // A link has no content worth a second copy: anything but overwrite
      // leaves an existing path alone.
      if (ctx.conflict !== 'overwrite' && (await w.exists(target))) {
        log.push('info', `Exists, skipped: ${target}`)
        progress.filesSkipped++
        return
      }
      await w.symlink(target, entry.linkTarget ?? '', { uid: entry.uid, gid: entry.gid })
      progress.filesDone++
      return
    }

    const body = entry.body
    if (!body) throw new Error(`No content for ${relPath}`)
    await w.mkdirp(guestDirname(target, w.os))

    let dest = target
    if (ctx.conflict !== 'overwrite' && (await w.exists(target))) {
      if (ctx.conflict === 'skip') {
        log.push('info', `Exists, skipped: ${target}`)
        progress.filesSkipped++
        await drain(body)
        return
      }
      dest = await pickFreePath(w, target)
      log.push('info', `Exists, restored as ${dest}`)
    }

    if (!stage) {
      const depth = pipelineDepth(w)
      if (depth > 1 && entry.size !== undefined && entry.size <= PIPELINED_FILE_MAX_BYTES) {
        // SSH, small file: take the bytes now (the tar reader needs the entry
        // consumed before it yields the next one) and let SFTP finish it
        // while the next entries start.
        const buf = await readAll(body)
        const write: Promise<void> = writeBody(w, dest, Readable.from([buf]), entry, entry.size)
          .catch(err => fileFailed(relPath, err))
          .finally(() => inflight.delete(write))
        inflight.add(write)
        if (inflight.size >= depth) await Promise.race(inflight)
        return
      }
      // Large or unsized: stream straight from the backup into the guest.
      await writeBody(w, dest, body, entry, entry.size)
      return
    }

    // Agent: stage the whole file first, so the backup is read at full speed
    // and the guest is fed from disk at its own pace.
    let spooled
    try {
      spooled = await _impl.spoolToFile(body, {
        dir: spoolDir,
        minFreeBytes: ctx.settings.spoolMinFreeBytes,
        size: entry.size,
        signal,
      })
    } catch (err) {
      if (err instanceof SpoolSpaceError) {
        await drain(body)
        throw new Error(`${err.message} (staging folder ${spoolDir})`)
      }
      throw err
    }
    try {
      await writeBody(w, dest, createReadStream(spooled.path), entry, spooled.size)
    } finally {
      await spooled.cleanup()
    }
  }

  /**
   * Mode and owner a directory had in the backup, from the first header of
   * its own tar download (the directory's entry), after which the download
   * is dropped: nothing else is read, nothing is staged. Null when the
   * source does not start the tar with the directory itself (PBS).
   */
  const peekDirectoryMeta = async (sourcePath: string): Promise<Pick<RestoreEntry, 'mode' | 'uid' | 'gid'> | null> => {
    let stream
    try {
      stream = await open({ path: sourcePath, directory: true })
    } catch (err) {
      if (signal.aborted) throw new JobCancelled()
      log.push('warn', `Cannot read the attributes of ${sourcePath}: ${errorMessage(err)}`)
      return null
    }
    const { body, tar } = stream
    if (!tar) {
      body.destroy()
      return null
    }
    const entries = readRestoreEntries(body, { path: sourcePath, directory: true }, { tar })
    try {
      const first = await entries.next()
      const entry = first.done ? null : first.value
      if (entry && entry.type === 'directory' && entry.relPath === posixBasename(sourcePath)) {
        return { mode: entry.mode, uid: entry.uid, gid: entry.gid }
      }
      return null
    } catch (err) {
      if (signal.aborted) throw new JobCancelled()
      log.push('warn', `Cannot read the attributes of ${sourcePath}: ${errorMessage(err)}`)
      return null
    } finally {
      // Leaving the generator tears the decoder and the download down.
      await entries.return(undefined)
      if (!body.destroyed) body.destroy()
    }
  }

  /**
   * Agent flow: create a walked directory; one the restore creates gets the
   * mode and owner it had in the backup, an existing one is left as it is.
   */
  const createWalkedDirectory = async (w: GuestWriter, item: GuestRestoreItem, sourcePath: string, relPath: string): Promise<void> => {
    const target = guestTargetPath({ os: w.os, destination, sourceKind: ctx.source.kind, itemPath: item.path, relPath, defaults })
    progress.currentPath = target
    const existed = await w.exists(target)
    await w.mkdirp(target)
    if (existed) return
    const meta = await peekDirectoryMeta(sourcePath)
    if (meta) {
      await w.setMeta(target, meta)
      return
    }
    // Owner of the parent, so a home directory restore does not hand the
    // tree to root; the mode stays the default.
    const owner = w.ownerOf ? await w.ownerOf(guestDirname(target, w.os)) : null
    if (owner) {
      await w.setMeta(target, owner)
      log.push('warn', `${relPath}: attributes not available from the backup, owner inherited from the parent directory`)
    }
  }

  /** Open an item (or one walked leaf of it) and hand its entries over. */
  const transferItem = async (
    w: GuestWriter,
    item: GuestRestoreItem,
    leaf: Pick<GuestRestoreItem, 'path' | 'directory' | 'size'>,
    relPathOf: (entry: RestoreEntry) => string,
    stage: boolean,
  ): Promise<void> => {
    if (signal.aborted) throw new JobCancelled()
    let stream
    try {
      stream = await open(leaf)
    } catch (err) {
      if (signal.aborted) throw new JobCancelled()
      log.push('error', `Cannot open ${leaf.path}: ${errorMessage(err)}`)
      progress.filesFailed++
      return
    }
    const { body, tar } = stream
    // A stalled source must not outlive a cancel: tearing the body down
    // fails the decoding pipeline, which wakes the entry reader.
    const onAbort = () => body.destroy(new JobCancelled())
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const entries = readRestoreEntries(body, leaf, {
        tar,
        onSkip: (reason, name) => {
          log.push('warn', `Skipped ${name} (${reason})`)
          progress.filesSkipped++
        },
      })
      for await (const entry of entries) {
        if (signal.aborted) throw new JobCancelled()
        checkFatal()
        const relPath = relPathOf(entry)
        try {
          await handleEntry(w, item, entry, relPath, stage)
        } catch (err) {
          if (signal.aborted) throw new JobCancelled()
          if (isFatalWriterError(err)) throw err
          log.push('error', `${relPath}: ${errorMessage(err)}`)
          progress.filesFailed++
          if (entry.body) await drain(entry.body)
        }
        await persist(false)
      }
    } catch (err) {
      if (err instanceof JobCancelled || signal.aborted) throw new JobCancelled()
      if (isFatalWriterError(err)) throw err
      log.push('error', `${leaf.path}: ${errorMessage(err)}`)
      progress.filesFailed++
    } finally {
      signal.removeEventListener('abort', onAbort)
      if (!body.destroyed) body.destroy()
    }
  }

  /** SSH: one streamed download per item, entries written as they arrive. */
  const restoreStreaming = async (w: GuestWriter): Promise<void> => {
    for (const item of ctx.items) {
      log.push('info', `${item.directory ? 'Directory' : 'File'} ${item.path}`)
      await transferItem(w, item, item, entry => entry.relPath, false)
      await settleInflight()
    }
  }

  /** Agent: walk first (sizes), then one short download per file, staged. */
  const restoreStaged = async (w: GuestWriter): Promise<void> => {
    // Every directory item is walked before any byte moves: the total and
    // the transfer cap are known up front instead of after hours of writes.
    const plans: Array<{ item: GuestRestoreItem; entries: SourceTreeEntry[] | null }> = []
    let total = 0
    let walked = 0
    for (const item of ctx.items) {
      if (signal.aborted) throw new JobCancelled()
      if (!item.directory) {
        plans.push({ item, entries: null })
        total += item.size ?? 0
        continue
      }
      const entries: SourceTreeEntry[] = []
      try {
        for await (const e of _impl.walkSourceTree(ctx.source, item.path, signal)) {
          entries.push(e)
          if (e.type === 'file') total += e.size
          if (++walked % 500 === 0) {
            progress.currentPath = e.path
            await persist(false)
          }
        }
      } catch (err) {
        if (signal.aborted) throw new JobCancelled()
        log.push('error', `Cannot list ${item.path}: ${errorMessage(err)}`)
        progress.filesFailed++
        continue
      }
      plans.push({ item, entries })
    }
    const sizesKnown = plans.every(p => p.entries !== null || typeof p.item.size === 'number')
    progress.bytesTotal = sizesKnown ? total : null
    if (walked > 0) log.push('info', `${walked} entries listed, ${total} bytes to restore`)
    if (total > ctx.settings.agentMaxBytes) {
      const mib = Math.round(ctx.settings.agentMaxBytes / (1024 * 1024))
      throw new Error(`The selection weighs ${total} bytes, above the guest agent limit of ${mib} MiB per job: use the SSH method for this restore`)
    }
    await persist(true)

    for (const plan of plans) {
      if (signal.aborted) throw new JobCancelled()
      const { item } = plan
      if (plan.entries === null) {
        log.push('info', `File ${item.path}`)
        await transferItem(w, item, item, entry => entry.relPath, true)
        continue
      }
      log.push('info', `Directory ${item.path} (${plan.entries.length} entries)`)
      // The item's own directory, then each entry in walk order.
      const rootRel = posixBasename(item.path)
      try {
        await createWalkedDirectory(w, item, item.path, rootRel)
      } catch (err) {
        if (err instanceof JobCancelled || signal.aborted) throw new JobCancelled()
        if (isFatalWriterError(err)) throw err
        log.push('error', `${rootRel}: ${errorMessage(err)}`)
        progress.filesFailed++
        continue
      }
      for (const e of plan.entries) {
        if (signal.aborted) throw new JobCancelled()
        const relPath = walkedRelPath(item.path, e.path)
        if (e.type === 'directory') {
          try {
            await createWalkedDirectory(w, item, e.path, relPath)
          } catch (err) {
            if (err instanceof JobCancelled || signal.aborted) throw new JobCancelled()
            if (isFatalWriterError(err)) throw err
            log.push('error', `${relPath}: ${errorMessage(err)}`)
            progress.filesFailed++
          }
          continue
        }
        if (e.type === 'other') {
          log.push('warn', `Skipped ${relPath} (not a regular file, directory or symlink)`)
          progress.filesSkipped++
          continue
        }
        // One short download per leaf: tar=1 keeps its mode, owner and mtime
        // (a symlink arrives as a link entry) and the file alone is staged.
        await transferItem(w, item, { path: e.path, directory: false, size: e.size }, () => relPath, true)
      }
    }
  }

  try {
    await acquireSlot(jobId, ctx.settings.maxConcurrentJobs, signal)
    slotHeld = true
    progress.status = 'running'
    await prisma.guestFileRestoreJob.update({ where: { id: jobId }, data: { status: 'running', startedAt: new Date(_impl.now()) } })
    log.push('info', `Restoring ${ctx.items.length} item(s) from ${sourceLabel(ctx.sourceSpec)} into ${ctx.target.type}/${ctx.target.vmid} via ${ctx.method}`)
    await persist(true)

    writer = await _impl.createWriter(jobId, ctx, log)
    progress.guestOs = writer.os
    log.push('info', `Connected: ${writer.description}`)
    if (destination.mode === 'custom') {
      if (writer.os === 'linux') defaults.linux = await resolveHome(writer, defaults.linux)
      if (destination.path?.trim()) destination = { ...destination, path: await resolveHome(writer, destination.path.trim()) }
      log.push('info', `Destination folder: ${destination.path?.trim() || (writer.os === 'windows' ? defaults.windows : defaults.linux)}`)
    }
    await persist(true)

    if (ctx.method === 'agent') await restoreStaged(writer)
    else await restoreStreaming(writer)
    await settleInflight()
  } catch (err) {
    if (err instanceof JobCancelled || signal.aborted) {
      progress.status = 'cancelled'
      log.push('warn', 'Cancelled by the operator')
    } else {
      fatal = errorMessage(err)
      progress.status = 'failed'
      log.push('error', fatal)
    }
  } finally {
    await Promise.allSettled(inflight)
    if (writer) await writer.close().catch(() => {})
    if (slotHeld) releaseSlot()
    unregisterJob(jobId)
  }

  if (progress.status === 'running') progress.status = finalStatus(progress)
  progress.currentPath = null
  const summary = `${progress.status}: ${progress.filesDone} restored, ${progress.filesSkipped} skipped, ${progress.filesFailed} failed, ${progress.bytesDone} bytes`
  log.push(progress.status === 'failed' ? 'error' : 'info', summary)

  const completedAt = new Date(_impl.now())
  try {
    await prisma.guestFileRestoreJob.update({
      where: { id: jobId },
      data: {
        status: progress.status,
        guestOs: progress.guestOs,
        bytesDone: BigInt(progress.bytesDone),
        bytesRead: BigInt(progress.bytesRead),
        bytesTotal: progress.bytesTotal === null ? null : BigInt(progress.bytesTotal),
        filesDone: progress.filesDone,
        filesSkipped: progress.filesSkipped,
        filesFailed: progress.filesFailed,
        currentPath: null,
        error: fatal,
        log: log.lines as unknown as Prisma.InputJsonValue,
        completedAt,
      },
    })
  } catch (err) {
    console.error(`[guest-file-restore] final write failed for ${safeLog(jobId)}: ${safeLog(errorMessage(err))}`)
  }

  try {
    const row = await prisma.guestFileRestoreJob.findUnique({
      where: { id: jobId },
      select: { createdById: true, createdByEmail: true, guestName: true },
    })
    await audit({
      action: 'restore',
      category: 'backups',
      resourceType: 'guest_file_restore_job',
      resourceId: jobId,
      resourceName: row?.guestName || `${ctx.target.type}/${ctx.target.vmid}`,
      status: progress.status === 'failed' ? 'failure' : progress.status === 'completed' ? 'success' : 'warning',
      errorMessage: fatal ?? undefined,
      userId: row?.createdById ?? undefined,
      userEmail: row?.createdByEmail ?? undefined,
      details: {
        operation: 'restore_files_to_guest',
        phase: 'end',
        status: progress.status,
        method: ctx.method,
        guestOs: progress.guestOs,
        filesDone: progress.filesDone,
        filesSkipped: progress.filesSkipped,
        filesFailed: progress.filesFailed,
        bytesDone: progress.bytesDone,
        bytesRead: progress.bytesRead,
      },
    })
  } catch (err) {
    console.error(`[guest-file-restore] audit failed for ${safeLog(jobId)}: ${safeLog(errorMessage(err))}`)
  }
}
