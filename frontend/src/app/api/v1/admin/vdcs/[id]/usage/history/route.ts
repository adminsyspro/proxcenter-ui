import { NextRequest, NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderTenant } from '@/lib/tenant'
import { getVdcById } from '@/lib/vdc'
import { findHistoryIdentity } from '@/lib/vdc/usageHistory/deleted'
import { usageHistoryResponse } from '@/lib/vdc/usageHistory/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = { params: Promise<{ id: string }> }

// GET /api/v1/admin/vdcs/{id}/usage/history: usage history of any vDC, per
// period (max, average, last value per counter), JSON or CSV. Provider only.
// A deleted vDC answers from the samples kept until the retention expires.
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { id } = await ctx.params

    if (!id) return NextResponse.json({ error: 'Missing vDC ID' }, { status: 400 })

    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const vdc = await getVdcById(id)
    if (vdc) return await usageHistoryResponse(vdc, req.nextUrl.searchParams)

    const gone = await findHistoryIdentity(id)
    if (!gone) return NextResponse.json({ error: 'vDC not found' }, { status: 404 })

    return await usageHistoryResponse(gone, req.nextUrl.searchParams, undefined, { deleted: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
