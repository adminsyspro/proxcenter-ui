import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  try {
    const permError = await checkPermission(PERMISSIONS.EVENTS_VIEW)
    if (permError) return permError

    const { searchParams } = new URL(req.url)
    const params = new URLSearchParams()

    for (const [key, value] of searchParams.entries()) {
      params.set(key, value)
    }

    const tenantConnectionIds = await getTenantConnectionIds()
    const query = params.toString()
    const data = await orchestratorFetch<any>(`/changes${query ? `?${query}` : ''}`)

    // Filter changes by tenant connections
    if (data?.data && Array.isArray(data.data)) {
      data.data = data.data.filter((c: any) => !c.connectionId || tenantConnectionIds.has(c.connectionId))
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
