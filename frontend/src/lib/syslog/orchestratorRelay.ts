// src/lib/syslog/orchestratorRelay.ts
//
// Relay of the orchestrator's audit rows to syslog (issue #1105).
//
// The Go orchestrator writes `audit_logs` rows with source='orchestrator'
// (DRS migrations, rolling updates, host drains, replication, restore drills)
// straight into the database: it has no syslog sender, and the collectors are
// configured here. Every few seconds this relay reads the rows written since
// its cursor and hands them to forwardAuditEvent(), the same path as a row
// written by audit().
//
// The cursor is one `settings` row of the provider tenant. In HA mode every
// Next replica runs the relay, so a batch is claimed before it is forwarded:
// the cursor is advanced with an updateMany conditioned on the value that
// was read (the compare-and-swap of lib/scheduler/lease.ts), and only the
// replica whose update hit a row forwards. Two replicas can never send the
// same rows; a replica that loses the race simply waits for its next tick.
// The ORM is used rather than SELECT ... FOR UPDATE because raw SQL does not
// follow the schema routing of the pg adapter (see lib/connections/assignment.ts).
// On the very first run the cursor is created at "now", so a collector added
// to an old installation does not receive the whole history.
//
// State lives on globalThis under a Symbol.for key, like forwarder.ts, so the
// module instances Next dev creates share one timer.

import { Prisma } from '@prisma/client'

import { prisma } from '@/lib/db/prisma'

import { forwardAuditEvent, loadSyslogConfig } from './forwarder'
import type { SyslogAuditEvent } from './types'

export const ORCHESTRATOR_CURSOR_KEY = 'syslog_orchestrator_cursor'
export const ORCHESTRATOR_RELAY_INTERVAL_MS = 5_000
export const ORCHESTRATOR_RELAY_BATCH_SIZE = 500
const PROVIDER_TENANT = 'default'
const WARN_EVERY_MS = 5 * 60 * 1000
const CURSOR_WHERE = { key_tenantId: { key: ORCHESTRATOR_CURSOR_KEY, tenantId: PROVIDER_TENANT } }

export type RelayCursor = {
  /** ISO timestamp of the last forwarded row. */
  ts: string
  /** Id of the last forwarded row; '' before any row was forwarded. */
  id: string
}

export interface OrchestratorRelayDeps {
  loadConfig?: typeof loadSyslogConfig
  forward?: typeof forwardAuditEvent
  now?: () => Date
}

interface RelayState {
  stop: () => void
  warnedAt: number
}

const STATE_KEY = Symbol.for('proxcenter.syslog.orchestratorRelay')

function state(): RelayState | undefined {
  return (globalThis as unknown as Record<symbol, RelayState | undefined>)[STATE_KEY]
}

function setState(value: RelayState | undefined): void {
  ;(globalThis as unknown as Record<symbol, RelayState | undefined>)[STATE_KEY] = value
}

/** A stored cursor, or null when the row is missing or corrupt. */
export function parseCursor(raw: unknown): RelayCursor | null {
  if (!raw || typeof raw !== 'object') return null
  const { ts, id } = raw as { ts?: unknown; id?: unknown }
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) return null
  return { ts, id: typeof id === 'string' ? id : '' }
}

type OrchestratorAuditRow = Awaited<ReturnType<typeof prisma.auditLog.findMany>>[number]

export function toSyslogEvent(row: OrchestratorAuditRow): SyslogAuditEvent {
  return {
    id: row.id,
    timestamp: row.timestamp,
    tenantId: row.tenantId,
    userId: row.userId,
    userEmail: row.userEmail,
    apiTokenId: row.apiTokenId,
    action: row.action,
    category: row.category,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    resourceName: row.resourceName,
    details: row.details,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    status: row.status,
    errorMessage: row.errorMessage,
  }
}

/**
 * Forward one batch of orchestrator rows. Returns how many rows were
 * forwarded; 0 when no destination is enabled, nothing is new, or another
 * replica claimed the batch first.
 */
export async function relayOrchestratorAuditOnce(deps: OrchestratorRelayDeps = {}): Promise<number> {
  const { loadConfig = loadSyslogConfig, forward = forwardAuditEvent, now = () => new Date() } = deps

  const config = await loadConfig()
  if (!config.destinations.some(d => d.enabled)) return 0

  const stored = await prisma.setting.findUnique({ where: CURSOR_WHERE })
  if (!stored) {
    // First run: start from now, never from the beginning of the table. A
    // replica that loses the creation race sees the row on its next tick.
    const initial: RelayCursor = { ts: now().toISOString(), id: '' }
    try {
      await prisma.setting.create({ data: { key: ORCHESTRATOR_CURSOR_KEY, tenantId: PROVIDER_TENANT, value: initial } })
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err
    }
    return 0
  }

  // A corrupt row restarts from now rather than replaying history.
  const cursor = parseCursor(stored.value) ?? { ts: now().toISOString(), id: '' }
  const since = new Date(cursor.ts)

  const rows = await prisma.auditLog.findMany({
    where: {
      source: 'orchestrator',
      OR: [{ timestamp: { gt: since } }, { timestamp: since, id: { gt: cursor.id } }],
    },
    orderBy: [{ timestamp: 'asc' }, { id: 'asc' }],
    take: ORCHESTRATOR_RELAY_BATCH_SIZE,
  })
  if (rows.length === 0) return 0

  // Claim the batch: advance the cursor only if nobody moved it since the
  // read. A lost claim means another replica is forwarding these rows (or
  // part of them; the remainder comes back on the next tick).
  const last = rows[rows.length - 1]
  const next: RelayCursor = { ts: last.timestamp.toISOString(), id: last.id }
  const { count } = await prisma.setting.updateMany({
    where: { ...CURSOR_WHERE.key_tenantId, value: { equals: stored.value as Prisma.InputJsonValue } },
    data: { value: next, updatedAt: now() },
  })
  if (count === 0) return 0

  for (const row of rows) await forward(toSyslogEvent(row))
  return rows.length
}

export interface OrchestratorRelayOptions extends OrchestratorRelayDeps {
  intervalMs?: number
  /** Overridable for the timer tests; defaults to relayOrchestratorAuditOnce. */
  relay?: (deps: OrchestratorRelayDeps) => Promise<number>
}

/**
 * Start the periodic relay. Idempotent: a second call returns the stop()
 * of the running relay. Timer discipline as in sessionSweeper.ts: an
 * in-flight guard so a slow batch cannot overlap the next tick, unref() so
 * the timer never keeps the process alive, and an error path that never
 * throws and warns at most once every five minutes.
 *
 * @returns A stop() function, safe to call multiple times.
 */
export function startOrchestratorAuditRelay(options: OrchestratorRelayOptions = {}): () => void {
  const running = state()
  if (running) return running.stop

  const { intervalMs = ORCHESTRATOR_RELAY_INTERVAL_MS, relay = relayOrchestratorAuditOnce, ...deps } = options
  let stopped = false
  let inFlight = false

  const tick = () => {
    if (stopped || inFlight) return
    inFlight = true
    relay(deps)
      .catch(err => {
        const current = state()
        const at = Date.now()
        if (current && at - current.warnedAt > WARN_EVERY_MS) {
          current.warnedAt = at
          console.warn('[syslog] orchestrator audit relay failed:', err instanceof Error ? err.message : err)
        }
      })
      .finally(() => {
        inFlight = false
      })
  }

  const timer = setInterval(tick, intervalMs)
  if (typeof (timer as any).unref === 'function') (timer as any).unref()

  const stop = () => {
    if (stopped) return
    stopped = true
    clearInterval(timer)
    if (state()?.stop === stop) setState(undefined)
  }
  setState({ stop, warnedAt: 0 })
  return stop
}
