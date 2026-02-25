// GET/PUT/DELETE /api/v1/compliance/profiles/[profileId]
import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getProfile, getProfileChecks, updateProfile, updateProfileChecks, deleteProfile } from '@/lib/compliance/profiles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ profileId: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const { profileId } = await ctx.params
    const profile = getProfile(profileId)
    if (!profile) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const checks = getProfileChecks(profileId)
    return NextResponse.json({ data: { ...profile, checks } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(
  req: Request,
  ctx: { params: Promise<{ profileId: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const { profileId } = await ctx.params
    const existing = getProfile(profileId)
    if (!existing) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    const body = await req.json()

    // Update profile metadata
    if (body.name !== undefined || body.description !== undefined) {
      updateProfile(profileId, { name: body.name, description: body.description })
    }

    // Update checks if provided
    if (Array.isArray(body.checks)) {
      updateProfileChecks(profileId, body.checks)
    }

    const updated = getProfile(profileId)
    const checks = getProfileChecks(profileId)
    return NextResponse.json({ data: { ...updated, checks } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ profileId: string }> }
) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const { profileId } = await ctx.params
    const existing = getProfile(profileId)
    if (!existing) {
      return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
    }

    deleteProfile(profileId)
    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
