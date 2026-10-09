// src/lib/guestFileRestore/writers/writer.ts
//
// What the runner needs from a guest, whatever the transport (guest agent or
// SSH/SFTP). Paths are guest-native (`/etc/x` or `C:\x`).

import type { Readable } from 'node:stream'

import type { GuestOs } from '../types'

export interface WriteMeta {
  /** Unknown for a raw file download. */
  size?: number
  mode?: number
  uid?: number
  gid?: number
  mtime?: Date
}

export interface WriteOptions {
  /**
   * The policy allows replacing what is at the target. A symlink there is
   * then replaced by the rename (never written through); without it, a
   * symlink at the target fails the file.
   */
  overwrite?: boolean
}

export interface GuestWriter {
  readonly os: GuestOs
  /** One line for the job log, e.g. the SSH host key fingerprint. */
  readonly description: string
  exists(path: string): Promise<boolean>
  /** Creates the tree; refuses one with a symlinked component that could have been planted. */
  mkdirp(path: string): Promise<void>
  /** Writes to a private temporary file first, then renames it onto `path`. */
  writeFile(
    path: string,
    body: Readable,
    meta: WriteMeta,
    onBytes: (n: number) => void,
    signal: AbortSignal,
    opts?: WriteOptions,
  ): Promise<void>
  /**
   * Mode, owner and times of a path the job created (a restored directory).
   * Best effort: a refused chown or chmod is not an error.
   */
  setMeta(path: string, meta: WriteMeta): Promise<void>
  /** Windows writers log and skip. The owner, when given, is set on the link itself. */
  symlink(path: string, target: string, meta?: Pick<WriteMeta, 'uid' | 'gid'>): Promise<void>
  /** Owner of an existing path, when the transport can tell (null otherwise, e.g. Windows). */
  ownerOf?(path: string): Promise<{ uid: number; gid: number } | null>
  /** Home folder of the account that writes (linux), for a `~/...` destination. */
  homeDir?(): Promise<string | null>
  close(): Promise<void>
}

/**
 * A writer failure. `fatal` means the guest is gone (agent stopped, SSH
 * dropped, transfer cap reached): the job stops. Otherwise the runner counts
 * the file as failed and carries on.
 */
export class GuestWriterError extends Error {
  readonly fatal: boolean

  constructor(message: string, fatal = false) {
    super(message)
    this.name = 'GuestWriterError'
    this.fatal = fatal
  }
}

export function isFatalWriterError(err: unknown): boolean {
  return err instanceof GuestWriterError && err.fatal
}

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}
