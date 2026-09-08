export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'

import { getSetting, setSetting } from '@/lib/db/settings'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { alertsApi, parseOrchestratorError } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'

export const runtime = 'nodejs'

const DEFAULT_THRESHOLDS = {
  cpu_warning: 80,
  cpu_critical: 90,
  memory_warning: 80,
  memory_critical: 90,
  storage_warning: 80,
  storage_critical: 90,
  snapshot_max_age_days: 7,
  // RE2 regex, evaluated by the orchestrator, naming the VMs and snapshots the
  // stale-snapshot check leaves alone, e.g. `(?i)replica` for Veeam replicas
  // and their VeeamRP restore points (discussion #875). Empty excludes nothing.
  snapshot_exclude_pattern: '',
  // Hysteresis before an alert is declared resolved (#551): how far below the
  // warning threshold the metric must fall, and for how many consecutive
  // collections. Without it, a value oscillating around the threshold emits a
  // firing and a recovery notification every minute.
  recovery_margin: 5,
  recovery_confirmations: 3,
  // Ceph OSD commit/apply latency in milliseconds (#721). 0 disables the whole
  // OSD latency check, mirroring the snapshot_max_age_days convention.
  osd_latency_warning: 0,
  osd_latency_critical: 250,
  // Guest disk latency in milliseconds, derived from QEMU block statistics
  // (#881). 0 disables the check like the OSD one; the window is how long a
  // disk or storage must stay above a threshold before it alerts.
  disk_latency_warning: 0,
  disk_latency_critical: 100,
  disk_latency_window_minutes: 5,
  // Days of per-disk latency history kept for the charts, and the collection
  // switch itself (1 = on): one PVE call per running VM per collection.
  disk_latency_retention_days: 30,
  disk_latency_collection: 1,
  // Tolerance above a replication job's own RPO target before its last
  // successful sync is considered late, as a percentage of that target (#721).
  // 0 disables the replication alerts.
  replication_rpo_grace_percent: 25,
  // Alert when a replication job errors out (#721). 0 disables, 1 enables.
  // Independent from the RPO grace above: an operator can want to hear about a
  // job that failed outright without hearing about one that merely drifted.
  replication_failure_alerts: 1,
}

type Thresholds = typeof DEFAULT_THRESHOLDS

function coerceThresholds(raw: any): Thresholds {
  const t: Record<string, number | string> = { ...DEFAULT_THRESHOLDS }
  if (!raw || typeof raw !== 'object') return t as Thresholds
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as (keyof Thresholds)[]) {
    const v = raw[key]
    if (typeof DEFAULT_THRESHOLDS[key] === 'string') {
      if (typeof v === 'string') t[key] = v.trim()
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      t[key] = v
    }
  }
  return t as Thresholds
}

/**
 * GET /api/v1/settings/alerts/thresholds
 * Reads thresholds from local SQLite. Works in Community (no orchestrator needed).
 */
export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const stored = await getSetting<any>('alert_thresholds', tenantId)
    return NextResponse.json(coerceThresholds(stored))
  } catch (error: any) {
    console.error('[settings/alerts/thresholds] GET error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch thresholds' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/v1/settings/alerts/thresholds
 * Writes thresholds to local SQLite. Also best-effort pushes to orchestrator
 * when ORCHESTRATOR_URL is configured (Enterprise), so orchestrator-driven
 * real-time monitoring stays in sync.
 */
export async function PUT(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const body = await req.json()
    const thresholds = coerceThresholds(body)

    if (process.env.ORCHESTRATOR_URL) {
      try {
        await alertsApi.updateThresholds(thresholds)
      } catch (e) {
        // Only the orchestrator can judge the RE2 exclude pattern: a JS RegExp
        // rejects `(?i)` and accepts the lookaheads RE2 refuses. Its 400 is the
        // answer the user needs, and nothing is stored on this side either.
        const orchError = parseOrchestratorError(e)
        if (orchError?.status === 400) {
          return NextResponse.json({ error: orchError.message }, { status: 400 })
        }
        console.warn('[settings/alerts/thresholds] orchestrator sync failed:', e)
      }
    }

    const tenantId = await getCurrentTenantId()
    await setSetting('alert_thresholds', tenantId, thresholds)

    return NextResponse.json(thresholds)
  } catch (error: any) {
    console.error('[settings/alerts/thresholds] PUT error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to update thresholds' },
      { status: 500 }
    )
  }
}
