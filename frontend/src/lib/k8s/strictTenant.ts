import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth/config'
import { prisma } from '@/lib/db/prisma'
import { userHasAccessToTenant } from '@/lib/tenant'

// Each arm names the other's member as undefined: tsconfig runs without strict,
// where `if (!t.ok)` does not narrow a union, and `t.response` must still type.
export type StrictTenant =
  | { ok: true; tenantId: string; response?: undefined }
  | { ok: false; tenantId?: undefined; response: NextResponse }

/**
 * Resolve the active tenant for K8s routes WITHOUT the soft fallback to
 * 'default' that getCurrentTenantId performs. Cluster credentials are
 * secret-bearing, so a missing/invalid tenant must fail closed.
 */
export async function resolveStrictTenant(): Promise<StrictTenant> {
  const session: any = await getServerSession(authOptions)
  const userId: string | undefined = session?.user?.id
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthenticated' }, { status: 401 }) }
  }
  const tenantId: string | undefined = session?.user?.tenantId
  if (!tenantId) {
    return { ok: false, response: NextResponse.json({ error: 'No active tenant' }, { status: 403 }) }
  }
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { enabled: true } })
  if (!tenant || !tenant.enabled) {
    return { ok: false, response: NextResponse.json({ error: 'Tenant unavailable' }, { status: 403 }) }
  }
  const allowed = await userHasAccessToTenant(userId, tenantId)
  if (!allowed) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden tenant' }, { status: 403 }) }
  }
  return { ok: true, tenantId }
}
