import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { Prisma } from "@prisma/client"
import { nanoid } from "nanoid"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { hashRecoveryCode } from "./recovery"
import { verifyPassword } from "./password"
import { verifyTotp } from "./totp"

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
 * Re-auth helper used by self-disable and regenerate-recovery routes.
 * Always invokes both verifiers regardless of the request payload shape
 * (verifyPassword on empty input + null hash falls through to false;
 * verifyTotp on empty input returns false via otplib). The only
 * conditional uses server-loaded state (user.password). No user-input
 * value gates a security check.
 */
export async function verifyReauthCredentials(
  userId: string,
  passwordHash: string | null,
  body: { password?: unknown; totpCode?: unknown },
): Promise<boolean> {
  const passwordInput = typeof body.password === "string" ? body.password : ""
  const totpInput = typeof body.totpCode === "string" ? body.totpCode : ""
  const passwordOk = passwordHash
    ? await verifyPassword(passwordInput, passwordHash)
    : false
  const totpOk = await verifyTotp(userId, totpInput)
  return passwordOk || totpOk
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
    select: { email: true },
  })

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  await prisma.user.update({
    where: { id: targetId },
    data: { require2faEnrollment: value },
  })

  await audit({
    action: value ? "2fa_required_for_user" : "2fa_requirement_cleared",
    category: "auth",
    userId: actor.id,
    userEmail: actor.email ?? undefined,
    resourceType: "user",
    resourceId: targetId,
    resourceName: target.email,
    status: "success",
    details: {},
  })

  return NextResponse.json({ data: { ok: true } })
}
