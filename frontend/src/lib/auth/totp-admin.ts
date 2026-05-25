import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { Prisma } from "@prisma/client"
import { nanoid } from "nanoid"
import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { hashRecoveryCode } from "./recovery"

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
