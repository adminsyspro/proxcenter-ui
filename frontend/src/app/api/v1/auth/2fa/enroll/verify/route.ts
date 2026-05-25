import { NextResponse } from "next/server"
import { getToken, encode } from "next-auth/jwt"
import { getServerSession } from "next-auth"
import { authenticator } from "otplib"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { verifyEnrollToken } from "@/lib/auth/enroll-token"
import { generateRecoveryCodes } from "@/lib/auth/recovery"
import { replaceRecoveryCodes } from "@/lib/auth/totp-admin"
import { audit } from "@/lib/audit"

export const runtime = "nodejs"

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { enrollToken, code } = await req.json()

  let payload
  try {
    payload = await verifyEnrollToken(enrollToken, process.env.NEXTAUTH_SECRET || "")
  } catch {
    return NextResponse.json({ error: "enroll_token_expired" }, { status: 400 })
  }

  if (payload.userId !== session.user.id) {
    return NextResponse.json({ error: "user_mismatch" }, { status: 400 })
  }

  const secret = decryptSecret(payload.secretEnc)

  if (!authenticator.check(code, secret)) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 })
  }

  const plainCodes = generateRecoveryCodes()
  const now = new Date()
  const userId = session.user.id

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: userId },
      data: {
        totpSecretEnc: payload.secretEnc,
        totpEnabled: true,
        totpEnrolledAt: now,
        totpLastUsedStep: null,
      },
    })
    await replaceRecoveryCodes(tx, userId, plainCodes, now)
  })

  await audit({
    action: "2fa_enrolled",
    category: "auth",
    userId,
    status: "success",
  })

  const token = await getToken({
    req: req as any,
    secret: process.env.NEXTAUTH_SECRET || "",
    raw: false,
  })

  const res = NextResponse.json({ data: { recoveryCodes: plainCodes } })

  if (token) {
    const refreshed: any = { ...token, mustEnroll2fa: false }
    delete refreshed.iat
    delete refreshed.exp
    delete refreshed.jti

    const newJwt = await encode({
      token: refreshed,
      secret: process.env.NEXTAUTH_SECRET || "",
    })

    const cookieName = (process.env.NEXTAUTH_URL || "").startsWith("https://")
      ? "__Secure-next-auth.session-token"
      : "next-auth.session-token"

    res.cookies.set(cookieName, newJwt, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: cookieName.startsWith("__Secure"),
    })
  }

  return res
}
