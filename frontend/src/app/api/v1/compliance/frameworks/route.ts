// GET /api/v1/compliance/frameworks
import { NextResponse } from 'next/server'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { FRAMEWORKS } from '@/lib/compliance/frameworks'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    return NextResponse.json({
      data: FRAMEWORKS.map(fw => ({
        id: fw.id,
        name: fw.name,
        description: fw.description,
        version: fw.version,
        icon: fw.icon,
        color: fw.color,
        checksCount: fw.checks.length,
        checks: fw.checks,
      })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
