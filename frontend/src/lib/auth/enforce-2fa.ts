import { prisma } from "@/lib/db/prisma"
import { encode } from "next-auth/jwt"

const SUPER_ADMIN_ROLE_ID = "role_super_admin"

export async function needsEnrollment(userId: string): Promise<boolean> {
  // Fetch the user row and the global policy in parallel to keep this fast.
  const [user, policy] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { totpEnabled: true, require2faEnrollment: true },
    }),
    prisma.securityPolicy.findFirst({
      where: { id: "default" },
      select: { require2faForSuperAdmin: true },
    }),
  ])

  // If the user already has TOTP active, no enrollment is needed regardless
  // of any flag or policy.
  if (user?.totpEnabled) return false

  // Per-user flag: admin has explicitly required this user to enroll.
  if (user?.require2faEnrollment) return true

  // Global super_admin policy path (existing behavior).
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
