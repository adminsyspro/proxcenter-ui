// src/lib/migration/guestMigrateClient.ts
//
// Browser side of an intra-cluster guest migration, for the dialogs that move
// several guests at once (node update, node reboot/shutdown evacuation, "Migrate
// all VMs"). POST .../migrate answers 200 as soon as PVE ACCEPTS the task, not
// when the guest has moved (#926): the outcome is only known once the task
// whose UPID it returns has stopped, so that is what these helpers wait for.

import { parseUpid } from '@/lib/proxmox/upid'
import { waitForPveTask } from '@/lib/proxmox/waitForTaskClient'

export interface MigrateGuestRef {
  connId: string
  node: string
  type: string
  vmid: string | number
}

/** How long one migration is followed. A large guest legitimately takes a while. */
export const MIGRATION_TASK_TIMEOUT_MS = 60 * 60_000

export interface MigrationOutcome {
  /** True only once PVE reported the task OK. */
  ok: boolean
  /** The migration task, when PVE started one (to open its log). */
  upid: string | null
  /** The node the task runs on, for its log. */
  node: string
  /** Why it failed: the task-log reason, the exitstatus or the HTTP error. */
  reason?: string
  /** The task was still running when we stopped following it. */
  stillRunning?: boolean
}

export function guestMigrateUrl(guest: MigrateGuestRef): string {
  return `/api/v1/connections/${encodeURIComponent(guest.connId)}/guests/${guest.type}/${encodeURIComponent(guest.node)}/${encodeURIComponent(String(guest.vmid))}/migrate`
}

/**
 * Ask PVE to migrate a guest. Resolves with the task's UPID (null when the
 * answer carries none), rejects with the route's error message.
 */
export async function startGuestMigration(guest: MigrateGuestRef, body: Record<string, unknown>): Promise<string | null> {
  const res = await fetch(guestMigrateUrl(guest), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))

  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)

  return parseUpid(json?.data)?.upid ?? null
}

/** The part of useTaskTracker().trackTask that a tracked migration needs. */
export type MigrationTaskTracker = (task: {
  upid: string
  connId: string
  node: string
  description: string
  timeoutMs?: number
  onSuccess?: () => void
  onError?: () => void
}) => unknown

/**
 * Start a migration and hand its task to the task tracker, which toasts the
 * outcome (with the reason read from the task log) when the task ends. For
 * the single-guest paths, where the dialog closes once PVE accepted the
 * request. Resolves with the UPID, or null when PVE gave none to follow.
 */
export async function startTrackedMigration(
  trackTask: MigrationTaskTracker,
  guest: MigrateGuestRef,
  body: Record<string, unknown>,
  opts: { description: string; onDone?: () => void },
): Promise<string | null> {
  const upid = await startGuestMigration(guest, body)

  if (upid) {
    trackTask({
      upid,
      connId: guest.connId,
      node: parseUpid(upid)?.node || guest.node,
      description: opts.description,
      timeoutMs: MIGRATION_TASK_TIMEOUT_MS,
      onSuccess: opts.onDone,
      onError: opts.onDone,
    })
  }

  return upid
}

/**
 * Migrate a guest and wait for the PVE task to end. Never throws: a refused
 * request, a failed task and a task still running at the deadline all come
 * back as `ok: false`, with the reason when there is one.
 */
export async function migrateGuestAndWait(
  guest: MigrateGuestRef,
  body: Record<string, unknown>,
  opts: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<MigrationOutcome> {
  let upid: string | null

  try {
    upid = await startGuestMigration(guest, body)
  } catch (e: any) {
    return { ok: false, upid: null, node: guest.node, reason: e?.message || '' }
  }

  // Nothing to follow: PVE accepted the request without a task to watch.
  if (!upid) return { ok: true, upid: null, node: guest.node }

  const node = parseUpid(upid)?.node || guest.node
  const result = await waitForPveTask(guest.connId, node, upid, {
    timeoutMs: opts.timeoutMs ?? MIGRATION_TASK_TIMEOUT_MS,
    intervalMs: opts.intervalMs,
  })

  if (result.outcome === 'ok') return { ok: true, upid, node }
  if (result.outcome === 'failed') return { ok: false, upid, node, reason: result.reason || result.error || '' }

  return { ok: false, upid, node, stillRunning: true }
}

/**
 * Run `worker` over `items` in consecutive batches of `batchSize`, each batch
 * in parallel, the next one only once the previous has settled: the cadence
 * the bulk dialogs have always used. `onSettled` fires after each item.
 */
export async function runInBatches<T, R>(
  items: ReadonlyArray<T>,
  batchSize: number,
  worker: (item: T) => Promise<R>,
  onSettled?: (item: T, result: R, done: number) => void,
): Promise<R[]> {
  const results: R[] = []
  let done = 0

  for (let i = 0; i < items.length; i += Math.max(1, batchSize)) {
    const batch = items.slice(i, i + Math.max(1, batchSize))
    const settled = await Promise.all(batch.map(async item => {
      const result = await worker(item)
      done++
      onSettled?.(item, result, done)
      return result
    }))
    results.push(...settled)
  }

  return results
}

/** Text for a migration that did not succeed, in the caller's language. */
export function migrationFailureText(outcome: MigrationOutcome, t: (key: string) => string): string {
  if (outcome.stillRunning) return t('vmActions.migrateStillRunning')

  return outcome.reason || t('updates.vmMigrateFailed')
}
