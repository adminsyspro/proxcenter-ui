// GET/PUT /api/v1/compliance/policies
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { authOptions } from '@/lib/auth/config'
import { demoResponse } from '@/lib/demo/demo-api'
import { getSecurityPolicies, updateSecurityPolicies } from '@/lib/compliance/policies'
import { audit } from '@/lib/audit'
import { getCurrentTenantId } from '@/lib/tenant'

export const runtime = 'nodejs'

export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const policies = getSecurityPolicies(tenantId)
    return NextResponse.json({ data: policies })
  } catch (e: any) {
    console.error('Error fetching security policies:', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}

export async function PUT(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_COMPLIANCE)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
    }

    const body = await req.json()
    const tenantId = await getCurrentTenantId()
    const updated = updateSecurityPolicies(body, session.user.id, tenantId)

    await audit({
      action: 'update',
      category: 'security',
      resourceType: 'security_policies',
      resourceId: 'default',
      resourceName: 'Security Policies',
      details: body,
    })

    return NextResponse.json({ data: updated })
  } catch (e: any) {
    console.error('Error updating security policies:', e)
    return NextResponse.json({ error: e?.message || 'Internal server error' }, { status: 500 })
  }
}
