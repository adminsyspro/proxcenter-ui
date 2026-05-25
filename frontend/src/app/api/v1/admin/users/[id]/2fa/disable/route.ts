import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { isEnrollmentRequiredFor } from "@/lib/auth/enforce-2fa"
import { clearUserTotp, requireSuperAdminCaller } from "@/lib/auth/totp-admin"

export const runtime = "nodejs"

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireSuperAdminCaller()
  if (denied) return denied

  const session = await getServerSession(authOptions)
  const { id: targetId } = await ctx.params

  if (targetId === session.user.id && (await isEnrollmentRequiredFor(session.user.id))) {
    return NextResponse.json({ error: "POLICY_LOCK" }, { status: 409 })
  }

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { email: true, totpEnabled: true },
  })

  if (!target?.totpEnabled) {
    return NextResponse.json({ error: "2FA is not enabled on this user" }, { status: 400 })
  }

  await prisma.$transaction(async (tx) => {
    await clearUserTotp(tx, targetId)
  })

  await audit({
    action: "2fa_disabled",
    category: "auth",
    userId: session.user.id,
    userEmail: session.user.email ?? undefined,
    resourceType: "user",
    resourceId: targetId,
    resourceName: target.email,
    status: "success",
    details: { by: "admin" },
  })

  return NextResponse.json({ data: { ok: true } })
}
