import { NextResponse } from 'next/server'

import { getCurrentTenantId } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { listVdcs, refreshVdcUsage } from '@/lib/vdc'

export const runtime = 'nodejs'

// Usage cache is considered fresh for 15 s. The VM-create dialog quota
// donuts hit this endpoint; anything older silently drifts from PVE reality
// and lets the client show "94 % — OK" while the backend refuses with 409.
const USAGE_FRESHNESS_MS = 15_000

// GET /api/v1/vdcs — list the current tenant's vDCs with quotas and usage.
// Refreshes each vDC's usage against PVE when the cached row is stale or
// empty so the client-side quota check matches server-side enforcement.
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)

    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    let vdcs = await listVdcs(tenantId)

    const now = Date.now()

    const stale = vdcs.filter((v) => {
      const sync = v.usage?.lastSyncedAt

      if (!sync) return true
      const age = now - new Date(sync).getTime()


return !Number.isFinite(age) || age > USAGE_FRESHNESS_MS
    })

    if (stale.length > 0) {
      await Promise.allSettled(stale.map((v) => refreshVdcUsage(v.id)))
      vdcs = await listVdcs(tenantId)
    }

    return NextResponse.json({ data: vdcs })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
