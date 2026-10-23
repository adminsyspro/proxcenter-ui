import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderAdmin } from '@/lib/tenant/providerGuard'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (permError) return permError

    const data = await orchestratorFetch<any>('/changes/settings')

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

async function handlePut(req: Request) {
  try {
    // The orchestrator keeps one change-tracking configuration for the whole
    // fleet, so writing it is a provider operation, not a tenant one.
    const permError = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
    if (permError) return permError

    const body = await req.json()
    const data = await orchestratorFetch<any>('/changes/settings', { method: 'PUT', body })

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

export const PUT = withAudit({ category: 'security', resourceType: 'setting' }, handlePut)
