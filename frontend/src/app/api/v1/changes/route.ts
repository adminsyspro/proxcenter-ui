import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { buildChangeVisibilityCtx, isChangeVisibleToTenant } from '@/lib/changes/visibility'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    // connection.view baseline; tenant filtering happens further down via
    // getTenantConnectionIds so cross-tenant change events never surface.
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (permError) return permError

    const { searchParams } = new URL(req.url)
    const params = new URLSearchParams()

    for (const [key, value] of searchParams.entries()) {
      params.set(key, value)
    }

    // Multi-tenant clusters need more than a connection-level filter: change
    // records carry no pool field, so guest ownership (vDC pool VMIDs) is the
    // mask that separates neighbours. Shared logic with /changes/recent.
    const ctx = await buildChangeVisibilityCtx()

    const query = params.toString()
    const data = await orchestratorFetch<any>(`/changes${query ? `?${query}` : ''}`)

    if (data?.data && Array.isArray(data.data)) {
      data.data = data.data.filter((c: any) => isChangeVisibleToTenant(c, ctx))
    }

    return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Error fetching changes:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}

export async function DELETE() {
  try {
    const permError = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (permError) return permError

    const data = await orchestratorFetch<any>('/changes', { method: 'DELETE' })

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'Server error' },
      { status: 500 }
    )
  }
}
