import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { countRemainingRecoveryCodes } from "@/lib/auth/recovery"

export const runtime = "nodejs"

export async function GET() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { totpEnabled: true, totpEnrolledAt: true, password: true },
  })

  const remaining = u?.totpEnabled ? await countRemainingRecoveryCodes(session.user.id) : 0

  return NextResponse.json({
    data: {
      enabled: !!u?.totpEnabled,
      enrolledAt: u?.totpEnrolledAt?.toISOString() ?? null,
      recoveryCodesRemaining: remaining,
      // Whether the re-authentication dialog asks for a password next to the
      // code (an SSO account has none). Never the hash itself.
      passwordRequired: !!u?.password,
    },
  })
}
