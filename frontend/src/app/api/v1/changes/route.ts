import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getCurrentTenantId, getTenantConnectionIds } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'

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

    const tenantConnectionIds = await getTenantConnectionIds()
    // For multi-tenant clusters, connection-level filter is not enough: a
    // vDC tenant on a cluster shared with the provider (or another tenant)
    // would otherwise see every change on that cluster regardless of node
    // or pool. Pull the vDC scope and tighten on (node, pool) when present.
    const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
    const vdcScope = maskingScope(infra)

    const query = params.toString()
    const data = await orchestratorFetch<any>(`/changes${query ? `?${query}` : ''}`)

    if (data?.data && Array.isArray(data.data)) {
      data.data = data.data.filter((c: any) => {
        // Strict: drop records without a connection. App-wide events are
        // cluster-less and can leak provider-internal state to tenants.
        if (!c.connectionId) return infra.kind === 'provider'
        if (!tenantConnectionIds.has(c.connectionId)) return false
        // Provider tenants (no scope) keep the connection-level filter only.
        if (!vdcScope) return true
        // vDC tenants: enforce node + pool whitelists from the scope.
        const allowedNodes = vdcScope.nodesByConnection.get(c.connectionId)
        if (allowedNodes && c.node && !allowedNodes.has(c.node)) return false
        const allowedPools = vdcScope.poolsByConnection.get(c.connectionId)
        if (allowedPools && c.pool && !allowedPools.has(c.pool)) return false
        return true
      })
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
