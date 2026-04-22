export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'

import { getDb } from '@/lib/db/sqlite'
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

    const db = getDb()
    const tenantId = await getCurrentTenantId()
    const row = db
      .prepare('SELECT value FROM settings WHERE key = ? AND tenant_id = ?')
      .get('alert_thresholds', tenantId) as { value: string } | undefined

    const stored = row?.value ? (() => { try { return JSON.parse(row.value) } catch { return null } })() : null
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

    const db = getDb()
    const tenantId = await getCurrentTenantId()
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO settings (key, tenant_id, value, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key, tenant_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run('alert_thresholds', tenantId, JSON.stringify(thresholds), now)

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
