// src/lib/auth/totpThrottle.ts
// Always-on floor against second-factor guessing.
//
// The configurable login lockout (loginLockout.ts) defaults to OFF, so on a
// default installation a correct password plus an unlimited stream of TOTP
// guesses was accepted: 12 wrong codes in a row were all answered with a
// retry on the lab bench. A six-digit code with a one-step tolerance gives
// an attacker 3 chances in a million per guess, which an unthrottled loop
// turns into a near certainty within a day.
//
// This floor does not depend on the policy: after TOTP_THROTTLE_MAX_FAILURES
// wrong second factors for one account within TOTP_THROTTLE_WINDOW_MS, every
// further verification for that account is refused for TOTP_THROTTLE_LOCK_MS,
// with the same generic answer the caller already gives for a wrong code.
// The counters share the login_throttles table (kind "totp", key = user id)
// so they survive restarts and are shared by every instance of an HA
// deployment; the only schema change is the kind check constraint admitting
// 'totp' (migration 20261023090000_login_throttles_totp_kind). Both the
// sign-in path and the re-authentication helper (disable 2FA, regenerate
// recovery codes, re-enrol) go through withTotpThrottle, so a stolen session
// cannot be used to guess the second factor either.

import { prisma } from "@/lib/db/prisma"

export const TOTP_THROTTLE_KIND = "totp"
export const TOTP_THROTTLE_MAX_FAILURES = 5
export const TOTP_THROTTLE_WINDOW_MS = 15 * 60_000
export const TOTP_THROTTLE_LOCK_MS = 15 * 60_000

// Counter rows nobody touched for this long (and not locked) are deleted.
const STALE_ROW_MS = 24 * 60 * 60 * 1000

/** Where the second factor was asked: the sign-in form, or a re-auth prompt. */
export type TotpThrottleContext = "login" | "reauth"

export type TotpThrottleOutcome = "ok" | "invalid" | "throttled"

function rowKey(userId: string) {
  return { kind_key: { kind: TOTP_THROTTLE_KIND, key: userId } }
}

/** True while the account's second factor is refused outright. */
export async function isTotpThrottled(userId: string, now = new Date()): Promise<boolean> {
  const row = await prisma.loginThrottle.findUnique({
    where: rowKey(userId),
    select: { lockedUntil: true },
  })
  return row?.lockedUntil !== null && row?.lockedUntil !== undefined && row.lockedUntil > now
}

/**
 * Count one wrong second factor. Returns true when this failure crossed the
 * threshold and the account is now locked (audited as login_locked, so the
 * event is visible in the journal even though the admin lockout list only
 * knows the policy's account and IP kinds).
 */
export async function recordTotpFailure(
  userId: string,
  context: TotpThrottleContext,
  now = new Date(),
): Promise<boolean> {
  const windowStart = new Date(now.getTime() - TOTP_THROTTLE_WINDOW_MS)

  // The increment is atomic, so concurrent failures on two instances both count.
  let row = await prisma.loginThrottle.upsert({
    where: rowKey(userId),
    create: { kind: TOTP_THROTTLE_KIND, key: userId, failedCount: 1, firstFailedAt: now, lastFailedAt: now },
    update: { failedCount: { increment: 1 }, lastFailedAt: now },
  })

  // A failure older than the window, or one after an expired lock, restarts
  // the count: the window is "N failures within 15 minutes", not forever.
  const expiredLock = row.lockedUntil !== null && row.lockedUntil <= now
  if (row.failedCount > 1 && (row.firstFailedAt < windowStart || expiredLock)) {
    row = await prisma.loginThrottle.update({
      where: rowKey(userId),
      data: { failedCount: 1, firstFailedAt: now, lockedUntil: null },
    })
  }

  const alreadyLocked = row.lockedUntil !== null && row.lockedUntil > now
  if (alreadyLocked || row.failedCount < TOTP_THROTTLE_MAX_FAILURES) return false

  const lockedUntil = new Date(now.getTime() + TOTP_THROTTLE_LOCK_MS)
  await prisma.loginThrottle.update({ where: rowKey(userId), data: { lockedUntil } })

  // Rows of this kind are only swept here: the policy's own sweep runs on its
  // failures, which never happen while the policy is off.
  await prisma.loginThrottle.deleteMany({
    where: {
      kind: TOTP_THROTTLE_KIND,
      lastFailedAt: { lt: new Date(now.getTime() - STALE_ROW_MS) },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
  })

  // The journal shows the account by email; the counter is keyed by id so the
  // re-auth helper, which only knows the id, shares it with the sign-in path.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } })
  const { audit } = await import("@/lib/audit")
  await audit({
    action: "login_locked",
    category: "auth",
    userId,
    userEmail: user?.email ?? undefined,
    resourceType: "login_totp",
    resourceId: userId,
    resourceName: user?.email ?? userId,
    status: "warning",
    details: {
      kind: TOTP_THROTTLE_KIND,
      key: userId,
      context,
      failedAttempts: row.failedCount,
      lockedUntil: lockedUntil.toISOString(),
    },
  })
  return true
}

/** A correct second factor clears the counter. */
export async function clearTotpFailures(userId: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { kind: TOTP_THROTTLE_KIND, key: userId } })
}

/**
 * Run a second-factor check under the floor. While the account is throttled
 * `verify` is never called (the answer must not depend on the code, so a
 * throttled attacker learns nothing) and the refusal is audited; otherwise a
 * wrong code is counted and a right one clears the counter. Callers map the
 * outcome onto the generic answer they already give for a wrong code.
 */
export async function withTotpThrottle(
  userId: string,
  context: TotpThrottleContext,
  verify: () => Promise<boolean>,
  now = new Date(),
): Promise<TotpThrottleOutcome> {
  if (await isTotpThrottled(userId, now)) {
    const { audit } = await import("@/lib/audit")
    await audit({
      action: "2fa_login_failed",
      category: "auth",
      userId,
      status: "failure",
      details: { reason: "throttled", context },
    })
    return "throttled"
  }

  const ok = await verify()
  if (!ok) {
    await recordTotpFailure(userId, context, now)
    return "invalid"
  }

  await clearTotpFailures(userId)
  return "ok"
}
