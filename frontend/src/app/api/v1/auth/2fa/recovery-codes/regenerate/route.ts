import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { verifyPassword } from "@/lib/auth/password"
import { verifyTotp } from "@/lib/auth/totp"
import { generateRecoveryCodes } from "@/lib/auth/recovery"
import { replaceRecoveryCodes } from "@/lib/auth/totp-admin"
import { audit } from "@/lib/audit"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { password, totpCode } = await req.json()

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true, totpEnabled: true },
  })

  if (!user?.totpEnabled) {
    return NextResponse.json({ error: "2FA is not enabled" }, { status: 400 })
  }

  // See disable/route.ts for the rationale: run both verifiers
  // unconditionally so no user-input value gates a security check.
  const passwordInput = typeof password === "string" ? password : ""
  const totpInput = typeof totpCode === "string" ? totpCode : ""
  const passwordOk = user.password
    ? await verifyPassword(passwordInput, user.password)
    : false
  const totpOk = await verifyTotp(session.user.id, totpInput)

  if (!passwordOk && !totpOk) {
    return NextResponse.json({ error: "Re-authentication failed" }, { status: 401 })
  }

  const plain = generateRecoveryCodes()

  await prisma.$transaction(async (tx) => {
    await replaceRecoveryCodes(tx, session.user.id, plain)
  })

  await audit({
    action: "2fa_recovery_regenerated",
    category: "auth",
    userId: session.user.id,
    status: "success",
  })

  return NextResponse.json({ data: { recoveryCodes: plain } })
}
