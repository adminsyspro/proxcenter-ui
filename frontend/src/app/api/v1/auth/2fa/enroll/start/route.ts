import { NextResponse } from "next/server"
import QRCode from "qrcode"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { generateTotpSecret, buildOtpauthUrl, encryptTotpSecret } from "@/lib/auth/totp"
import { signEnrollToken } from "@/lib/auth/enroll-token"

export const runtime = "nodejs"

export async function POST() {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
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
