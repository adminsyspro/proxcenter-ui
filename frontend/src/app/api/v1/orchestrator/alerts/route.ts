import crypto from 'crypto'
import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { getSessionPrisma, getTenantConnectionIds } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Build a fingerprint from an orchestrator alert to match against silences.
 * Mirrors the logic in src/lib/alerts/fingerprint.ts but adapted for orchestrator alert shape.
 */
function buildOrchestratorFingerprint(alert: {
  connection_id?: string
  type?: string
  severity?: string
  resource?: string
  resource_type?: string
}): string {
  const source = alert.connection_id ? `${alert.connection_id}:${alert.type || ''}` : (alert.type || '')
  const data = `${source}|${alert.severity || ''}|${alert.resource_type || ''}|${alert.resource || ''}|${alert.type || ''}`
  return crypto.createHash('md5').update(data).digest('hex')
}

/**
 * GET /api/v1/orchestrator/alerts
 * Récupère les alertes depuis l'orchestrator, filtrées par tenant
 */
export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined
    const status = searchParams.get('status') as 'active' | 'acknowledged' | 'resolved' | undefined
    const limit = searchParams.get('limit') ? Number.parseInt(searchParams.get('limit')!) : 100
    const offset = searchParams.get('offset') ? Number.parseInt(searchParams.get('offset')!) : 0

    // Get tenant's connection IDs for filtering
    const prisma = await getSessionPrisma()
    const tenantConnections = await prisma.connection.findMany({ select: { id: true } })
    const tenantConnectionIds = new Set(tenantConnections.map((c: any) => c.id))

    const response = await alertsApi.getAlerts({
      connection_id: connectionId,
      status: status || undefined,
      limit: 500, // fetch more, filter below
      offset: 0
    })

    // Filter alerts to only include those from tenant's connections
    const allAlerts = response.data?.data || response.data || []
    const filtered = Array.isArray(allAlerts)
      ? allAlerts.filter((a: any) => !a.connection_id || tenantConnectionIds.has(a.connection_id))
      : allAlerts

    // Load active silences for this tenant (graceful fallback if table doesn't exist yet)
    const now = new Date()
    let silenceMap = new Map<string, any>()

    try {
      const silences = await prisma.alertSilence.findMany({
        where: {
          OR: [
            { silencedUntil: null },
            { silencedUntil: { gt: now } },
          ],
        },
      })

      silenceMap = new Map(silences.map(s => [s.fingerprint, s]))

      // Clean up expired silences in the background
      prisma.alertSilence.deleteMany({
        where: {
          silencedUntil: { not: null, lte: now },
        },
      }).catch(() => {})
    } catch {
      // Table may not exist yet — continue without silence annotations
    }

    // Annotate alerts with silence state, filter out dismissed
    const annotated = Array.isArray(filtered)
      ? filtered.reduce((acc: any[], a: any) => {
          const fp = buildOrchestratorFingerprint(a)
          const silence = silenceMap.get(fp)
          if (silence?.reason === 'dismissed') return acc // dismissed = hidden entirely
          if (silence) {
            acc.push({
              ...a,
              status: 'silenced',
              silenced_until: silence.silencedUntil?.toISOString() || null,
              silenced_by: silence.silencedBy,
              _original_status: a.status,
              _fingerprint: fp,
            })
          } else {
            acc.push({ ...a, _fingerprint: fp })
          }
          return acc
        }, [])
      : filtered

    // Deduplicate by fingerprint: keep only the most recent entry per unique alert
    const deduped = Array.isArray(annotated)
      ? Array.from(
          annotated.reduce((map: Map<string, any>, a: any) => {
            const fp = a._fingerprint
            const existing = map.get(fp)
            if (!existing || new Date(a.last_seen_at) > new Date(existing.last_seen_at)) {
              // Sum occurrences across duplicates
              map.set(fp, { ...a, occurrences: (existing ? existing.occurrences : 0) + (a.occurrences || 0) })
            } else {
              existing.occurrences = (existing.occurrences || 0) + (a.occurrences || 0)
            }
            return map
          }, new Map()).values()
        )
      : annotated

    // Apply post-annotation status filter (e.g. ?status=active should exclude silenced)
    const finalFiltered = Array.isArray(deduped) && status
      ? deduped.filter((a: any) => a.status === status)
      : deduped

    const sliced = Array.isArray(finalFiltered) ? finalFiltered.slice(offset, offset + limit) : finalFiltered

    return NextResponse.json({
      ...(response.data || {}),
      data: sliced,
      total: Array.isArray(finalFiltered) ? finalFiltered.length : 0,
    })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts] GET error:', error)
    }
    
    // Si l'orchestrator n'est pas disponible, retourner une liste vide
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) {
      return NextResponse.json({
        data: [],
        total: 0,
        limit: 100,
        offset: 0,
        error: 'Orchestrator unavailable'
      })
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to fetch alerts' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/v1/orchestrator/alerts
 * Efface toutes les alertes actives (scoped to tenant connections)
 */
export async function DELETE(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined

    // Verify connection belongs to tenant if specified
    if (connectionId) {
      const tenantConnectionIds = await getTenantConnectionIds()
      if (!tenantConnectionIds.has(connectionId)) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
      }
    }

    const response = await alertsApi.clearAll(connectionId)

    return NextResponse.json(response.data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts] DELETE error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to clear alerts' },
      { status: 500 }
    )
  }
}
