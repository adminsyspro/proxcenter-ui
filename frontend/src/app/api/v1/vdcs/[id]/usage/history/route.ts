import { NextRequest, NextResponse } from 'next/server'

import { checkPermission, getAccessibleResources, getRBACContext, PERMISSIONS } from '@/lib/rbac'
import { filterVisibleVdcs, type VdcVisibilityGrant } from '@/lib/rbac/vdcVisibility'
import { getCurrentTenantId } from '@/lib/tenant'
import { getVdcById } from '@/lib/vdc'
import { findHistoryIdentity } from '@/lib/vdc/usageHistory/deleted'
import { usageHistoryResponse } from '@/lib/vdc/usageHistory/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/v1/vdcs/{id}/usage/history: usage history of one of the current
// tenant's vDCs, same shape as the provider route. A vDC of another tenant is
// refused, and so is one the user's grants hide from the vDC switcher. A
// deleted vDC of the tenant answers from the samples kept until the retention
// expires, under the same checks, from the identity its samples recorded.
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params

    if (!id) return NextResponse.json({ error: 'Missing vDC ID' }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const vdc = await getVdcById(id)
    const gone = vdc ? null : await findHistoryIdentity(id)
    let target: { id: string; name: string; tenantId: string; connectionId: string; pvePoolName: string; nodes: string[] } | null = null
    if (vdc) {
      target = { id: vdc.id, name: vdc.name, tenantId: vdc.tenantId, connectionId: vdc.connectionId, pvePoolName: vdc.pvePoolName, nodes: vdc.nodes }
    } else if (gone) {
      target = { id: gone.id, name: gone.name, tenantId: gone.tenantId, connectionId: gone.connectionId, pvePoolName: gone.pvePoolName, nodes: [] }
    }

    if (!target) return NextResponse.json({ error: 'vDC not found' }, { status: 404 })

    const tenantId = await getCurrentTenantId()
    if (target.tenantId !== tenantId) {
      return NextResponse.json({ error: 'vDC not accessible' }, { status: 403 })
    }

    // Same visibility as GET /api/v1/vdcs: admins and API tokens see every
    // vDC of the tenant, a user with mappable grants only the vDCs they cover,
    // and a resolver error falls back to the tenant boundary checked above.
    let grants: VdcVisibilityGrant[] | null = null
    try {
      const rbacCtx = await getRBACContext()
      if (rbacCtx && !rbacCtx.isAdmin && rbacCtx.userId) {
        grants = await getAccessibleResources(rbacCtx.userId, PERMISSIONS.VM_VIEW, rbacCtx.tenantId)
      }
    } catch {
      grants = null
    }
    if (filterVisibleVdcs([target], grants).length === 0) {
      return NextResponse.json({ error: 'vDC not accessible' }, { status: 403 })
    }

    return await usageHistoryResponse(target, req.nextUrl.searchParams, undefined, { deleted: !vdc })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
