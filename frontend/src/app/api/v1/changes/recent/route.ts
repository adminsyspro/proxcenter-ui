import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { buildChangeVisibilityCtx, isChangeVisibleToTenant } from '@/lib/changes/visibility'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    // connection.view baseline; results are filtered below by the tenant's
    // connection allowlist so cross-tenant change events never leak.
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (permError) return permError

    const { searchParams } = new URL(req.url)
    const limit = Number.parseInt(searchParams.get('limit') || '10')

    // Same multi-tenant tightening as /api/v1/changes — connection-level
    // filtering alone leaks neighbour activity on shared clusters, and the
    // change feed carries no pool field, so guest ownership (vDC pool
    // VMIDs) is the mask. Shared logic with /changes.
    const ctx = await buildChangeVisibilityCtx()

    const data = await orchestratorFetch<any>(`/changes/recent?limit=100`)

    if (data?.data && Array.isArray(data.data)) {
      data.data = data.data
        .filter((c: any) => isChangeVisibleToTenant(c, ctx))
        .slice(0, limit)
    }

    return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Error fetching recent changes:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}
