// GET/POST /api/v1/compliance/profiles
import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { listProfiles, createProfile, createFromFramework } from '@/lib/compliance/profiles'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connectionId') || undefined

    const profiles = listProfiles(connectionId)
    return NextResponse.json({ data: profiles })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const body = await req.json()
    const { name, description, framework_id, connection_id, created_by } = body

    if (!name) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }

    let profile
    if (framework_id) {
      // Clone from framework
      profile = createFromFramework(framework_id, { name, description, connection_id, created_by })
    } else {
      profile = createProfile({ name, description, connection_id, created_by })
    }

    return NextResponse.json({ data: profile }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
