import { NextResponse } from 'next/server'

import { orchestratorHeaders } from '@/lib/orchestrator/headers'
import { requireFeature } from '@/lib/auth/requireEnterprise'
import { Features } from '@/lib/license/features'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ node: string }> }
) {
  const guard = await requireFeature(Features.HA)
  if (guard) return guard
  const perm = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (perm) return perm

  const { node } = await params
  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/ha/reinit/${encodeURIComponent(node)}`, {
      method: 'POST',
      headers: orchestratorHeaders(),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Orchestrator unavailable' }, { status: 503 })
  }
}
