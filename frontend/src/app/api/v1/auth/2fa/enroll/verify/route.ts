import { NextResponse } from "next/server"
import { getToken, encode } from "next-auth/jwt"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { sessionCookieName, resolveCookieSecure } from "@/lib/auth/cookies"
import { sessionDurations } from "@/lib/auth/durations"
import { prisma } from "@/lib/db/prisma"
import { decryptSecret } from "@/lib/crypto/secret"
import { verifyEnrollToken } from "@/lib/auth/enroll-token"
import { generateRecoveryCodes } from "@/lib/auth/recovery"
import { checkTotpCode } from "@/lib/auth/totp"
import { replaceRecoveryCodes, verifyReauthCredentials } from "@/lib/auth/totp-admin"
import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

async function handlePost(req: Request) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const body = await req.json()
  const { enrollToken, code } = body

  let payload
  try {
    payload = await verifyEnrollToken(enrollToken, process.env.NEXTAUTH_SECRET || "")
  } catch {
    return NextResponse.json({ error: "enroll_token_expired" }, { status: 400 })
  }

  if (payload.userId !== session.user.id) {
    return NextResponse.json({ error: "user_mismatch" }, { status: 400 })
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { password: true, totpEnabled: true },
  })
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  // This is the step that overwrites the secret. When 2FA is already on, the
  // caller re-authenticates here as well (password, or a code from the
  // CURRENT authenticator in `totpCode`; `code` is for the new one): the
  // enrol token only proves enroll/start was called, and nothing in it says
  // that call re-authenticated.
  if (user.totpEnabled) {
    const reauthOk = await verifyReauthCredentials(session.user.id, user.password, body)
    if (!reauthOk) {
      return NextResponse.json({ error: "Re-authentication failed" }, { status: 401 })
    }
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
      // Without this, next-auth's encode() defaults maxAge to 30 days, so
      // this re-issued cookie would outlive the absolute cap that every
      // other session cookie is now held to.
      maxAge: Math.ceil(sessionDurations().absoluteMs / 1000),
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

export const POST = withAudit({ category: "auth", resourceType: "verify" }, handlePost)
