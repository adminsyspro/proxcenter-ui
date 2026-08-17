export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'

import { getSetting, setSetting } from '@/lib/db/settings'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId } from '@/lib/tenant'
import { alertsApi } from '@/lib/orchestrator/client'
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
  const t = { ...DEFAULT_THRESHOLDS }
  if (!raw || typeof raw !== 'object') return t
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as (keyof Thresholds)[]) {
    const v = raw[key]
    if (typeof v === 'number' && Number.isFinite(v)) t[key] = v
  }
  return t
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

    const tenantId = await getCurrentTenantId()
    await setSetting('alert_thresholds', tenantId, thresholds)

    if (process.env.ORCHESTRATOR_URL) {
      try {
        await alertsApi.updateThresholds(thresholds)
      } catch (e) {
        console.warn('[settings/alerts/thresholds] orchestrator sync failed:', e)
      }
    }

    return NextResponse.json(thresholds)
  } catch (error: any) {
    console.error('[settings/alerts/thresholds] PUT error:', error)
    return NextResponse.json(
      { error: error?.message || 'Failed to update thresholds' },
      { status: 500 }
    )
  }
}
