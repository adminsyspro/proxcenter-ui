// POST /api/v1/compliance/profiles/[profileId]/activate
import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getProfile, setActiveProfile, deactivateProfiles } from '@/lib/compliance/profiles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  ctx: { params: Promise<{ profileId: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const { profileId } = await ctx.params

    // Special case: deactivate all
    if (profileId === 'none') {
      const body = await req.json().catch(() => ({}))
      deactivateProfiles(body.connection_id)
      return NextResponse.json({ success: true })
    }

    const existing = getProfile(profileId)
    if (!existing) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    setActiveProfile(profileId, body.connection_id)

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
