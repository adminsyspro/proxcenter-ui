// src/lib/guestFileRestore/types.ts
//
// Shapes shared by the guest file restore routes, the runner and the restore
// dialog. NO server import here: a client component imports these types.

/** Where the files come from. Ids only, never a credential. */
export type GuestRestoreSource =
  // PVE file-restore API (VM disk images AND pxar archives, via a PVE storage)
  | { kind: 'pve'; connId: string; storage: string; volume: string }
  // PBS direct (pxar archives only, from the backups explorer)
  | {
      kind: 'pbs'
      pbsId: string
      datastore: string
      namespace?: string
      backupType: 'vm' | 'ct' | 'host'
      backupId: string
      backupTime: number
      archive: string
    }

/**
 * One file or directory to restore. `path` is the full file-restore path for
 * a pve source (`/drive-scsi0.img.fidx/part/1/etc/apt`) and the path inside
 * the archive for a pbs source (`/etc/apt`).
 */
export interface GuestRestoreItem {
  path: string
  directory: boolean
  size?: number
}

export type GuestRestoreMethod = 'agent' | 'ssh'

export type GuestRestoreConflict = 'keep' | 'overwrite' | 'skip'

export type GuestOs = 'linux' | 'windows'

export interface GuestRestoreTarget {
  connId: string
  node: string
  type: 'qemu' | 'lxc'
  vmid: number
}

export interface GuestRestoreDestination {
  mode: 'original' | 'custom'
  /** Custom folder. Falls back to the per-OS default of the settings. */
  path?: string
  /** Drive letter for "original" on a Windows guest, default C. */
  windowsDrive?: string
}

export interface GuestRestoreSshCredentials {
  /** Must be one of the guest's own addresses (super admins may use any host). */
  host: string
  port?: number
  username: string
  password?: string
  privateKey?: string
  passphrase?: string
  /**
   * OpenSSH-style `SHA256:<base64>` fingerprint the operator confirmed in
   * the dialog after the probe. Required to create a job: the writer refuses
   * a host whose key differs.
   */
  hostKeyFingerprint?: string
}

/** Why an SSH probe failed, without the raw socket text. */
export type SshProbeErrorClass = 'auth_failed' | 'unreachable' | 'timeout' | 'host_key' | 'unsupported_os' | 'error'

export type GuestFileRestoreJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'completed_with_errors'
  | 'failed'
  | 'cancelled'

export const GUEST_FILE_RESTORE_TERMINAL_STATUSES: readonly GuestFileRestoreJobStatus[] = [
  'completed',
  'completed_with_errors',
  'failed',
  'cancelled',
]

export type GuestFileRestoreLogLevel = 'info' | 'warn' | 'error'

export interface GuestFileRestoreLogLine {
  at: string
  level: GuestFileRestoreLogLevel
  msg: string
}

/** Job as returned by the API (BigInt columns already converted to numbers). */
export interface GuestFileRestoreJob {
  id: string
  status: GuestFileRestoreJobStatus
  method: GuestRestoreMethod
  guestOs: GuestOs | null
  connectionId: string
  node: string
  vmid: number
  guestType: 'qemu' | 'lxc'
  guestName: string | null
  source: GuestRestoreSource
  items: GuestRestoreItem[]
  destination: GuestRestoreDestination
  conflict: GuestRestoreConflict
  bytesDone: number
  /** Bytes received from the backup so far (ahead of bytesDone while a file is spooled). */
  bytesRead: number
  bytesTotal: number | null
  filesDone: number
  filesSkipped: number
  filesFailed: number
  currentPath: string | null
  error: string | null
  log: GuestFileRestoreLogLine[]
  createdByEmail: string | null
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface GuestFileRestoreSettings {
  agentEnabled: boolean
  sshEnabled: boolean
  /** Cap on the bytes one job may push through the guest agent. */
  agentMaxBytes: number
  /** Guest agent file-write calls kept in flight for one large file. */
  agentParallelWrites: number
  defaultConflict: GuestRestoreConflict
  /** Prefix of the copy written next to an existing file with `keep`. */
  restoredPrefix: string
  defaultCustomDirLinux: string
  defaultCustomDirWindows: string
  sshConnectTimeoutSec: number
  maxConcurrentJobs: number
  jobRetentionDays: number
  /** Where the agent method keeps the file being transferred; empty = system temp dir. */
  spoolDir: string
  /** Free space to leave on the spool disk; a file that would eat into it is not restored. */
  spoolMinFreeBytes: number
  /** Seconds without a byte from the backup before the item is failed. */
  sourceStallTimeoutSec: number
}

export type GuestFileRestoreProbeResult =
  | {
      ok: true
      os: GuestOs
      hostname?: string
      /** SSH only: the host key the guest presented, to confirm and send back with the job. */
      hostKeyFingerprint?: string
      details?: Record<string, string>
    }
  | { ok: false; error: string; errorClass?: SshProbeErrorClass }

export interface GuestFileRestoreProbeRequest {
  target: GuestRestoreTarget
  method: GuestRestoreMethod
  ssh?: GuestRestoreSshCredentials
}

export interface GuestFileRestoreCreateRequest {
  source: GuestRestoreSource
  items: GuestRestoreItem[]
  target: GuestRestoreTarget
  method: GuestRestoreMethod
  destination: GuestRestoreDestination
  conflict?: GuestRestoreConflict
  ssh?: GuestRestoreSshCredentials
}
