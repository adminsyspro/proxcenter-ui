/**
 * Login lockout policy against a real Postgres schema (roadmap #46).
 *
 * The counters live in login_throttles so every instance of an HA deployment
 * shares them; this suite proves the rows behave: threshold, window, expiry,
 * reset on success, admin unlock, and policy 0 leaving sign-in untouched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { prismaTest, truncate } from "../../__tests__/setup/prisma-test"

const auditMock = vi.fn(async (_entry: Record<string, unknown>) => "id")

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaTest }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))

const {
  beginLoginAttempt,
  clientIpFromRequest,
  findActiveLock,
  enforceRowCap,
  getLockoutPolicy,
  ipThrottleKey,
  listActiveLocks,
  recordLoginFailure,
  unlockLogin,
} = await import("./loginLockout")

// Account lockout only, the IP side off: the shape of the column defaults.
const POLICY = { maxAttempts: 3, ipMaxAttempts: 0, trustedProxies: 1, durationMs: 15 * 60_000 }

async function seedPolicy(maxAttempts: number, minutes = 15, extra: Record<string, number> = {}) {
  await prismaTest.securityPolicy.create({
    data: {
      id: "default",
      tenantId: "default",
      loginMaxFailedAttempts: maxAttempts,
      loginLockoutDurationMinutes: minutes,
      updatedAt: new Date(),
      ...extra,
    },
  })
}

// What the shipped nginx forwards: whatever the client sent, then $remote_addr.
function reqFrom(ip: string, spoofed = "6.6.6.6") {
  return { headers: { "x-forwarded-for": `${spoofed}, ${ip}` } }
}

function at(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000)
}

beforeEach(async () => {
  vi.clearAllMocks()
  await truncate(["login_throttles", "security_policies"])
})

describe("getLockoutPolicy", () => {
  it("is off when max attempts is 0", async () => {
    await seedPolicy(0)
    expect(await getLockoutPolicy()).toBeNull()
  })

  it("is off when the duration is 0", async () => {
    await seedPolicy(5, 0)
    expect(await getLockoutPolicy()).toBeNull()
  })

  it("is off when no policy row exists", async () => {
    expect(await getLockoutPolicy()).toBeNull()
  })

  it("reads the configured values, IP lockout off and one trusted proxy by default", async () => {
    await seedPolicy(5, 10)
    expect(await getLockoutPolicy()).toEqual({ maxAttempts: 5, ipMaxAttempts: 0, trustedProxies: 1, durationMs: 600_000 })
  })

  it("is on with only the IP threshold set", async () => {
    await seedPolicy(0, 10, { loginIpMaxFailedAttempts: 20, loginTrustedProxies: 2 })
    expect(await getLockoutPolicy()).toEqual({ maxAttempts: 0, ipMaxAttempts: 20, trustedProxies: 2, durationMs: 600_000 })
  })
})

describe("clientIpFromRequest", () => {
  // The resolution itself is covered in lib/net/clientIp.test.ts.
  it("reads the trusted hop from the headers NextAuth hands to authorize", () => {
    expect(clientIpFromRequest(reqFrom("203.0.113.7"), 1)).toBe("203.0.113.7")
    expect(clientIpFromRequest(reqFrom("203.0.113.7"), 0)).toBeNull()
    expect(clientIpFromRequest(undefined, 1)).toBeNull()
  })
})

describe("recordLoginFailure", () => {
  it("locks the account at the threshold, not before, and audits login_locked once", async () => {
    const t0 = new Date()

    expect(await recordLoginFailure("alice@x.io", null, POLICY, "credentials", t0)).toEqual([])
    expect(await recordLoginFailure("alice@x.io", null, POLICY, "credentials", at(t0, 1))).toEqual([])
    expect(await findActiveLock("alice@x.io", null, POLICY, at(t0, 1))).toBeNull()

    expect(await recordLoginFailure("alice@x.io", null, POLICY, "credentials", at(t0, 2))).toEqual(["account"])
    expect(await findActiveLock("alice@x.io", null, POLICY, at(t0, 3))).toBe("account")

    const locked = auditMock.mock.calls.filter(([e]) => e.action === "login_locked")
    expect(locked).toHaveLength(1)
    expect(locked[0][0]).toMatchObject({ userEmail: "alice@x.io", details: { kind: "account", provider: "credentials" } })
  })

  it("lifts the lock once the duration has passed, and the next failure restarts the count", async () => {
    const t0 = new Date()
    for (let i = 0; i < 3; i++) await recordLoginFailure("bob", null, POLICY, "ldap", at(t0, i))

    // Locked at t0+2 for 15 minutes.
    expect(await findActiveLock("bob", null, POLICY, at(t0, 16))).toBe("account")
    expect(await findActiveLock("bob", null, POLICY, at(t0, 18))).toBeNull()

    expect(await recordLoginFailure("bob", null, POLICY, "ldap", at(t0, 18))).toEqual([])
    const row = await prismaTest.loginThrottle.findUnique({ where: { kind_key: { kind: "account", key: "bob" } } })
    expect(row).toMatchObject({ failedCount: 1, lockedUntil: null })
  })

  it("forgets failures older than the lockout window", async () => {
    const t0 = new Date()
    await recordLoginFailure("carol", null, POLICY, "credentials", t0)
    await recordLoginFailure("carol", null, POLICY, "credentials", at(t0, 1))
    // Third failure 20 minutes after the first: the window restarted.
    expect(await recordLoginFailure("carol", null, POLICY, "credentials", at(t0, 20))).toEqual([])
    expect(await findActiveLock("carol", null, POLICY, at(t0, 20))).toBeNull()
  })

  it("never counts by IP while the IP threshold is 0 (the default)", async () => {
    const t0 = new Date()
    for (let i = 0; i < 50; i++) {
      await recordLoginFailure(`user${i}@x.io`, "203.0.113.9", POLICY, "credentials", t0)
    }
    expect(await prismaTest.loginThrottle.count({ where: { kind: "ip" } })).toBe(0)
    expect(await findActiveLock("someone-else", "203.0.113.9", POLICY, t0)).toBeNull()
  })

  it("locks an IP at its own threshold, across different accounts", async () => {
    const t0 = new Date()
    const policy = { ...POLICY, ipMaxAttempts: 10 }

    for (let i = 0; i < 9; i++) {
      await recordLoginFailure(`user${i}@x.io`, "203.0.113.9", policy, "credentials", t0)
    }
    expect(await findActiveLock("someone-else", "203.0.113.9", policy, t0)).toBeNull()

    expect(await recordLoginFailure("last@x.io", "203.0.113.9", policy, "credentials", t0)).toEqual(["ip"])
    // Any account behind that IP is refused, another IP is not.
    expect(await findActiveLock("someone-else", "203.0.113.9", policy, t0)).toBe("ip")
    expect(await findActiveLock("someone-else", "203.0.113.10", policy, t0)).toBeNull()
  })

  it("with only the IP threshold set, never locks an account", async () => {
    const t0 = new Date()
    const policy = { ...POLICY, maxAttempts: 0, ipMaxAttempts: 100 }
    for (let i = 0; i < 10; i++) await recordLoginFailure("ivy@x.io", "203.0.113.4", policy, "credentials", t0)
    expect(await prismaTest.loginThrottle.count({ where: { kind: "account" } })).toBe(0)
    expect(await findActiveLock("ivy@x.io", "203.0.113.4", policy, t0)).toBeNull()
  })
})

describe("beginLoginAttempt", () => {
  it("policy 0: never locked, never writes a row", async () => {
    await seedPolicy(0)
    for (let i = 0; i < 10; i++) {
      const attempt = await beginLoginAttempt("dave@x.io", reqFrom("203.0.113.1"), "credentials")
      expect(attempt.locked).toBe(false)
      await attempt.fail(true)
    }
    expect(await prismaTest.loginThrottle.count()).toBe(0)
  })

  it("refuses a locked account even before the password is looked at, and audits the refusal", async () => {
    await seedPolicy(2)
    for (let i = 0; i < 2; i++) {
      const attempt = await beginLoginAttempt("Eve@X.io ", reqFrom("203.0.113.2"), "credentials")
      await attempt.fail(true)
    }

    const attempt = await beginLoginAttempt("eve@x.io", reqFrom("198.51.100.50"), "credentials")
    expect(attempt.locked).toBe(true)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "login_failed", details: expect.objectContaining({ lockedBy: "account" }) }),
    )
  })

  it("locks the client IP from the trusted hop, whatever the spoofed first hop says", async () => {
    await seedPolicy(0, 15, { loginIpMaxFailedAttempts: 2 })
    // Unknown accounts: the IP still counts.
    await (await beginLoginAttempt("a@x.io", reqFrom("203.0.113.8", "1.1.1.1"), "credentials")).fail(false)
    await (await beginLoginAttempt("b@x.io", reqFrom("203.0.113.8", "2.2.2.2"), "credentials")).fail(false)

    // Rotating the spoofed hop does not escape the lock.
    expect((await beginLoginAttempt("c@x.io", reqFrom("203.0.113.8", "3.3.3.3"), "credentials")).locked).toBe(true)
    expect(await prismaTest.loginThrottle.findMany({ where: { kind: "ip" }, select: { key: true } })).toEqual([
      { key: "203.0.113.8" },
    ])
  })

  it("a successful sign-in resets the account counter but not the IP one", async () => {
    await seedPolicy(3, 15, { loginIpMaxFailedAttempts: 50 })
    for (let i = 0; i < 2; i++) {
      await (await beginLoginAttempt("frank@x.io", reqFrom("203.0.113.3"), "credentials")).fail(true)
    }
    await (await beginLoginAttempt("frank@x.io", reqFrom("203.0.113.3"), "credentials")).succeed()

    expect(await prismaTest.loginThrottle.findUnique({ where: { kind_key: { kind: "account", key: "frank@x.io" } } })).toBeNull()
    const ipRow = await prismaTest.loginThrottle.findUnique({ where: { kind_key: { kind: "ip", key: "203.0.113.3" } } })
    expect(ipRow?.failedCount).toBe(2)

    // Two more failures do not lock: the count restarted at zero.
    for (let i = 0; i < 2; i++) {
      await (await beginLoginAttempt("frank@x.io", reqFrom("203.0.113.3"), "credentials")).fail(true)
    }
    expect((await beginLoginAttempt("frank@x.io", reqFrom("203.0.113.3"), "credentials")).locked).toBe(false)
  })
})

describe("unknown accounts", () => {
  it("fail(false) writes no account row, however many attempts", async () => {
    await seedPolicy(2)
    for (let i = 0; i < 5; i++) {
      const attempt = await beginLoginAttempt(`ghost${i}@x.io`, reqFrom("203.0.113.20"), "credentials")
      expect(attempt.locked).toBe(false)
      await attempt.fail(false)
    }
    expect(await prismaTest.loginThrottle.count()).toBe(0)
  })
})

describe("IPv6 keying", () => {
  it("keys IPv6 by its /64 prefix and leaves IPv4 alone", () => {
    expect(ipThrottleKey("2001:db8:1:2::1")).toBe("2001:db8:1:2::/64")
    expect(ipThrottleKey("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64")
    expect(ipThrottleKey("2001:db8::1")).toBe("2001:db8:0:0::/64")
    expect(ipThrottleKey("2001:db8:1:2:3:4:192.0.2.1")).toBe("2001:db8:1:2::/64")
    expect(ipThrottleKey("::ffff:192.0.2.1")).toBe("192.0.2.1")
    expect(ipThrottleKey("203.0.113.5")).toBe("203.0.113.5")
  })

  it("two addresses in one /64 share a counter, another /64 does not", async () => {
    const t0 = new Date()
    const policy = { ...POLICY, maxAttempts: 0, ipMaxAttempts: 2 }
    await recordLoginFailure(null, "2001:db8:1:2::a", policy, "credentials", t0)
    expect(await recordLoginFailure(null, "2001:db8:1:2:ffff::b", policy, "credentials", t0)).toEqual(["ip"])
    expect(await findActiveLock(null, "2001:db8:1:2::c", policy, t0)).toBe("ip")
    expect(await findActiveLock(null, "2001:db8:1:3::a", policy, t0)).toBeNull()

    await recordLoginFailure(null, "2001:db8:1:3::a", policy, "credentials", t0)
    const keys = (await prismaTest.loginThrottle.findMany({ select: { key: true }, orderBy: { key: "asc" } })).map((r) => r.key)
    expect(keys).toEqual(["2001:db8:1:2::/64", "2001:db8:1:3::/64"])
  })
})

describe("row cap", () => {
  it("evicts the oldest unlocked rows down to the cap and keeps locked ones", async () => {
    const t0 = new Date()
    const at0 = (m: number) => new Date(t0.getTime() - m * 60_000)
    const row = (key: string, minutesAgo: number, locked = false) => ({
      kind: "ip",
      key,
      failedCount: 1,
      firstFailedAt: at0(minutesAgo),
      lastFailedAt: at0(minutesAgo),
      lockedUntil: locked ? new Date(t0.getTime() + 600_000) : null,
    })
    await prismaTest.loginThrottle.createMany({
      data: [
        row("10.0.0.1", 50, true), // oldest, but locked
        row("10.0.0.2", 40),
        row("10.0.0.3", 30),
        row("10.0.0.4", 20),
        row("10.0.0.5", 10),
      ],
    })

    await enforceRowCap(3, t0)

    const keys = (await prismaTest.loginThrottle.findMany({ select: { key: true }, orderBy: { key: "asc" } })).map((r) => r.key)
    expect(keys).toEqual(["10.0.0.1", "10.0.0.4", "10.0.0.5"])
  })

  it("never evicts locked rows, even above the cap", async () => {
    const t0 = new Date()
    const until = new Date(t0.getTime() + 600_000)
    await prismaTest.loginThrottle.createMany({
      data: ["a", "b", "c"].map((k) => ({
        kind: "account", key: k, failedCount: 3, firstFailedAt: t0, lastFailedAt: t0, lockedUntil: until,
      })),
    })
    await enforceRowCap(1, t0)
    expect(await prismaTest.loginThrottle.count()).toBe(3)
  })
})

describe("admin list and unlock", () => {
  it("lists active locks and unlocks an account", async () => {
    const t0 = new Date()
    for (let i = 0; i < 3; i++) await recordLoginFailure("gina@x.io", null, POLICY, "credentials", t0)
    await recordLoginFailure("hank@x.io", null, POLICY, "credentials", t0)

    const locks = await listActiveLocks(t0)
    expect(locks).toHaveLength(1)
    expect(locks[0]).toMatchObject({ kind: "account", key: "gina@x.io", failedCount: 3 })

    expect(await unlockLogin("account", "gina@x.io")).toBe(true)
    expect(await findActiveLock("gina@x.io", null, POLICY, t0)).toBeNull()
    expect(await listActiveLocks(t0)).toEqual([])
    expect(await unlockLogin("account", "gina@x.io")).toBe(false)
  })
})
