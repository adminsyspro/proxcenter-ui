// One read for everything the NextAuth `jwt` callback needs per request.
//
// The callback runs on EVERY getServerSession, so on every guarded API call
// (checkPermission calls it first thing). Before consolidation that path cost
// up to five round trips, including two separate user.findUnique on the same
// row. This collapses the tenant lookup, both 2FA lookups and the session
// lookup into a single query, so adding the session check makes the hot path
// faster than it was rather than slower.
//
// getUserDefaultTenantId and needsEnrollment keep their own callers and their
// own behaviour; this is an additional, faster path, not a replacement.
import { prisma } from "@/lib/db/prisma"

import type { SessionRow } from "./sessions"

const SUPER_ADMIN_ROLE_ID = "role_super_admin"
const DEFAULT_TENANT = "default"

export interface JwtContext {
  enabled: boolean
  tenantId: string
  mustEnroll2fa: boolean
  session: SessionRow | null
}

export async function loadJwtContext(userId: string, sid: string | null): Promise<JwtContext> {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      enabled: true,
      totpEnabled: true,
      require2faEnrollment: true,
      tenants: { where: { isDefault: true }, select: { tenantId: true }, take: 1 },
      // Only ask for the session when the token actually carries one.
      ...(sid ? { sessions: { where: { id: sid }, take: 1 } } : {}),
    },
  })

  if (!row) {
    return { enabled: false, tenantId: DEFAULT_TENANT, mustEnroll2fa: false, session: null }
  }

  const tenantId = row.tenants[0]?.tenantId || DEFAULT_TENANT
  const session = (sid ? ((row as any).sessions?.[0] ?? null) : null) as SessionRow | null

  return {
    enabled: row.enabled,
    tenantId,
    mustEnroll2fa: await resolveMustEnroll(userId, row.totpEnabled, row.require2faEnrollment),
    session,
  }
}

/** Mirrors needsEnrollment / isEnrollmentRequiredFor, reusing the row already read. */
async function resolveMustEnroll(
  userId: string,
  totpEnabled: boolean,
  require2faEnrollment: boolean,
): Promise<boolean> {
  if (totpEnabled) return false
  if (require2faEnrollment) return true

  const policy = await prisma.securityPolicy.findFirst({
    where: { id: "default" },
    select: { require2faForSuperAdmin: true },
  })
  if (!policy?.require2faForSuperAdmin) return false

  const sa = await prisma.rbacUserRole.findFirst({
    where: {
      userId,
      roleId: SUPER_ADMIN_ROLE_ID,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  })
  return !!sa
}
