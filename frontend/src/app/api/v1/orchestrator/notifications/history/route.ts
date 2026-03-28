export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { getTenantConnectionIds } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export async function GET(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const limit = Number.parseInt(searchParams.get('limit') || '20')
    const offset = Number.parseInt(searchParams.get('offset') || '0')

    const tenantConnectionIds = await getTenantConnectionIds()

    // Fetch more to account for filtering
    const data = await orchestratorFetch(`/notifications/history?limit=500&offset=0`)

    // Filter by tenant connections
    const items = Array.isArray(data) ? data : ((data as any)?.data || [])
    const filtered = Array.isArray(items)
      ? items.filter((n: any) => !n.connection_id || tenantConnectionIds.has(n.connection_id))
      : items

    const sliced = Array.isArray(filtered) ? filtered.slice(offset, offset + limit) : filtered

    return NextResponse.json({
      ...(typeof data === 'object' && !Array.isArray(data) ? data : {}),
      data: sliced,
      total: Array.isArray(filtered) ? filtered.length : 0,
    })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to get notification history:', error)
    }
    
return NextResponse.json(
      { error: error.message || 'Failed to get notification history' },
      { status: 500 }
    )
  }
}
