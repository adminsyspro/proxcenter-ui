/**
 * Hourly purge of audit rows past the retention of the security policy.
 *
 * `security_policies.audit_retention_days` and `audit_auto_cleanup` were saved
 * by the compliance page and read by nothing: the table grew forever whatever
 * the admin set. This sweeper is what turns the setting into a fact. The
 * policy is global (the id='default' row of the provider tenant) and applies
 * to the rows of every tenant; cleanup stays off until an admin switches it
 * on, so an upgrade deletes nothing by itself, and the retention is clamped
 * to AUDIT_RETENTION_MIN_DAYS whatever an older row holds.
 *
 * Rows go in batches of ids (findMany, then deleteMany) with a cap per pass:
 * the first pass over a table that grew for years must not hold the process
 * for its whole duration; what remains goes at the next tick. The ORM is used
 * rather than raw SQL because raw SQL does not follow the schema routing of
 * the pg adapter (see lib/syslog/orchestratorRelay.ts).
 *
 * One process purges: a database lease (lib/scheduler/lease.ts) elects it, as
 * for the vDC usage sampler. The predicate is idempotent anyway, so the lease
 * only spares the other replicas the work and a duplicate trace row.
 *
 * Timer discipline copied from sessionSweeper.ts: an in-flight guard so a slow
 * pass cannot overlap the next tick, unref() so the timers never keep the
 * process alive by themselves, and an error path that can never throw.
 */
import { randomUUID } from 'node:crypto'
import os from 'node:os'

import type { Prisma } from '@prisma/client'

import { audit } from '@/lib/audit'
import { effectiveAuditRetentionDays, getAuditRetentionPolicy, type AuditRetentionPolicy } from '@/lib/compliance/policies'
import { prisma } from '@/lib/db/prisma'
import { releaseLease, tryAcquireLease } from '@/lib/scheduler/lease'
import { loadSyslogConfig } from '@/lib/syslog/forwarder'
import { ORCHESTRATOR_CURSOR_KEY, parseCursor } from '@/lib/syslog/orchestratorRelay'

export const AUDIT_RETENTION_LEASE = 'audit-retention'
export const AUDIT_RETENTION_SWEEP_INTERVAL_MS = 60 * 60 * 1000
export const AUDIT_RETENTION_INITIAL_DELAY_MS = 60_000
export const AUDIT_RETENTION_LEASE_TTL_MS = 3 * AUDIT_RETENTION_SWEEP_INTERVAL_MS
export const AUDIT_RETENTION_BATCH_SIZE = 1000
export const AUDIT_RETENTION_MAX_BATCHES = 50
const PROVIDER_TENANT = 'default'
const DAY_MS = 24 * 60 * 60 * 1000

export interface AuditRetentionReport {
  /** Cleanup is switched on in the policy. */
  enabled: boolean
  /** This process held the lease for the pass. */
  leader: boolean
  /** Retention applied, after the floor. */
  retentionDays: number
  /** Rows strictly older than this went; null when nothing was attempted. */
  cutoff: Date | null
  deleted: number
  /** False when the batch cap ended the pass with rows left; the next pass continues. */
  complete: boolean
}

export interface AuditRetentionPassDeps {
  loadPolicy?: () => Promise<AuditRetentionPolicy>
  acquireLease?: () => Promise<boolean>
  /** Only `destinations[].enabled` is read: whether a syslog collector is set up. */
  loadSyslog?: () => Promise<{ destinations: Array<{ enabled: boolean }> }>
  now?: () => Date
  batchSize?: number
  maxBatches?: number
}

export interface AuditRetentionSweeperOptions extends AuditRetentionPassDeps {
  intervalMs?: number
  initialDelayMs?: number
  holder?: string
  leaseTtlMs?: number
  /** Test hook: replaces the whole pass. */
  pass?: () => Promise<AuditRetentionReport>
}

/** Fill the pass dependencies, the lease being taken for `holder`. */
export function resolveAuditRetentionDeps(options: AuditRetentionSweeperOptions, holder: string): Required<AuditRetentionPassDeps> {
  const leaseTtlMs = options.leaseTtlMs ?? AUDIT_RETENTION_LEASE_TTL_MS

  return {
    loadPolicy: options.loadPolicy ?? (() => getAuditRetentionPolicy(PROVIDER_TENANT)),
    acquireLease: options.acquireLease ?? (() => tryAcquireLease(AUDIT_RETENTION_LEASE, holder, leaseTtlMs)),
    loadSyslog: options.loadSyslog ?? loadSyslogConfig,
    now: options.now ?? (() => new Date()),
    batchSize: options.batchSize ?? AUDIT_RETENTION_BATCH_SIZE,
    maxBatches: options.maxBatches ?? AUDIT_RETENTION_MAX_BATCHES,
  }
}

/**
 * Cutoff for the rows the Go orchestrator wrote, which reach syslog through
 * lib/syslog/orchestratorRelay.ts: none may go before the relay forwarded it,
 * so the relay cursor caps the cutoff. Without a cursor nothing was forwarded
 * yet. With no enabled collector the relay has nothing to forward and, when
 * a collector appears, starts its cursor at "now", so these rows would never
 * be forwarded anyway and the normal cutoff applies. With a collector enabled
 * the relay creates the cursor within seconds of boot, so the rows just wait
 * for the next pass (null).
 */
async function orchestratorCutoff(cutoff: Date, loadSyslog: Required<AuditRetentionPassDeps>['loadSyslog']): Promise<Date | null> {
  const stored = await prisma.setting.findUnique({
    where: { key_tenantId: { key: ORCHESTRATOR_CURSOR_KEY, tenantId: PROVIDER_TENANT } },
  })
  const cursor = parseCursor(stored?.value)

  if (cursor) {
    const forwardedUpTo = new Date(cursor.ts)

    return forwardedUpTo < cutoff ? forwardedUpTo : cutoff
  }

  const config = await loadSyslog()

  return config.destinations.some(d => d.enabled) ? null : cutoff
}

function expiredWhere(cutoff: Date, orchestrator: Date | null): Prisma.AuditLogWhereInput {
  if (orchestrator && orchestrator.getTime() === cutoff.getTime()) return { timestamp: { lt: cutoff } }

  const app: Prisma.AuditLogWhereInput = { source: { not: 'orchestrator' }, timestamp: { lt: cutoff } }

  if (!orchestrator) return app

  return { OR: [app, { source: 'orchestrator', timestamp: { lt: orchestrator } }] }
}

/** Delete the matching rows oldest first, `batchSize` ids at a time, at most `maxBatches` times. */
async function deleteExpired(where: Prisma.AuditLogWhereInput, batchSize: number, maxBatches: number): Promise<{ deleted: number; complete: boolean }> {
  let deleted = 0

  for (let batch = 0; batch < maxBatches; batch++) {
    const rows = await prisma.auditLog.findMany({ where, orderBy: { timestamp: 'asc' }, take: batchSize, select: { id: true } })

    if (rows.length === 0) return { deleted, complete: true }

    const { count } = await prisma.auditLog.deleteMany({ where: { id: { in: rows.map(r => r.id) } } })

    deleted += count
    if (rows.length < batchSize) return { deleted, complete: true }
  }

  return { deleted, complete: false }
}

/** One pass: read the policy, take the lease, delete the expired rows, leave a trace when any went. */
export async function runAuditRetentionPass(deps: Required<AuditRetentionPassDeps>): Promise<AuditRetentionReport> {
  const policy = await deps.loadPolicy()
  const retentionDays = effectiveAuditRetentionDays(policy.retentionDays)
  const report: AuditRetentionReport = { enabled: policy.autoCleanup, leader: false, retentionDays, cutoff: null, deleted: 0, complete: true }

  if (!policy.autoCleanup) return report
  if (!(await deps.acquireLease())) return report
  report.leader = true

  const cutoff = new Date(deps.now().getTime() - retentionDays * DAY_MS)

  report.cutoff = cutoff

  const where = expiredWhere(cutoff, await orchestratorCutoff(cutoff, deps.loadSyslog))
  const { deleted, complete } = await deleteExpired(where, deps.batchSize, deps.maxBatches)

  report.deleted = deleted
  report.complete = complete
  if (deleted === 0) return report

  // The trace of the purge goes in the journal it just trimmed. Outside a
  // request: the tenant is explicit, and audit() absorbs the missing headers.
  await audit({
    action: 'audit_purge',
    category: 'security',
    resourceType: 'audit_logs',
    resourceId: 'retention',
    resourceName: 'Audit log retention',
    details: { deleted, cutoff: cutoff.toISOString(), retentionDays },
    tenantId: PROVIDER_TENANT,
  })

  return report
}

function unref(timer: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>) {
  if (typeof (timer as { unref?: () => void }).unref === 'function') (timer as { unref: () => void }).unref()
}

/**
 * Start the sweeper: a first pass after `initialDelayMs` (so a restart does
 * not wait a whole hour), then one per interval.
 *
 * @returns A stop() function, safe to call multiple times.
 */
export function startAuditRetentionSweeper(options: AuditRetentionSweeperOptions = {}): () => void {
  const holder = options.holder ?? `${process.env.PROXCENTER_INSTANCE_ID || os.hostname()}#${process.pid}#${randomUUID().slice(0, 8)}`
  const deps = resolveAuditRetentionDeps(options, holder)
  const pass = options.pass ?? (() => runAuditRetentionPass(deps))
  const intervalMs = options.intervalMs ?? AUDIT_RETENTION_SWEEP_INTERVAL_MS

  let stopped = false
  let inFlight = false
  let interval: ReturnType<typeof setInterval> | null = null

  const tick = () => {
    if (stopped || inFlight) return
    inFlight = true
    pass()
      .then(
        (report) => {
          // Silent when nothing went: an hourly "0 rows" line is noise.
          if (report.deleted === 0) return
          const rest = report.complete ? '' : ', more at the next pass'

          console.log(`[audit-retention] purged ${report.deleted} audit row(s) older than ${report.cutoff?.toISOString()} (${report.retentionDays} days)${rest}`)
        },
        (err) => {
          console.error('[audit-retention] pass failed (non-fatal):', err)
        },
      )
      .finally(() => { inFlight = false })
  }

  const first = setTimeout(() => {
    tick()
    if (stopped) return
    interval = setInterval(tick, intervalMs)
    unref(interval)
  }, options.initialDelayMs ?? AUDIT_RETENTION_INITIAL_DELAY_MS)

  unref(first)

  return function stop() {
    if (stopped) return
    stopped = true
    clearTimeout(first)
    if (interval) clearInterval(interval)
    if (!options.acquireLease) void releaseLease(AUDIT_RETENTION_LEASE, holder).catch(() => undefined)
  }
}
