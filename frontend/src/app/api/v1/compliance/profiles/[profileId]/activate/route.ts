// POST /api/v1/compliance/profiles/[profileId]/activate
import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getProfile, setActiveProfile, deactivateProfiles } from '@/lib/compliance/profiles'
import { getCurrentTenantId } from '@/lib/tenant'
import { demoResponse } from '@/lib/demo/demo-api'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  ctx: { params: Promise<{ profileId: string }> }
) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const { profileId } = await ctx.params
    const tenantId = await getCurrentTenantId()

    // Special case: deactivate all
    if (profileId === 'none') {
      const body = await req.json().catch(() => ({}))
      deactivateProfiles(body.connection_id, tenantId)
      return NextResponse.json({ success: true })
    }

    const existing = getProfile(profileId, tenantId)
    if (!existing) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    setActiveProfile(profileId, body.connection_id, tenantId)

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
