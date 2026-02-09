import { NextResponse } from 'next/server'

import { prisma } from '@/lib/db/prisma'
import { generateFingerprint } from '@/lib/alerts/fingerprint'

export const runtime = 'nodejs'

/**
 * POST /api/v1/alerts/sync
 * Synchronise les alertes détectées par le dashboard vers la base de données
 * - Crée les nouvelles alertes
 * - Met à jour les alertes existantes (lastSeenAt, occurrences)
 * - Résout automatiquement les alertes qui ne sont plus présentes
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { alerts } = body // Array des alertes actuelles

    if (!alerts || !Array.isArray(alerts)) {
      return NextResponse.json({ error: 'alerts array is required' }, { status: 400 })
    }

    const now = new Date()
    const currentFingerprints: string[] = []
    let created = 0
    let updated = 0
    let resolved = 0

    // Traiter chaque alerte
    for (const alert of alerts) {
      const fingerprint = generateFingerprint({
        source: alert.source,
        severity: alert.severity,
        entityType: alert.entityType,
        entityId: alert.entityId,
        metric: alert.metric,
      })

      currentFingerprints.push(fingerprint)

      // Upsert l'alerte
      const existing = await prisma.alert.findUnique({ where: { fingerprint } })

      if (existing) {
        // Mettre à jour si active ou acknowledged (pas si resolved manuellement récemment)
        if (existing.status !== 'resolved' || 
            (existing.resolvedAt && (now.getTime() - existing.resolvedAt.getTime()) > 300000)) { // 5 min
          await prisma.alert.update({
            where: { fingerprint },
            data: {
              status: existing.status === 'resolved' ? 'active' : existing.status,
              resolvedAt: existing.status === 'resolved' ? null : existing.resolvedAt,
              lastSeenAt: now,
              currentValue: alert.currentValue,
              occurrences: { increment: existing.status === 'resolved' ? 0 : 1 }
            }
          })
          updated++
        }
      } else {
        // Créer nouvelle alerte
        await prisma.alert.create({
          data: {
            fingerprint,
            severity: alert.severity,
            message: alert.message,
            source: alert.source,
            sourceType: alert.sourceType || 'pve',
            entityType: alert.entityType,
            entityId: alert.entityId,
            entityName: alert.entityName,
            metric: alert.metric,
            currentValue: alert.currentValue,
            threshold: alert.threshold,
            status: 'active',
            firstSeenAt: now,
            lastSeenAt: now,
            occurrences: 1
          }
        })
        created++
      }
    }

    // Résoudre automatiquement les alertes actives qui ne sont plus présentes
    // (mais pas les alertes acknowledged - elles restent jusqu'à résolution manuelle ou réapparition)
    if (currentFingerprints.length > 0) {
      const autoResolved = await prisma.alert.updateMany({
        where: {
          status: 'active',
          fingerprint: { notIn: currentFingerprints },

          // Ne pas auto-résoudre les alertes vues très récemment (évite les faux positifs)
          lastSeenAt: { lt: new Date(now.getTime() - 60000) } // 1 min
        },
        data: {
          status: 'resolved',
          resolvedAt: now
        }
      })

      resolved = autoResolved.count
    } else {
      // Aucune alerte actuelle = tout résoudre
      const autoResolved = await prisma.alert.updateMany({
        where: {
          status: 'active',
          lastSeenAt: { lt: new Date(now.getTime() - 60000) }
        },
        data: {
          status: 'resolved',
          resolvedAt: now
        }
      })

      resolved = autoResolved.count
    }

    return NextResponse.json({
      data: {
        processed: alerts.length,
        created,
        updated,
        resolved,
        timestamp: now.toISOString()
      }
    })
  } catch (error: any) {
    console.error('[alerts/sync] POST error:', error)
    
return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}
