/**
 * Always-on second factor floor against a real Postgres schema.
 *
 * The counters share login_throttles with the configurable lockout (kind
 * "totp", keyed by user id) so they survive restarts and are shared across
 * instances. This suite proves the floor holds with the policy OFF: threshold,
 * window, expiry, reset on success, generic refusal, and the audit trail.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { prismaTest, truncate } from "../../__tests__/setup/prisma-test"

const auditMock = vi.fn(async (_entry: Record<string, unknown>) => "id")

vi.mock("@/lib/db/prisma", () => ({ prisma: prismaTest }))
vi.mock("@/lib/audit", () => ({ audit: auditMock }))

const {
  TOTP_THROTTLE_MAX_FAILURES,
  clearTotpFailures,
  isTotpThrottled,
  recordTotpFailure,
  withTotpThrottle,
} = await import("./totpThrottle")

const { listActiveLocks, unlockLogin } = await import("./loginLockout")

function at(base: Date, minutes: number) {
  return new Date(base.getTime() + minutes * 60_000)
}

async function seedUser(id: string, email: string) {
  const now = new Date()
  await prismaTest.user.create({ data: { id, email, createdAt: now, updatedAt: now } })
}

beforeEach(async () => {
  vi.clearAllMocks()
  await truncate(["login_throttles", "users"])
})

describe("recordTotpFailure", () => {
  it("locks at the fifth failure, not before, and audits login_locked once with the email", async () => {
    await seedUser("u1", "alice@x.io")
    const t0 = new Date()

    for (let i = 0; i < TOTP_THROTTLE_MAX_FAILURES - 1; i++) {
      expect(await recordTotpFailure("u1", "login", at(t0, i))).toBe(false)
    }
    expect(await isTotpThrottled("u1", at(t0, 4))).toBe(false)

    expect(await recordTotpFailure("u1", "login", at(t0, 4))).toBe(true)
    expect(await isTotpThrottled("u1", at(t0, 5))).toBe(true)

    const locked = auditMock.mock.calls.filter(([e]) => e.action === "login_locked")
    expect(locked).toHaveLength(1)
    expect(locked[0][0]).toMatchObject({
      userId: "u1",
      userEmail: "alice@x.io",
      resourceType: "login_totp",
      resourceName: "alice@x.io",
      status: "warning",
      details: { kind: "totp", key: "u1", context: "login", failedAttempts: 5 },
    })
  })

  it("lifts the lock after 15 minutes, and the next failure restarts the count", async () => {
    const t0 = new Date()
    for (let i = 0; i < 5; i++) await recordTotpFailure("u2", "login", at(t0, i))

    // Locked at t0+4 for 15 minutes.
    expect(await isTotpThrottled("u2", at(t0, 18))).toBe(true)
    expect(await isTotpThrottled("u2", at(t0, 20))).toBe(false)

    expect(await recordTotpFailure("u2", "login", at(t0, 20))).toBe(false)
    const row = await prismaTest.loginThrottle.findUnique({ where: { kind_key: { kind: "totp", key: "u2" } } })
    expect(row).toMatchObject({ failedCount: 1, lockedUntil: null })
  })

  it("forgets failures older than the 15 minute window", async () => {
    const t0 = new Date()
    for (let i = 0; i < 4; i++) await recordTotpFailure("u3", "login", at(t0, i))
    // Fifth failure 20 minutes after the first: the window restarted.
    expect(await recordTotpFailure("u3", "login", at(t0, 20))).toBe(false)
    expect(await isTotpThrottled("u3", at(t0, 20))).toBe(false)
  })

  it("keeps one counter per account", async () => {
    const t0 = new Date()
    for (let i = 0; i < 5; i++) await recordTotpFailure("victim", "login", t0)
    expect(await isTotpThrottled("victim", t0)).toBe(true)
    expect(await isTotpThrottled("bystander", t0)).toBe(false)
  })

  it("sweeps stale unlocked rows of its own kind when a lock is set", async () => {
    const t0 = new Date()
    const old = at(t0, -48 * 60)
    await prismaTest.loginThrottle.create({
      data: { kind: "totp", key: "stale", failedCount: 2, firstFailedAt: old, lastFailedAt: old },
    })
    await prismaTest.loginThrottle.create({
      data: { kind: "account", key: "policy@x.io", failedCount: 2, firstFailedAt: old, lastFailedAt: old },
    })

    for (let i = 0; i < 5; i++) await recordTotpFailure("u4", "login", t0)

    const keys = (await prismaTest.loginThrottle.findMany({ select: { kind: true, key: true }, orderBy: { key: "asc" } }))
    expect(keys).toEqual([{ kind: "account", key: "policy@x.io" }, { kind: "totp", key: "u4" }])
  })
})

describe("withTotpThrottle", () => {
  it("counts wrong codes, then refuses without calling the verifier, and audits the refusal", async () => {
    const t0 = new Date()
    const verify = vi.fn(async () => false)

    for (let i = 0; i < 5; i++) {
      expect(await withTotpThrottle("u5", "login", verify, at(t0, i))).toBe("invalid")
    }
    expect(verify).toHaveBeenCalledTimes(5)

    // Even a correct code is refused now: the verifier is not consulted.
    const correct = vi.fn(async () => true)
    expect(await withTotpThrottle("u5", "login", correct, at(t0, 5))).toBe("throttled")
    expect(correct).not.toHaveBeenCalled()

    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "2fa_login_failed",
      userId: "u5",
      details: { reason: "throttled", context: "login" },
    }))
  })

  it("a correct code clears the counter", async () => {
    const t0 = new Date()
    for (let i = 0; i < 4; i++) await withTotpThrottle("u6", "reauth", async () => false, t0)

    expect(await withTotpThrottle("u6", "reauth", async () => true, t0)).toBe("ok")
    expect(await prismaTest.loginThrottle.findUnique({ where: { kind_key: { kind: "totp", key: "u6" } } })).toBeNull()

    // Four more do not lock: the count restarted at zero.
    for (let i = 0; i < 4; i++) await withTotpThrottle("u6", "reauth", async () => false, t0)
    expect(await isTotpThrottled("u6", t0)).toBe(false)
  })

  it("the sign-in path and the re-auth helper share one counter", async () => {
    const t0 = new Date()
    for (let i = 0; i < 3; i++) await withTotpThrottle("u7", "login", async () => false, t0)
    for (let i = 0; i < 2; i++) await withTotpThrottle("u7", "reauth", async () => false, t0)
    expect(await isTotpThrottled("u7", t0)).toBe(true)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "login_locked",
      details: expect.objectContaining({ kind: "totp", context: "reauth" }),
    }))
  })
})

describe("clearTotpFailures", () => {
  it("removes the row", async () => {
    const t0 = new Date()
    for (let i = 0; i < 5; i++) await recordTotpFailure("u8", "login", t0)
    await clearTotpFailures("u8")
    expect(await isTotpThrottled("u8", t0)).toBe(false)
  })
})

describe("admin lockout list", () => {
  it("lists a second factor lock under the account email, keyed by user id, next to the policy's locks", async () => {
    await seedUser("u9", "nine@x.io")
    const t0 = new Date()
    for (let i = 0; i < 5; i++) await recordTotpFailure("u9", "login", t0)
    // A deleted user keeps its id as the label.
    for (let i = 0; i < 5; i++) await recordTotpFailure("ghost", "login", t0)
    await prismaTest.loginThrottle.create({
      data: { kind: "account", key: "bob@x.io", failedCount: 3, firstFailedAt: t0, lastFailedAt: t0, lockedUntil: at(t0, 10) },
    })

    const locks = await listActiveLocks(t0)
    expect(locks.map(({ kind, key, label }) => ({ kind, key, label })).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { kind: "account", key: "bob@x.io", label: "bob@x.io" },
      { kind: "totp", key: "ghost", label: "ghost" },
      { kind: "totp", key: "u9", label: "nine@x.io" },
    ])
    expect(locks.find((l) => l.key === "u9")).toMatchObject({ failedCount: 5 })
  })

  it("an admin lifts a second factor lock by its user id", async () => {
    const t0 = new Date()
    for (let i = 0; i < 5; i++) await recordTotpFailure("u10", "login", t0)
    expect(await isTotpThrottled("u10", t0)).toBe(true)

    expect(await unlockLogin("totp", "u10")).toBe(true)
    expect(await isTotpThrottled("u10", t0)).toBe(false)
    expect(await listActiveLocks(t0)).toEqual([])
    expect(await unlockLogin("totp", "u10")).toBe(false)
  })
})
