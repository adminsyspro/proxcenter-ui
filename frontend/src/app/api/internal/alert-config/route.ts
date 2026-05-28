export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'
import { getSetting } from '@/lib/db/settings'
import { DEFAULT_TENANT_ID } from '@/lib/tenant'

export const runtime = 'nodejs'

const DEFAULT_THRESHOLDS = {
  cpu_warning: 80,
  cpu_critical: 90,
  memory_warning: 80,
  memory_critical: 90,
  storage_warning: 80,
  storage_critical: 90,
  snapshot_max_age_days: 7,
}

type Thresholds = typeof DEFAULT_THRESHOLDS

// Fields the Go orchestrator decodes as int (see backend AlertThresholds).
// A fractional value here makes the configsync JSON decode fail and the worker
// rejects the entire payload, leaving thresholds and silences silently stale.
const INT_THRESHOLD_KEYS: ReadonlySet<keyof Thresholds> = new Set(['snapshot_max_age_days'])

function coerceThresholds(raw: unknown): Thresholds {
  const t = { ...DEFAULT_THRESHOLDS }
  if (!raw || typeof raw !== 'object') return t
  const obj = raw as Record<string, unknown>
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as (keyof Thresholds)[]) {
    const v = obj[key]
    if (typeof v !== 'number' || !Number.isFinite(v)) continue
    t[key] = INT_THRESHOLD_KEYS.has(key) ? Math.trunc(v) : v
  }
  return t
}

/**
 * GET /api/v1/internal/alert-config
 *
 * Consolidated config endpoint consumed by the Go orchestrator's configsync
 * worker (issue #359). It pulls the current alert thresholds and the active
 * silence set every 30s so the orchestrator no longer relies on the frontend
 * pushing changes synchronously (the old PUT best-effort push was racy and
 * silently dropped writes on a cold orchestrator).
 *
 * Auth: shared X-API-Key matching process.env.ORCHESTRATOR_API_KEY. A missing
 * or empty env var always denies — we never want a misconfigured deployment
 * to expose this endpoint without a key.
 *
 * Tenant scope: optional X-Tenant-ID header (default: provider tenant
 * `default`). Phase B keeps the orchestrator single-tenant, but the header
 * is wired through now to avoid a breaking change later.
 *
 * Body excludes expired silences (server-side OR filter) — the orchestrator
 * does not need to re-evaluate `silenced_until` on the wire and a stale row
 * was previously the only way to "unsilence by inaction".
 *
 * Cache-Control is `no-store` because thresholds and silences must propagate
 * within the 30s poll cycle; an upstream proxy caching this response would
 * pin alerting to a frozen state.
 */
export async function GET(req: Request) {
  const expectedKey = process.env.ORCHESTRATOR_API_KEY
  const providedKey = req.headers.get('X-API-Key')

  if (!expectedKey || !providedKey || providedKey !== expectedKey) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const tenantId = req.headers.get('X-Tenant-ID') || DEFAULT_TENANT_ID

  try {
    const storedThresholds = await getSetting<unknown>('alert_thresholds', tenantId)
    const thresholds = coerceThresholds(storedThresholds)

    const now = new Date()
    const silenceRows = await prisma.alertSilence.findMany({
      where: {
        tenantId,
        OR: [
          { silencedUntil: null },
          { silencedUntil: { gt: now } },
        ],
      },
      select: { fingerprint: true, silencedUntil: true },
    })

    const silences = silenceRows.map(s => ({
      fingerprint: s.fingerprint,
      silenced_until: s.silencedUntil ? s.silencedUntil.toISOString() : null,
    }))

    return NextResponse.json(
      {
        thresholds,
        silences,
        generated_at: now.toISOString(),
      },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'internal error'
    console.error('[internal/alert-config] GET error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
