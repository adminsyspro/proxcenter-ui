import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderAdmin } from '@/lib/tenant/providerGuard'
import { buildChangeVisibilityCtx, isChangeVisibleToTenant, redactChangeForTenant } from '@/lib/changes/visibility'
import { withAudit } from '@/lib/audit/withAudit'

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

    // Multi-tenant clusters need more than a connection-level filter: the pool
    // a guest record was written under separates neighbours, and an author
    // from another tenant is masked. Shared logic with /changes/recent.
    const ctx = await buildChangeVisibilityCtx()

    const query = params.toString()
    const data = await orchestratorFetch<any>(`/changes${query ? `?${query}` : ''}`)

    if (data?.data && Array.isArray(data.data)) {
      data.data = data.data
        .filter((c: any) => isChangeVisibleToTenant(c, ctx))
        .map((c: any) => redactChangeForTenant(c, ctx))
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

async function handleDelete() {
  try {
    // Purges the change journal of EVERY tenant on the orchestrator: a
    // provider operation, whatever permission the caller holds in its tenant.
    const permError = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
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

export const DELETE = withAudit({ category: 'security', resourceType: 'change' }, handleDelete)
