import { NextRequest, NextResponse } from 'next/server'

import { orchestratorHeaders } from '@/lib/orchestrator/headers'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'

export async function PUT(req: NextRequest) {
  const guard = await requireFeature(Features.HA)
  if (guard) return guard
  const perm = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (perm) return perm

  try {
    const body = await req.json()
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/ha/sync-mode`, {
      method: 'PUT',
      headers: { ...orchestratorHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Orchestrator unavailable' }, { status: 503 })
  }
}
