import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { requireSuperAdminCaller } from "@/lib/auth/totp-admin"

export const runtime = "nodejs"

export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await requireSuperAdminCaller()
  if (denied) return denied

  const session = await getServerSession(authOptions)
  const { id: targetId } = await ctx.params

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { email: true },
  })

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }

  await prisma.user.update({
    where: { id: targetId },
    data: { require2faEnrollment: true },
  })

  await audit({
    action: "2fa_required_for_user",
    category: "auth",
    userId: session!.user.id,
    userEmail: session!.user.email ?? undefined,
    resourceType: "user",
    resourceId: targetId,
    resourceName: target.email,
    status: "success",
    details: {},
  })

  return NextResponse.json({ data: { ok: true } })
}
