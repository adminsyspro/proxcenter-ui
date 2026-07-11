import { NextRequest, NextResponse } from 'next/server'

import { orchestratorHeaders } from '@/lib/orchestrator/headers'
import { requireEnterprise } from '@/lib/auth/requireEnterprise'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'

export async function GET() {
  const guard = await requireEnterprise()
  if (guard) return guard
  const perm = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (perm) return perm

  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/ha/config`, {
      headers: orchestratorHeaders(),
      cache: 'no-store',
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Orchestrator unavailable' }, { status: 503 })
  }
}

export async function PUT(request: NextRequest) {
  const guard = await requireEnterprise()
  if (guard) return guard
  const perm = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (perm) return perm

  try {
    const body = await request.json()
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/ha/config`, {
      method: 'PUT',
      headers: orchestratorHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Orchestrator unavailable' }, { status: 503 })
  }
}
