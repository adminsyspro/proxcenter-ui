import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { Prisma } from "@prisma/client"
import { nanoid } from "nanoid"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { findUnusedRecoveryCode, hashRecoveryCode, markRecoveryCodeConsumed, RECOVERY_CODE_PATTERN } from "./recovery"
import { verifyPassword } from "./password"
import { verifyTotp } from "./totp"
import { withTotpThrottle } from "./totpThrottle"
import { revokeAllSessions } from "./sessions"

type Tx = Prisma.TransactionClient

/**
 * Guard: returns a NextResponse (401 or 403) when the caller is not an
 * authenticated super_admin, otherwise returns null.
 * Usage: const denied = await requireSuperAdminCaller(); if (denied) return denied;
 */
export async function requireSuperAdminCaller(): Promise<NextResponse | null> {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }
  const sa = await prisma.rbacUserRole.findFirst({
    where: {
      userId: session.user.id,
      roleId: "role_super_admin",
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  })
  if (!sa) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  return null
}

export async function clearUserTotp(tx: Tx, userId: string) {
  await tx.user.update({
    where: { id: userId },
    data: {
      totpSecretEnc: null,
      totpEnabled: false,
      totpEnrolledAt: null,
      totpLastUsedStep: null,
    },
  })
  await tx.userTotpRecoveryCode.deleteMany({ where: { userId } })
}

export async function replaceRecoveryCodes(
  tx: Tx,
  userId: string,
  plainCodes: string[],
  now: Date = new Date(),
) {
  const hashes = await Promise.all(plainCodes.map(hashRecoveryCode))
  await tx.userTotpRecoveryCode.deleteMany({ where: { userId } })
  await tx.userTotpRecoveryCode.createMany({
    data: hashes.map((codeHash) => ({
      id: nanoid(),
      userId,
      codeHash,
      createdAt: now,
    })),
  })
}

/**
 * Re-auth helper of the routes that remove or replace a second factor that
 * is already on: self-disable, regenerate the recovery codes, re-enrol. It
 * asks for both factors (roadmap#280): the password AND a current code from
 * the authenticator (or an unused recovery code), so a stolen session plus
 * the password is not enough to drop the second factor. An account without
 * a local password (SSO) proves itself with the code alone.
 *
 * A wrong password burns nothing: the authenticator code is only checked
 * (and its time step spent) once the password holds, and a recovery code is
 * hashed either way, so the answer time does not reveal the password, but
 * only spent once the password holds.
 *
 * Rate limited by the same always-on floor as the sign-in second factor: a
 * stolen session could otherwise guess the password or the code through
 * these routes without limit. After too many failed re-authentications the
 * helper answers false without verifying anything, until the floor lifts.
 */
export async function verifyReauthCredentials(
  userId: string,
  passwordHash: string | null,
  body: { password?: unknown; totpCode?: unknown },
): Promise<boolean> {
  const passwordInput = typeof body.password === "string" ? body.password : ""
  const codeInput = typeof body.totpCode === "string" ? body.totpCode.trim().toUpperCase() : ""
  const outcome = await withTotpThrottle(userId, "reauth", async () => {
    const passwordOk = passwordHash ? await verifyPassword(passwordInput, passwordHash) : true
    if (RECOVERY_CODE_PATTERN.test(codeInput)) {
      // Hashed whatever the password, so the answer time does not tell a
      // right password from a wrong one; spent only once the password holds.
      const codeId = await findUnusedRecoveryCode(userId, codeInput)
      return passwordOk && codeId !== null && (await markRecoveryCodeConsumed(codeId, null))
    }
    // A wrong password never burns the current authenticator code.
    return passwordOk && (await verifyTotp(userId, codeInput))
  })
  return outcome === "ok"
}

/**
 * Set the per-user `require_2fa_enrollment` flag and emit the matching
 * audit event. Shared by the require / clear-requirement admin routes
 * so the access-check + target-fetch + audit envelope are written once.
 */
export async function setUserRequire2faFlag(
  targetId: string,
  value: boolean,
  actor: { id?: string; email?: string | null },
): Promise<NextResponse> {
  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { email: true, totpEnabled: true },
  })

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  await prisma.user.update({
    where: { id: targetId },
    data: { require2faEnrollment: value },
  })

  // Requiring 2FA is what an admin does on a suspect account: it takes effect
  // on every open session at once (roadmap#280), the next sign-in enrolls.
  const revokedSessions = value && !target.totpEnabled ? await revokeAllSessions(targetId) : 0

  await audit({
    action: value ? "2fa_required_for_user" : "2fa_requirement_cleared",
    category: "auth",
    userId: actor.id,
    userEmail: actor.email ?? undefined,
    resourceType: "user",
    resourceId: targetId,
    resourceName: target.email,
    status: "success",
    details: value ? { revokedSessions } : {},
  })

  return NextResponse.json({ data: { ok: true } })
}
