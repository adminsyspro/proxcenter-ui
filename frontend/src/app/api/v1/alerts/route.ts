import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'
import { generateFingerprint } from '@/lib/alerts/fingerprint'
import { createAlertSchema, patchAlertsSchema } from '@/lib/schemas'

export const runtime = 'nodejs'

/**
 * GET /api/v1/alerts
 * Liste des alertes avec filtres
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status') || 'all' // active, acknowledged, resolved, all
    const severity = searchParams.get('severity') || 'all'
    const source = searchParams.get('source') || 'all'
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500)

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

    const alerts = await prisma.alert.findMany({
      where,
      orderBy: [
        { status: 'asc' }, // active en premier
        { severity: 'asc' }, // crit avant warn
        { lastSeenAt: 'desc' }
      ],
      take: limit
    })

    // Stats
    const stats = await prisma.alert.groupBy({
      by: ['status', 'severity'],
      _count: true
    })

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
export async function POST(req: Request) {
  try {
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

    // Upsert: créer ou mettre à jour si existe déjà
    const alert = await prisma.alert.upsert({
      where: { fingerprint },
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
export async function PATCH(req: Request) {
  try {
    const rawBody = await req.json()
    const parseResult = patchAlertsSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const { ids, action, userId } = parseResult.data

    let updateData: any = {}

    if (action === 'acknowledge') {
      updateData = {
        status: 'acknowledged',
        acknowledgedAt: new Date(),
        acknowledgedBy: userId || 'unknown'
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
      where: { id: { in: ids } },
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
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const olderThanDays = parseInt(searchParams.get('olderThanDays') || '30')

    const cutoffDate = new Date()

    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    const result = await prisma.alert.deleteMany({
      where: {
        status: 'resolved',
        resolvedAt: { lt: cutoffDate }
      }
    })

    return NextResponse.json({ 
      data: { 
        deleted: result.count,
        message: `Deleted alerts resolved before ${cutoffDate.toISOString()}` 
      } 
    })
  } catch (error: any) {
    console.error('[alerts] DELETE error:', error)
    
return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}
