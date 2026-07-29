export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'

import { authOptions } from '@/lib/auth/config'
import { listActiveForPrincipal, resolvePrincipalRoles } from '@/lib/db/broadcasts'

export async function GET() {
  const session = await getServerSession(authOptions)
  const userId = (session as any)?.user?.id as string | undefined
  if (!userId) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  // The tenant the user is currently positioned on. Read straight from the
  // session: this is a display filter, and getCurrentTenantId() would silently
  // rewrite it to "default".
  const tenantId = ((session as any)?.user?.tenantId as string | undefined) || 'default'

  try {
    const { roleIds, legacyRole } = await resolvePrincipalRoles(userId, tenantId)
    const data = await listActiveForPrincipal({ userId, tenantId, roleIds, legacyRole }, new Date())
    return NextResponse.json({ data })
  } catch {
    // A banner is never worth breaking the dashboard for: degrade to "no
    // banner" instead of surfacing a 500 into the layout.
    return NextResponse.json({ data: [] })
  }
}
