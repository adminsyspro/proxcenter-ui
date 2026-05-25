import { prisma } from "@/lib/db/prisma"
import { encode } from "next-auth/jwt"

const SUPER_ADMIN_ROLE_ID = "role_super_admin"

/**
 * Returns true when this user is in the scope of a 2FA requirement
 * (per-user flag OR global super_admin policy applies to them), regardless
 * of whether they currently have TOTP enabled. Use this to decide whether
 * a future disable would leave them out of compliance — e.g. to refuse
 * self-disable for accounts that the policy would immediately force back
 * into enrollment.
 */
export async function isEnrollmentRequiredFor(userId: string): Promise<boolean> {
  const [user, policy] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { require2faEnrollment: true },
    }),
    prisma.securityPolicy.findFirst({
      where: { id: "default" },
      select: { require2faForSuperAdmin: true },
    }),
  ])

  // Per-user flag set by an admin always wins.
  if (user?.require2faEnrollment) return true

  // Global super_admin policy path.
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

export async function needsEnrollment(userId: string): Promise<boolean> {
  // Already enrolled → no work to do.
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabled: true },
  })
  if (u?.totpEnabled) return false

  return isEnrollmentRequiredFor(userId)
}

/**
 * Mint a fresh NextAuth JWT cookie value with mustEnroll2fa: false.
 * Caller is responsible for writing the cookie on the response.
 */
export async function mintClearedEnrollmentJwt(token: any): Promise<string> {
  const secret = process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("NEXTAUTH_SECRET missing")
  const refreshed = { ...token, mustEnroll2fa: false }
  delete refreshed.iat
  delete refreshed.exp
  delete refreshed.jti
  return encode({ token: refreshed, secret })
}
