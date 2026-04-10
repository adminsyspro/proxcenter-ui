import { NextResponse } from 'next/server'

import { getSessionPrisma, getCurrentTenantId } from '@/lib/tenant'
import { silenceAlertSchema } from '@/lib/schemas'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'

const DURATION_MS: Record<string, number | null> = {
  '1h': 60 * 60 * 1000,
  '6h': 6 * 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  'indefinite': null,
}

/**
 * GET /api/v1/alerts/silence
 * List all active silences for this tenant
 */
export async function GET(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const permError = await checkPermission(PERMISSIONS.ALERTS_VIEW)
    if (permError) return permError

    const silences = await prisma.alertSilence.findMany({
      orderBy: { silencedAt: 'desc' },
    })

    return NextResponse.json({ data: silences })
  } catch (error: any) {
    console.error('[alerts/silence] GET error:', error)
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

/**
 * POST /api/v1/alerts/silence
 * Silence an alert by fingerprint
 */
export async function POST(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const permError = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (permError) return permError

    const rawBody = await req.json()
    const parseResult = silenceAlertSchema.safeParse(rawBody)

    if (!parseResult.success) {
      return NextResponse.json(
        { error: 'Invalid input', details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const { fingerprint, duration, reason } = parseResult.data
    const tenantId = await getCurrentTenantId()
    const now = new Date()
    const durationMs = DURATION_MS[duration]
    const silencedUntil = durationMs ? new Date(now.getTime() + durationMs) : null

    const silence = await prisma.alertSilence.upsert({
      where: { tenantId_fingerprint: { tenantId, fingerprint } },
      create: {
        fingerprint,
        silencedBy: 'user',
        silencedAt: now,
        silencedUntil,
        reason: reason || null,
      },
      update: {
        silencedBy: 'user',
        silencedAt: now,
        silencedUntil,
        reason: reason || null,
      },
    })

    return NextResponse.json({ data: silence })
  } catch (error: any) {
    console.error('[alerts/silence] POST error:', error)
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/alerts/silence
 * Remove a silence (unmute) by fingerprint
 */
export async function DELETE(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const permError = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (permError) return permError

    const { searchParams } = new URL(req.url)
    const fingerprint = searchParams.get('fingerprint')

    if (!fingerprint) {
      return NextResponse.json({ error: 'fingerprint is required' }, { status: 400 })
    }

    const result = await prisma.alertSilence.deleteMany({
      where: { fingerprint },
    })

    return NextResponse.json({ data: { deleted: result.count } })
  } catch (error: any) {
    console.error('[alerts/silence] DELETE error:', error)
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}
