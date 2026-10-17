import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  holds: vi.fn(),
  isSuper: vi.fn(),
  hasTenant: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({ prisma: { user: { findUnique: mocks.findUnique } } }))
vi.mock("@/lib/rbac", () => ({ holdsBroadPermission: mocks.holds, isUserSuperAdmin: mocks.isSuper }))
vi.mock("@/lib/tenant", () => ({ userHasAccessToTenant: mocks.hasTenant }))

import { _resetCreatorCheckCache, creatorStillHolds } from "./creatorCheck"
import { WRITE_SCOPE_DEFINITIONS } from "./scopes"

const SCOPE = Object.keys(WRITE_SCOPE_DEFINITIONS)[0]
const KEYS = WRITE_SCOPE_DEFINITIONS[SCOPE]
const token = { tokenId: "t1", tenantId: "ten1", creatorUserId: "u1", connectionIds: ["c1"] as string[] | null }

beforeEach(() => {
  vi.useFakeTimers()
  _resetCreatorCheckCache()
  Object.values(mocks).forEach((m) => m.mockReset())
  mocks.findUnique.mockResolvedValue({ enabled: true })
  mocks.isSuper.mockResolvedValue(false)
  mocks.hasTenant.mockResolvedValue(true)
  mocks.holds.mockResolvedValue(true)
})
afterEach(() => vi.useRealTimers())

describe("creatorStillHolds", () => {
  it("is false without a creator", async () => {
    expect(await creatorStillHolds({ ...token, creatorUserId: null }, SCOPE)).toBe(false)
  })

  it("is false for a missing or disabled user", async () => {
    mocks.findUnique.mockResolvedValueOnce(null)
    expect(await creatorStillHolds(token, SCOPE)).toBe(false)
    _resetCreatorCheckCache()
    mocks.findUnique.mockResolvedValueOnce({ enabled: false })
    expect(await creatorStillHolds(token, SCOPE)).toBe(false)
  })

  it("is false for an unknown or non-write scope", async () => {
    expect(await creatorStillHolds(token, "vms:read")).toBe(false)
    expect(await creatorStillHolds(token, "nope")).toBe(false)
    expect(mocks.holds).not.toHaveBeenCalled()
  })

  it("is false for a non super admin without access to the token tenant", async () => {
    mocks.hasTenant.mockResolvedValue(false)
    expect(await creatorStillHolds(token, SCOPE)).toBe(false)
    expect(mocks.holds).not.toHaveBeenCalled()
  })

  it("is true for a super admin even without tenant membership", async () => {
    mocks.isSuper.mockResolvedValue(true)
    mocks.hasTenant.mockResolvedValue(false)
    expect(await creatorStillHolds(token, SCOPE)).toBe(true)
  })

  it("requires every key of the scope", async () => {
    mocks.holds.mockImplementation(async (_u: string, _t: string, key: string) => key !== KEYS[KEYS.length - 1])
    expect(await creatorStillHolds(token, SCOPE)).toBe(false)
    expect(mocks.holds).toHaveBeenCalledWith("u1", "ten1", KEYS[0], ["c1"])
  })

  it("is true when the creator holds every key", async () => {
    expect(await creatorStillHolds(token, SCOPE)).toBe(true)
    expect(mocks.holds).toHaveBeenCalledTimes(KEYS.length)
  })

  it("caches the verdict for 60 s then recomputes", async () => {
    await creatorStillHolds(token, SCOPE)
    await creatorStillHolds(token, SCOPE)
    expect(mocks.holds).toHaveBeenCalledTimes(KEYS.length)
    vi.advanceTimersByTime(60_001)
    mocks.holds.mockResolvedValue(false)
    expect(await creatorStillHolds(token, SCOPE)).toBe(false)
    expect(mocks.holds).toHaveBeenCalledTimes(KEYS.length + 1)
  })

  it("caches a false verdict too", async () => {
    mocks.hasTenant.mockResolvedValue(false)
    await creatorStillHolds(token, SCOPE)
    mocks.hasTenant.mockResolvedValue(true)
    expect(await creatorStillHolds(token, SCOPE)).toBe(false)
    expect(mocks.hasTenant).toHaveBeenCalledTimes(1)
  })
})
