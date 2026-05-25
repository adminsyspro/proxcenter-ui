import { prisma } from "@/lib/db/prisma"
import { encode } from "next-auth/jwt"

const SUPER_ADMIN_ROLE_ID = "role_super_admin"

export async function needsEnrollment(userId: string): Promise<boolean> {
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
  if (!sa) return false

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { totpEnabled: true },
  })
  return !user?.totpEnabled
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
