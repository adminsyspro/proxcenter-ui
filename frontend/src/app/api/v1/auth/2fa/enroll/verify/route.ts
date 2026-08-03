import { NextResponse } from "next/server"
import { getToken, encode } from "next-auth/jwt"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { sessionCookieName, resolveCookieSecure } from "@/lib/auth/cookies"
import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { verifyEnrollToken } from "@/lib/auth/enroll-token"
import { generateRecoveryCodes } from "@/lib/auth/recovery"
import { checkTotpCode } from "@/lib/auth/totp"
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

  if (!checkTotpCode(code, secret)) {
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
    cookieName: sessionCookieName(),
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

    // Name and flag both come from the shared module. Deriving `secure` from
    // the cookie NAME (the previous behaviour) would write a non-Secure cookie
    // on an https request whenever the name is unprefixed, silently undoing
    // the fix on this path.
    res.cookies.set(sessionCookieName(), newJwt, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: resolveCookieSecure(req.headers),
    })
  }

  return res
}
