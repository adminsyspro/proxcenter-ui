import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderAdmin } from '@/lib/tenant/providerGuard'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'

/** How long ProxCenter keeps its copy of the Proxmox tasks (#1225). */
export async function GET() {
  try {
    const permError = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (permError) return permError

    const data = await orchestratorFetch<any>('/task-history/settings')

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

async function handlePut(req: Request) {
  try {
    // One retention for the whole fleet: a provider operation, like the
    // change tracking one.
    const permError = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
    if (permError) return permError

    const body = await req.json()
    const retentionDays = Number(body?.retentionDays)

    if (!Number.isInteger(retentionDays)) {
      return NextResponse.json({ error: 'retentionDays must be a whole number of days' }, { status: 400 })
    }

    const data = await orchestratorFetch<any>('/task-history/settings', { method: 'PUT', body: { retentionDays } })

    return NextResponse.json(data)
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
  }
}

export const PUT = withAudit({ category: 'security', resourceType: 'setting' }, handlePut)
