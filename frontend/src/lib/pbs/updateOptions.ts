// Options of a Proxmox Backup Server update, shared by the dialog and the routes.

export interface PbsUpdateOptions {
  autoReboot: boolean
  /** Seconds the server is given to come back and answer after a reboot. */
  rebootTimeout: number
  datastoreReadOnly: boolean
}

export const PBS_REBOOT_TIMEOUT_MIN = 120
export const PBS_REBOOT_TIMEOUT_MAX = 3600
export const PBS_REBOOT_TIMEOUT_DEFAULT = 600

/** A backup job starting within this many seconds is worth a warning. */
export const PBS_UPCOMING_JOB_WINDOW = 60 * 60

/** The options of a run as the dialog sends them, with safe defaults. */
export function parsePbsUpdateOptions(body: unknown): PbsUpdateOptions {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const timeout = Number(b.rebootTimeout)

  return {
    autoReboot: b.autoReboot !== false,
    rebootTimeout: Number.isFinite(timeout)
      ? Math.min(PBS_REBOOT_TIMEOUT_MAX, Math.max(PBS_REBOOT_TIMEOUT_MIN, Math.round(timeout)))
      : PBS_REBOOT_TIMEOUT_DEFAULT,
    datastoreReadOnly: b.datastoreReadOnly === true,
  }
}
