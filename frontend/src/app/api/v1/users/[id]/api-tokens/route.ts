// GET /api/v1/users/[id]/api-tokens — the API tokens a user created that are
// still live (issue #632).
//
// Deliberately hung off /users rather than /settings/api-tokens: this is the
// offboarding view, read by the user-admin dialogs before disabling or
// deleting an account, so it is guarded by admin.users like the rest of that
// screen. Routing it through the token-management API instead would have
// demanded admin.apitokens from an admin who only manages people.
//
// It never exposes a secret or a hash — the projection is the same handful of
// identifying fields the offboarding warning displays.
import { NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyIfTargetIsProtectedAndCallerIsNot, findUserInTenant } from "@/lib/rbac/userTargetGuards"
import { DEFAULT_TENANT_ID, getCurrentTenantId } from "@/lib/tenant"
import { listActiveTokensCreatedBy } from "@/lib/api-tokens/creatorTokens"

export const runtime = "nodejs"

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)
    if (denied) return denied

    const { id } = await params
    const session = await getServerSession(authOptions)
    const superAdminBlock = await denyIfTargetIsProtectedAndCallerIsNot(id, session?.user?.id)
    if (superAdminBlock) return superAdminBlock

    const tenantId = await getCurrentTenantId()
    const isProviderView = tenantId === DEFAULT_TENANT_ID

    // Same target resolution as GET /api/v1/users/[id]: the provider view
    // reaches any account, a tenant-scoped caller only reaches its own
    // members, so ids from another tenant cannot be probed.
    const user = isProviderView
      ? await prisma.user.findUnique({ where: { id }, select: { id: true } })
      : await findUserInTenant(id, tenantId)

    if (!user) {
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
    }

    // A tenant-scoped admin only sees, and later only revokes, the tokens
    // living in the tenant they are acting from.
    const tokens = await listActiveTokensCreatedBy(id, isProviderView ? undefined : tenantId)

    return NextResponse.json({
      data: tokens.map(t => ({
        id: t.id,
        name: t.name,
        token_prefix: t.tokenPrefix,
        tenant_id: t.tenantId,
        tenant_name: t.tenantName,
        scopes: t.scopes,
        last_used_at: t.lastUsedAt?.toISOString() ?? null,
        expires_at: t.expiresAt?.toISOString() ?? null,
        created_at: t.createdAt.toISOString(),
      })),
    })
  } catch (error: any) {
    console.error("Erreur GET user api-tokens:", error)
    return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}
