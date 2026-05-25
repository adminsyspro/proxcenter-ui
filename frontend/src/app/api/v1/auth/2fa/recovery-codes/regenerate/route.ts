import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { generateRecoveryCodes } from "@/lib/auth/recovery"
import { replaceRecoveryCodes, verifyReauthCredentials } from "@/lib/auth/totp-admin"
import { audit } from "@/lib/audit"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true, totpEnabled: true },
  })

  if (!user?.totpEnabled) {
    return NextResponse.json({ error: "2FA is not enabled" }, { status: 400 })
  }

  const reauthOk = await verifyReauthCredentials(session.user.id, user.password, body)
  if (!reauthOk) {
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
