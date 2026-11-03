// Power action on a set of guests: the selection bar of the guest lists and the
// tree, start-all / shutdown-all / stop-all of a node. Each guest is one POST to
// the single-guest route, so the RBAC, vDC scope and audit are those of a click
// on that guest, then its Proxmox task is followed until it ends.
//
// A slot is held until the task ends, not only until the POST returns: Proxmox
// answers a start with its UPID at once, so a cap on the POSTs alone let every
// task of the batch run at the same time (18 starts at once on one node, lab
// 03/11). At most `perNode` tasks per host and `total` over the whole batch,
// the way Proxmox's own startall bounds itself with max_workers.
import { requireOk } from '@/lib/api/fetchJsonSafe'
import { waitForPveTask, type WaitForPveTaskResult } from '@/lib/proxmox/waitForTaskClient'

export type BulkPowerAction = 'start' | 'shutdown' | 'reboot' | 'stop'

export const BULK_POWER_ACTIONS: readonly BulkPowerAction[] = ['start', 'shutdown', 'reboot', 'stop']

export interface BulkPowerGuest {
  connId: string
  node: string
  type: string
  vmid: string | number
}

/**
 * Where a guest of the batch stands. `timeout`: the order was taken but the
 * task still runs after the follow-up budget; `cancelled`: never sent, the
 * operator stopped the batch first.
 */
export type BulkGuestStatus = 'queued' | 'running' | 'completed' | 'failed' | 'timeout' | 'cancelled'

export interface BulkGuestResult {
  status: BulkGuestStatus
  error?: string
  /** A task done with `WARNINGS: n`: what Proxmox warned about. */
  warning?: string
}

export interface BulkPowerOutcome {
  success: number
  errors: number
  /** Orders taken whose task still ran when the follow-up gave up. */
  stillRunning?: number
  /** Guests never sent because the batch was stopped. */
  cancelled?: number
  /** First refusal message, shown next to the counts. */
  firstError?: string
  /** One result per guest, in the order given. */
  results?: BulkGuestResult[]
}

export const BULK_POWER_PER_NODE_DEFAULT = 4
export const BULK_POWER_PER_NODE_MIN = 1
export const BULK_POWER_PER_NODE_MAX = 8
/** Tasks in flight over the whole batch, whatever the number of hosts. */
export const BULK_POWER_TOTAL = 10
/** Every task in flight is read every 3 s (status + log: two short reads). */
export const BULK_POWER_POLL_MS = 3_000
export const BULK_POWER_TASK_TIMEOUT_MS = 10 * 60_000

const PER_NODE_STORAGE_KEY = 'proxcenter.bulkPower.perNode'

export function clampPerNode(value: unknown): number {
  const n = Math.trunc(Number(value))
  if (!Number.isFinite(n)) return BULK_POWER_PER_NODE_DEFAULT

  return Math.min(BULK_POWER_PER_NODE_MAX, Math.max(BULK_POWER_PER_NODE_MIN, n))
}

/** The per-host parallelism the operator last chose in this browser. */
export function readPerNodePreference(): number {
  try {
    const raw = globalThis.localStorage?.getItem(PER_NODE_STORAGE_KEY)

    return raw ? clampPerNode(raw) : BULK_POWER_PER_NODE_DEFAULT
  } catch {
    return BULK_POWER_PER_NODE_DEFAULT
  }
}

export function writePerNodePreference(value: number): void {
  try {
    globalThis.localStorage?.setItem(PER_NODE_STORAGE_KEY, String(clampPerNode(value)))
  } catch {
    // Private window or blocked storage: the default comes back next time.
  }
}

/** Whether `action` applies to a guest in `status`: start a stopped one, the others a running one. */
export function powerActionApplies(action: BulkPowerAction, status: string | undefined): boolean {
  return action === 'start' ? status === 'stopped' : status === 'running'
}

export function guestPowerUrl(guest: BulkPowerGuest, action: string): string {
  return `/api/v1/connections/${encodeURIComponent(guest.connId)}/guests/${guest.type}/${encodeURIComponent(guest.node)}/${encodeURIComponent(guest.vmid)}/${action}`
}

export interface BulkPowerOptions {
  /** Tasks in flight per host (clamped to 1-8). */
  perNode?: number
  /** Tasks in flight over the batch. */
  total?: number
  /** Every change of a guest's status, by its index in `guests`. */
  onUpdate?: (index: number, result: BulkGuestResult) => void
  /** Checked before each send: false stops the batch, the guests not sent yet are cancelled. */
  shouldContinue?: () => boolean
  fetchImpl?: typeof fetch
  waitTask?: (connId: string, node: string, upid: string) => Promise<WaitForPveTaskResult>
}

function followTask(connId: string, node: string, upid: string): Promise<WaitForPveTaskResult> {
  return waitForPveTask(connId, node, upid, { intervalMs: BULK_POWER_POLL_MS, timeoutMs: BULK_POWER_TASK_TIMEOUT_MS, acceptWarnings: true })
}

function upidOf(body: unknown): string | null {
  const data = (body as { data?: unknown } | undefined)?.data

  return typeof data === 'string' && data.startsWith('UPID:') ? data : null
}

async function runOne(
  guest: BulkPowerGuest,
  action: string,
  fetchImpl: typeof fetch,
  waitTask: NonNullable<BulkPowerOptions['waitTask']>,
): Promise<BulkGuestResult> {
  try {
    const body = await requireOk(guestPowerUrl(guest, action), { method: 'POST' }, fetchImpl)
    const upid = upidOf(body)

    // No task to follow (an answer without UPID): the order was taken.
    if (!upid) return { status: 'completed' }
    const task = await waitTask(guest.connId, guest.node, upid)

    if (task.outcome === 'ok') return task.warning ? { status: 'completed', warning: task.warning } : { status: 'completed' }
    if (task.outcome === 'failed') return { status: 'failed', error: task.reason || task.error || 'task failed' }

    return { status: 'timeout' }
  } catch (e) {
    return { status: 'failed', error: e instanceof Error ? e.message : String(e) }
  }
}

function summarize(results: BulkGuestResult[]): BulkPowerOutcome {
  const count = (status: BulkGuestStatus) => results.filter(r => r.status === status).length
  const firstError = results.find(r => r.status === 'failed')?.error
  const stillRunning = count('timeout')
  const cancelled = count('cancelled')

  return {
    success: count('completed'),
    errors: count('failed'),
    ...(stillRunning ? { stillRunning } : {}),
    ...(cancelled ? { cancelled } : {}),
    ...(firstError ? { firstError } : {}),
    results,
  }
}

export function runBulkGuestPower(
  guests: ReadonlyArray<BulkPowerGuest>,
  action: BulkPowerAction,
  options: BulkPowerOptions = {},
): Promise<BulkPowerOutcome> {
  const perNode = clampPerNode(options.perNode ?? BULK_POWER_PER_NODE_DEFAULT)
  const total = Math.max(1, Math.trunc(options.total ?? BULK_POWER_TOTAL))
  const fetchImpl = options.fetchImpl ?? fetch
  const waitTask = options.waitTask ?? followTask
  const results: BulkGuestResult[] = guests.map(() => ({ status: 'queued' }))
  const queue = guests.map((_, i) => i)
  const busy = new Map<string, number>()
  let running = 0
  let left = guests.length

  const set = (index: number, result: BulkGuestResult) => {
    results[index] = result
    options.onUpdate?.(index, result)
  }
  const hostOf = (index: number) => `${guests[index].connId}\u0000${guests[index].node}`

  return new Promise(resolve => {
    if (left === 0) {
      resolve(summarize(results))

      return
    }

    const settle = () => {
      if (left === 0) resolve(summarize(results))
    }

    // Fills the free slots, in the order given, skipping a guest whose host
    // is full for one of the next hosts. Called again as each task ends.
    const pump = () => {
      if (options.shouldContinue?.() === false && queue.length > 0) {
        for (const index of queue.splice(0)) set(index, { status: 'cancelled' })
        left = running
        settle()

        return
      }

      let qi = 0

      while (qi < queue.length && running < total) {
        const index = queue[qi]
        const host = hostOf(index)

        if ((busy.get(host) ?? 0) >= perNode) {
          qi++
          continue
        }

        queue.splice(qi, 1)
        busy.set(host, (busy.get(host) ?? 0) + 1)
        running++
        set(index, { status: 'running' })
        void runOne(guests[index], action, fetchImpl, waitTask).then(result => {
          set(index, result)
          busy.set(host, (busy.get(host) ?? 1) - 1)
          running--
          left--
          if (left === 0) settle()
          else pump()
        })
      }
    }

    pump()
  })
}

export type BulkPowerSeverity = 'success' | 'warning' | 'error'

/** success: all went through, warning: some did (or some still run), error: none did. */
export function bulkPowerSeverity(outcome: BulkPowerOutcome): BulkPowerSeverity {
  if (outcome.errors === 0 && !outcome.stillRunning && !outcome.cancelled) return 'success'

  return outcome.success > 0 || (outcome.stillRunning ?? 0) > 0 ? 'warning' : 'error'
}

type Translate = (key: string, values?: Record<string, string | number>) => string

/** The one-line verdict of a batch (vmActions.bulk*), with the first refusal and the tasks still running. */
export function bulkPowerMessage(outcome: BulkPowerOutcome, description: string, t: Translate): string {
  const severity = bulkPowerSeverity(outcome)
  const detail = outcome.firstError ? ` (${outcome.firstError})` : ''
  const still = outcome.stillRunning ? ` ${t('vmActions.bulkStillRunning', { count: outcome.stillRunning })}` : ''

  if (severity === 'success') return t('vmActions.bulkSuccess', { description, count: outcome.success })
  if (severity === 'warning') return t('vmActions.bulkPartial', { description, success: outcome.success, errors: outcome.errors }) + detail + still

  return t('vmActions.bulkFailed', { description, errors: outcome.errors }) + detail
}
