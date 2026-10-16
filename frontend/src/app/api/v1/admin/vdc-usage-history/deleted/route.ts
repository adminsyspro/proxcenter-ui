import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderTenant } from '@/lib/tenant'
import { listDeletedVdcHistories } from '@/lib/vdc/usageHistory/deleted'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/v1/admin/vdc-usage-history/deleted: the deleted vDCs whose usage
// samples are still kept (#902), so the provider can chart and export them
// through /api/v1/admin/vdcs/{id}/usage/history until the retention expires.
export async function GET() {
  try {
    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    return NextResponse.json({ data: await listDeletedVdcHistories() })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
