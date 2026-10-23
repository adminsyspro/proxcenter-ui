import { NextResponse } from "next/server"
import QRCode from "qrcode"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { generateTotpSecret, buildOtpauthUrl, encryptTotpSecret } from "@/lib/auth/totp"
import { verifyReauthCredentials } from "@/lib/auth/totp-admin"
import { signEnrollToken } from "@/lib/auth/enroll-token"

export const runtime = "nodejs"

/**
 * The wizard sends no body on a first enrolment; a re-enrolment carries the
 * re-auth credentials. Anything unparseable counts as an empty body so the
 * re-auth check below fails closed rather than throwing a 500.
 */
async function readBody(req: Request): Promise<{ password?: unknown; totpCode?: unknown }> {
  try {
    const parsed = await req.json()
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return {}
  }
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true, totpEnabled: true },
  })
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // Starting a new enrolment while 2FA is on ends with the current secret
  // being replaced (enroll/verify). A stolen session must not be enough for
  // that, so the same re-authentication as disabling 2FA is required first.
  if (user.totpEnabled) {
    const reauthOk = await verifyReauthCredentials(session.user.id, user.password, await readBody(req))
    if (!reauthOk) {
      return NextResponse.json({ error: "Re-authentication failed" }, { status: 401 })
    }
  }

  const secret = generateTotpSecret()
  const otpauthUrl = buildOtpauthUrl(session.user.email, secret)
  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 256 })

  const enrollToken = await signEnrollToken(
    { userId: session.user.id, secretEnc: encryptTotpSecret(secret) },
    process.env.NEXTAUTH_SECRET || "",
  )

  return NextResponse.json(
    { data: { secret, otpauthUrl, qrDataUrl, enrollToken } },
    { headers: { "Cache-Control": "no-store" } },
  )
}
