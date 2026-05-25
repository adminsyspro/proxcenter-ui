import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { verifyPassword } from "@/lib/auth/password"
import { verifyTotp } from "@/lib/auth/totp"
import { isEnrollmentRequiredFor } from "@/lib/auth/enforce-2fa"
import { clearUserTotp } from "@/lib/auth/totp-admin"
import { audit } from "@/lib/audit"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  if (await isEnrollmentRequiredFor(session.user.id)) {
    return NextResponse.json(
      { error: "Cannot disable 2FA: policy requires it on your account.", code: "POLICY_LOCK" },
      { status: 409 },
    )
  }

  const { password, totpCode } = await req.json()

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true, totpEnabled: true },
  })

  if (!user?.totpEnabled) {
    return NextResponse.json({ error: "2FA is not enabled" }, { status: 400 })
  }

  let reauthOk = false

  if (password && user.password) {
    reauthOk = await verifyPassword(password, user.password)
  } else if (totpCode) {
    reauthOk = await verifyTotp(session.user.id, totpCode)
  }

  if (!reauthOk) {
    return NextResponse.json({ error: "Re-authentication failed" }, { status: 401 })
  }

  await prisma.$transaction(async (tx) => {
    await clearUserTotp(tx, session.user.id)
  })

  await audit({
    action: "2fa_disabled",
    category: "auth",
    userId: session.user.id,
    status: "success",
    details: { by: "self" },
  })

  return NextResponse.json({ data: { ok: true } })
}
