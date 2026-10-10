// src/lib/auth/loginLockout.ts
// Enforcement of the login lockout policy (login_max_failed_attempts,
// login_lockout_duration_minutes) for the credentials and LDAP providers.
// OIDC is out of scope: the IdP owns password guessing there.
//
// Failures are counted per account (the identifier typed on the sign-in form)
// and, when login_ip_max_failed_attempts is set, per client IP, in the
// login_throttles table so every instance of an HA deployment shares the
// counters. A failure older than the lockout duration no longer counts: the
// window restarts at the next failure.

import { isIPv4, isIPv6 } from "node:net"

import { prisma } from "@/lib/db/prisma"
import { forwardedForOf, resolveClientIp } from "@/lib/net/clientIp"

export type LockoutKind = "account" | "ip"
export type LockoutProvider = "credentials" | "ldap"

export interface LockoutPolicy {
  /** Per account threshold, 0 = no account lockout. */
  maxAttempts: number
  /** Per source IP threshold, 0 = no IP lockout (users behind one NAT share an IP). */
  ipMaxAttempts: number
  /** Reverse proxies in front of ProxCenter whose X-Forwarded-For hops are trusted. */
  trustedProxies: number
  durationMs: number
}

// Counter rows nobody touched for this long (and not locked) are deleted.
const STALE_ROW_MS = 24 * 60 * 60 * 1000

/**
 * Hard bound on the table. Past it, the oldest rows that are not locked are
 * evicted. Locked rows stay: they are bounded by real accounts, plus source
 * IPs when IP lockout is on.
 */
export const MAX_THROTTLE_ROWS = 10_000

/**
 * null when the policy is off (both thresholds at 0, or 0 minutes), which is
 * the pre-lockout behavior.
 */
export async function getLockoutPolicy(): Promise<LockoutPolicy | null> {
  try {
    const row = await prisma.securityPolicy.findFirst({
      where: { id: "default", tenantId: "default" },
      select: {
        loginMaxFailedAttempts: true,
        loginIpMaxFailedAttempts: true,
        loginTrustedProxies: true,
        loginLockoutDurationMinutes: true,
      },
    })
    const maxAttempts = Number(row?.loginMaxFailedAttempts) > 0 ? Number(row?.loginMaxFailedAttempts) : 0
    const ipMaxAttempts = Number(row?.loginIpMaxFailedAttempts) > 0 ? Number(row?.loginIpMaxFailedAttempts) : 0
    const trustedProxies = Number(row?.loginTrustedProxies) >= 0 ? Number(row?.loginTrustedProxies) : 1
    const minutes = Number(row?.loginLockoutDurationMinutes)
    if ((maxAttempts === 0 && ipMaxAttempts === 0) || !(minutes > 0)) return null
    return { maxAttempts, ipMaxAttempts, trustedProxies, durationMs: minutes * 60_000 }
  } catch (e) {
    // An unreadable policy must not take sign-in down with it.
    console.error("[loginLockout] cannot read the login policy:", e)
    return null
  }
}

/**
 * Client address from the headers NextAuth hands to `authorize`, see
 * lib/net/clientIp. null (no IP counting) when it cannot be trusted. The
 * policy row was just read, so its trusted proxies value is used as is.
 */
export function clientIpFromRequest(req: unknown, trustedProxies: number): string | null {
  const headers = (req as { headers?: Record<string, unknown> } | undefined)?.headers
  return resolveClientIp(forwardedForOf(headers), trustedProxies)
}

export function accountKey(identifier: string): string {
  return identifier.toLowerCase().trim()
}

/**
 * Key of an IP counter. An IPv6 client usually holds a whole /64 and can
 * rotate inside it at will, so IPv6 is keyed by its /64 prefix
 * ("2001:db8:1:2::/64"); IPv4, and IPv4-mapped IPv6, by the address.
 */
export function ipThrottleKey(ip: string): string {
  const addr = ip.trim().replace(/^\[|\]$/g, "").split("%")[0]
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr)
  if (mapped && isIPv4(mapped[1])) return mapped[1]
  if (!isIPv6(addr)) return addr

  // Rewrite an embedded IPv4 tail as two hex groups, expand "::" to eight
  // groups, keep the first four.
  const full = addr.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_m, a, b, c, d) =>
    `${((+a << 8) | +b).toString(16)}:${((+c << 8) | +d).toString(16)}`)
  const [head, rest] = full.includes("::") ? full.split("::") : [full, null]
  const left = head ? head.split(":") : []
  const right = rest ? rest.split(":") : []
  const fill = rest === null ? [] : Array(8 - left.length - right.length).fill("0")
  const groups = [...left, ...fill, ...right].map((g) => parseInt(g || "0", 16).toString(16))
  return `${groups.slice(0, 4).join(":")}::/64`
}

function thresholdFor(kind: LockoutKind, policy: LockoutPolicy): number {
  return kind === "ip" ? policy.ipMaxAttempts : policy.maxAttempts
}

// The subjects the policy counts: each kind only when its threshold is set.
// `account` null = not counted (unknown account, see LoginAttempt.fail).
function subjects(account: string | null, ip: string | null, policy: LockoutPolicy): { kind: LockoutKind; key: string }[] {
  const list: { kind: LockoutKind; key: string }[] = []
  if (account && policy.maxAttempts > 0) list.push({ kind: "account", key: account })
  if (ip && policy.ipMaxAttempts > 0) list.push({ kind: "ip", key: ipThrottleKey(ip) })
  return list
}

/** The kind of the first active lock among the account and the IP, or null. */
export async function findActiveLock(
  account: string | null,
  ip: string | null,
  policy: LockoutPolicy,
  now = new Date(),
): Promise<LockoutKind | null> {
  const list = subjects(account, ip, policy)
  if (list.length === 0) return null
  const rows = await prisma.loginThrottle.findMany({
    where: {
      OR: list,
      lockedUntil: { gt: now },
    },
    select: { kind: true },
  })
  if (rows.some((r) => r.kind === "account")) return "account"
  return rows.length > 0 ? "ip" : null
}

/**
 * Count one failure against the account (null = do not count it) and the IP.
 * Returns the subjects that just crossed the threshold (and are now locked),
 * already audited.
 */
export async function recordLoginFailure(
  account: string | null,
  ip: string | null,
  policy: LockoutPolicy,
  provider: LockoutProvider,
  now = new Date(),
): Promise<LockoutKind[]> {
  const windowStart = new Date(now.getTime() - policy.durationMs)
  const locked: LockoutKind[] = []

  for (const { kind, key } of subjects(account, ip, policy)) {
    // The increment is atomic, so concurrent failures on two instances both count.
    let row = await prisma.loginThrottle.upsert({
      where: { kind_key: { kind, key } },
      create: { kind, key, failedCount: 1, firstFailedAt: now, lastFailedAt: now },
      update: { failedCount: { increment: 1 }, lastFailedAt: now },
    })

    const expiredLock = row.lockedUntil !== null && row.lockedUntil <= now
    if (row.failedCount > 1 && (row.firstFailedAt < windowStart || expiredLock)) {
      row = await prisma.loginThrottle.update({
        where: { kind_key: { kind, key } },
        data: { failedCount: 1, firstFailedAt: now, lockedUntil: null },
      })
    }

    const alreadyLocked = row.lockedUntil !== null && row.lockedUntil > now
    if (!alreadyLocked && row.failedCount >= thresholdFor(kind, policy)) {
      const lockedUntil = new Date(now.getTime() + policy.durationMs)
      await prisma.loginThrottle.update({
        where: { kind_key: { kind, key } },
        data: { lockedUntil },
      })
      locked.push(kind)

      const { audit } = await import("@/lib/audit")
      await audit({
        action: "login_locked",
        category: "auth",
        userEmail: kind === "account" ? key : undefined,
        ipAddress: ip ?? undefined,
        resourceType: kind === "account" ? "login_account" : "login_ip",
        resourceId: key,
        resourceName: key,
        status: "warning",
        details: {
          kind,
          key,
          provider,
          failedAttempts: row.failedCount,
          lockedUntil: lockedUntil.toISOString(),
        },
      })
    }
  }

  await prisma.loginThrottle.deleteMany({
    where: {
      lastFailedAt: { lt: new Date(now.getTime() - Math.max(STALE_ROW_MS, policy.durationMs)) },
      OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }],
    },
  })
  await enforceRowCap(MAX_THROTTLE_ROWS, now)

  return locked
}

/** Evict the oldest rows that are not locked until the table holds at most `cap` rows. */
export async function enforceRowCap(cap: number, now = new Date()): Promise<void> {
  const excess = (await prisma.loginThrottle.count()) - cap
  if (excess <= 0) return
  const victims = await prisma.loginThrottle.findMany({
    where: { OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] },
    orderBy: { lastFailedAt: "asc" },
    take: excess,
    select: { kind: true, key: true },
  })
  if (victims.length === 0) return
  await prisma.loginThrottle.deleteMany({ where: { OR: victims } })
}

/** A successful sign-in clears the account counter. The IP counter only decays. */
export async function clearAccountFailures(account: string): Promise<void> {
  await prisma.loginThrottle.deleteMany({ where: { kind: "account", key: account } })
}

export interface LoginAttempt {
  /** Locked out: the caller must refuse with its usual invalid-credentials message. */
  locked: boolean
  /**
   * Count a failure. `accountExists` false (no such local account, or LDAP
   * user not found in the directory) counts the IP only: a lock answers with
   * the same message as a wrong password, so locking unknown names gave no
   * enumeration protection, only one row per invented name.
   */
  fail(accountExists: boolean): Promise<void>
  succeed(): Promise<void>
}

const NOOP_ATTEMPT: LoginAttempt = { locked: false, fail: async () => {}, succeed: async () => {} }

/**
 * Entry point for an `authorize` callback. Reads the policy once, checks the
 * account and IP locks (auditing a refused attempt), and hands back the
 * hooks to call on failure and on success. Policy off = every hook is a no-op.
 */
export async function beginLoginAttempt(
  identifier: string,
  req: unknown,
  provider: LockoutProvider,
): Promise<LoginAttempt> {
  const policy = await getLockoutPolicy()
  if (!policy) return NOOP_ATTEMPT

  const account = accountKey(identifier)
  const ip = clientIpFromRequest(req, policy.trustedProxies)

  const lockedBy = await findActiveLock(account, ip, policy)
  if (lockedBy) {
    const { audit } = await import("@/lib/audit")
    await audit({
      action: "login_failed",
      category: "auth",
      userEmail: account,
      ipAddress: ip ?? undefined,
      details: { reason: "Locked out", lockedBy, provider },
      status: "failure",
      errorMessage: "Locked out",
    })
    return { ...NOOP_ATTEMPT, locked: true }
  }

  return {
    locked: false,
    fail: async (accountExists: boolean) => {
      await recordLoginFailure(accountExists ? account : null, ip, policy, provider)
    },
    succeed: async () => {
      await clearAccountFailures(account)
    },
  }
}

export interface ActiveLock {
  kind: LockoutKind
  key: string
  failedCount: number
  lastFailedAt: string
  lockedUntil: string
}

export async function listActiveLocks(now = new Date()): Promise<ActiveLock[]> {
  const rows = await prisma.loginThrottle.findMany({
    where: { lockedUntil: { gt: now } },
    orderBy: { lockedUntil: "desc" },
  })
  return rows.map((r) => ({
    kind: r.kind as LockoutKind,
    key: r.key,
    failedCount: r.failedCount,
    lastFailedAt: r.lastFailedAt.toISOString(),
    lockedUntil: (r.lockedUntil as Date).toISOString(),
  }))
}

/** Lift a lock and reset its counter. Returns false when there was nothing to unlock. */
export async function unlockLogin(kind: LockoutKind, key: string): Promise<boolean> {
  const { count } = await prisma.loginThrottle.deleteMany({ where: { kind, key } })
  return count > 0
}
