import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orchestrator/alerts/rules/[id]/toggle
 * Active/désactive une règle (vérifie l'appartenance au tenant)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // Verify rule belongs to tenant
    const rule = await orchestratorFetch(`/alerts/rules/${id}`) as any
    if (rule?.connection_id) {
      const tenantConnectionIds = await getTenantConnectionIds()
      if (!tenantConnectionIds.has(rule.connection_id)) {
        return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
      }
    }

    const result = await orchestratorFetch(`/alerts/rules/${id}/toggle`, {
      method: 'POST'
    })

    return NextResponse.json(result)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/rules/[id]/toggle] POST error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to toggle rule' },
      { status: 500 }
    )
  }
}
