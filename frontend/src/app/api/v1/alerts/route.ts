import { NextResponse } from 'next/server'

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { generateFingerprint } from '@/lib/alerts/fingerprint'
import { createAlertSchema, patchAlertsSchema } from '@/lib/schemas'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withAudit } from '@/lib/audit/withAudit'
import { sessionAcknowledger } from '@/lib/alerts/acknowledgedBy'
import { LOCAL_ALERT_ENTITY_SELECT, localAlertFilter, refuseRestrictedAlertWrite, visibleLocalAlertIds } from '@/lib/alerts/localAlertScope'

export const runtime = 'nodejs'

const LIST_ORDER = [
  { status: 'asc' as const }, // active en premier
  { severity: 'asc' as const }, // crit avant warn
  { lastSeenAt: 'desc' as const },
]

/** How many rows a scoped caller's list and counts are read from, newest first. */
const SCOPED_READ_CAP = 5000

type StatusCount = { status: string; severity: string; _count: number }

/** The groupBy counts of a list of rows, for a caller whose rows are filtered in memory. */
function countRows(rows: { status: string; severity: string }[]): StatusCount[] {
  const counts = new Map<string, StatusCount>()
  for (const r of rows) {
    const key = `${r.status}|${r.severity}`
    const c = counts.get(key) ?? { status: r.status, severity: r.severity, _count: 0 }
    c._count += 1
    counts.set(key, c)
  }
  return [...counts.values()]
}

/** The purge window: a whole number of days, 1 to 36500; absent = 30. */
function parseOlderThanDays(raw: string | null): number | null {
  if (raw === null) return 30
  if (!/^\d{1,5}$/.test(raw)) return null
  const days = Number(raw)
  return days >= 1 && days <= 36500 ? days : null
}

/**
 * GET /api/v1/alerts
 * Liste des alertes avec filtres
 */
export async function GET(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const permError = await checkPermission(PERMISSIONS.ALERTS_VIEW)
    if (permError) return permError

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'all' // active, acknowledged, resolved, all
    const severity = searchParams.get('severity') || 'all'
    const source = searchParams.get('source') || 'all'
    const limit = Math.min(Number.parseInt(searchParams.get('limit') || '100'), 500)

    const where: any = {}

    if (status !== 'all') {
      where.status = status
    }

    if (severity !== 'all') {
      where.severity = severity
    }

    if (source !== 'all') {
      where.source = source
    }

    // The table carries no RBAC or vDC scope: a restricted caller lists and
    // counts the rows of its own inventory only (roadmap#223).
    const visible = await localAlertFilter(PERMISSIONS.ALERTS_VIEW)
    let alerts
    let stats: StatusCount[]
    if (visible) {
      const rows = (await prisma.alert.findMany({ orderBy: { lastSeenAt: 'desc' }, take: SCOPED_READ_CAP })).filter(visible)
      rows.sort((a, b) => a.status.localeCompare(b.status) || a.severity.localeCompare(b.severity) ||
        b.lastSeenAt.getTime() - a.lastSeenAt.getTime())
      alerts = rows.filter(a => Object.entries(where).every(([k, v]) => (a as Record<string, unknown>)[k] === v)).slice(0, limit)
      stats = countRows(rows)
    } else {
      alerts = await prisma.alert.findMany({ where, orderBy: LIST_ORDER, take: limit })
      stats = await prisma.alert.groupBy({ by: ['status', 'severity'], _count: true }) as unknown as StatusCount[]
    }

    const statsSummary = {
      total: alerts.length,
      active: 0,
      acknowledged: 0,
      resolved: 0,
      bySeverity: { crit: 0, warn: 0, info: 0 }
    }

    stats.forEach(s => {
      if (s.status === 'active') statsSummary.active += s._count
      if (s.status === 'acknowledged') statsSummary.acknowledged += s._count
      if (s.status === 'resolved') statsSummary.resolved += s._count
      
      if (s.status === 'active' || s.status === 'acknowledged') {
        if (s.severity === 'crit') statsSummary.bySeverity.crit += s._count
        if (s.severity === 'warn') statsSummary.bySeverity.warn += s._count
        if (s.severity === 'info') statsSummary.bySeverity.info += s._count
      }
    })

    return NextResponse.json({
      data: alerts.map(a => ({
        id: a.id,
        fingerprint: a.fingerprint,
        severity: a.severity,
        message: a.message,
        source: a.source,
        sourceType: a.sourceType,
        entityType: a.entityType,
        entityId: a.entityId,
        entityName: a.entityName,
        metric: a.metric,
        currentValue: a.currentValue,
        threshold: a.threshold,
        status: a.status,
        acknowledgedAt: a.acknowledgedAt,
        acknowledgedBy: a.acknowledgedBy,
        resolvedAt: a.resolvedAt,
        firstSeenAt: a.firstSeenAt,
        lastSeenAt: a.lastSeenAt,
        occurrences: a.occurrences,
      })),
      stats: statsSummary
    })
  } catch (error: any) {
    console.error('[alerts] GET error:', error)
    
return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

/**
 * POST /api/v1/alerts
 * Créer ou mettre à jour une alerte (upsert basé sur fingerprint)
 */
async function handlePost(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    // Same permission as PATCH, DELETE and /alerts/sync: writing an alert is a
    // management action, and this handler was the only one on the resource
    // without a check of its own (#699).
    const permError = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (permError) return permError
    // An upsert by fingerprint reactivates any row of the table: a caller
    // nothing restricts only (roadmap#223).
    const restricted = await refuseRestrictedAlertWrite()
    if (restricted) return restricted

    const rawBody = await req.json()
    const parseResult = createAlertSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const { severity, message, source, sourceType, entityType, entityId, entityName, metric, currentValue, threshold } = parseResult.data

    const fingerprint = generateFingerprint({ severity, source, entityType, entityId, metric })
    const tenantId = await getCurrentTenantId()

    // Upsert: créer ou mettre à jour si existe déjà
    const alert = await prisma.alert.upsert({
      where: { tenantId_fingerprint: { tenantId, fingerprint } },
      create: {
        fingerprint,
        severity,
        message,
        source,
        sourceType: sourceType || 'pve',
        entityType,
        entityId,
        entityName,
        metric,
        currentValue,
        threshold,
        status: 'active',
        firstSeenAt: new Date(),
        lastSeenAt: new Date(),
        occurrences: 1,
      },
      update: {
        // Si l'alerte était résolue, la réactiver
        status: 'active',
        resolvedAt: null,
        lastSeenAt: new Date(),
        currentValue,
        occurrences: { increment: 1 },
      }
    })

    return NextResponse.json({ data: alert })
  } catch (error: any) {
    console.error('[alerts] POST error:', error)
    
return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

/**
 * PATCH /api/v1/alerts
 * Mettre à jour le statut d'une ou plusieurs alertes (acknowledge, resolve)
 */
async function handlePatch(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const permError = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (permError) return permError

    const rawBody = await req.json()
    const parseResult = patchAlertsSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const { ids, action, userId } = parseResult.data

    // Only the rows the caller sees (roadmap#223).
    const targetIds = await visibleLocalAlertIds(ids, PERMISSIONS.ALERTS_MANAGE,
      list => prisma.alert.findMany({ where: { id: { in: list } }, select: LOCAL_ALERT_ENTITY_SELECT }))
    if (targetIds.length === 0) {
      return NextResponse.json({ data: { updated: 0, action } })
    }

    let updateData: any = {}

    if (action === 'acknowledge') {
      updateData = {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        // The session's user, whatever the body names (roadmap#223).
        acknowledgedBy: await sessionAcknowledger(userId)
      }
    } else if (action === 'resolve') {
      updateData = {
        status: 'resolved',
        resolvedAt: new Date()
      }
    } else if (action === 'reopen') {
      updateData = {
        status: 'active',
        acknowledgedAt: null,
        acknowledgedBy: null,
        resolvedAt: null
      }
    }

    const result = await prisma.alert.updateMany({
      where: { id: { in: targetIds } },
      data: updateData
    })

    return NextResponse.json({ 
      data: { 
        updated: result.count,
        action 
      } 
    })
  } catch (error: any) {
    console.error('[alerts] PATCH error:', error)
    
return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/alerts
 * Supprimer les alertes résolues anciennes (cleanup)
 */
async function handleDelete(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const permError = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (permError) return permError

    const { searchParams } = new URL(req.url)
    // A negative or zero window put the cutoff in the future and purged every
    // resolved alert (roadmap#223).
    const olderThanDays = parseOlderThanDays(searchParams.get('olderThanDays'))
    if (olderThanDays === null) {
      return NextResponse.json({ error: 'olderThanDays must be a whole number of days, from 1 to 36500' }, { status: 400 })
    }

    const cutoffDate = new Date()

    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    const where = { status: 'resolved', resolvedAt: { lt: cutoffDate } }
    // Only the rows the caller sees (roadmap#223).
    const visible = await localAlertFilter(PERMISSIONS.ALERTS_MANAGE)
    let deleted: number
    if (visible) {
      const ids = (await prisma.alert.findMany({ where, select: LOCAL_ALERT_ENTITY_SELECT })).filter(visible).map(r => r.id)
      deleted = ids.length === 0 ? 0 : (await prisma.alert.deleteMany({ where: { id: { in: ids } } })).count
    } else {
      deleted = (await prisma.alert.deleteMany({ where })).count
    }

    return NextResponse.json({ 
      data: { 
        deleted,
        message: `Deleted alerts resolved before ${cutoffDate.toISOString()}` 
      } 
    })
  } catch (error: any) {
    console.error('[alerts] DELETE error:', error)
    
return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

export const POST = withAudit({ category: 'alerts', resourceType: 'alert' }, handlePost)
export const PATCH = withAudit({ category: 'alerts', resourceType: 'alert' }, handlePatch)
export const DELETE = withAudit({ category: 'alerts', resourceType: 'alert' }, handleDelete)
