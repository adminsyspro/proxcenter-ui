import { NextResponse } from 'next/server'

import { orchestratorHeaders } from '@/lib/orchestrator/headers'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || 'http://localhost:8080'

export async function GET() {
  // No license guard: cluster status stays readable when the option expired
  // (spec v5 D2); the backend GET is equally ungated.
  const perm = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (perm) return perm

  try {
    const res = await fetch(`${ORCHESTRATOR_URL}/api/v1/ha/cluster`, {
      headers: orchestratorHeaders(),
      cache: 'no-store',
    })
    const data = await res.json()
    return NextResponse.json(data, { status: res.status })
  } catch {
    return NextResponse.json({ error: 'Orchestrator unavailable' }, { status: 503 })
  }
}
