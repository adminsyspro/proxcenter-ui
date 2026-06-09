import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId, getTenantConnectionIds } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    // connection.view baseline; results are filtered below by the tenant's
    // connection allowlist so cross-tenant change events never leak.
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (permError) return permError

    const { searchParams } = new URL(req.url)
    const limit = Number.parseInt(searchParams.get('limit') || '10')

    // Reachable connections = directly owned ∪ vDC-bound. Going through
    // the helper instead of an inline prisma.connection.findMany so MSP
    // tenants (who own no connections directly, only vDC bindings) get
    // their changes feed populated.
    const tenantConnectionIds = await getTenantConnectionIds()
    // Same multi-tenant tightening as /api/v1/changes — connection-level
    // filter alone leaks neighbour activity on shared clusters.
    const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
    const vdcScope = maskingScope(infra)

    const data = await orchestratorFetch<any>(`/changes/recent?limit=100`)

    if (data?.data && Array.isArray(data.data)) {
      data.data = data.data
        .filter((c: any) => {
          if (!c.connectionId) return infra.kind === 'provider'
          if (!tenantConnectionIds.has(c.connectionId)) return false
          if (!vdcScope) return true
          const allowedNodes = vdcScope.nodesByConnection.get(c.connectionId)
          if (allowedNodes && c.node && !allowedNodes.has(c.node)) return false
          const allowedPools = vdcScope.poolsByConnection.get(c.connectionId)
          if (allowedPools && c.pool && !allowedPools.has(c.pool)) return false
          return true
        })
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
