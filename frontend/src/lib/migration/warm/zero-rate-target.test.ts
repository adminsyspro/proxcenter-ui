import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

import { resolveWarmZeroRateLimit } from "./zero-rate-target"

const db = (value: number | null | Error) => ({
  connection: {
    findUnique: vi.fn(async () => {
      if (value instanceof Error) throw value
      return { warmZeroRateLimitMBps: value }
    }),
  },
})

describe("resolveWarmZeroRateLimit (roadmap#45)", () => {
  it("takes the value typed for this migration over the target connection's", async () => {
    const d = db(300)
    expect(await resolveWarmZeroRateLimit(150, "c1", d)).toBe(150)
    expect(await resolveWarmZeroRateLimit(0, "c1", d)).toBe(0)
    expect(d.connection.findUnique).not.toHaveBeenCalled()
  })

  it("falls back to the cap of the target PVE connection", async () => {
    const d = db(300)
    expect(await resolveWarmZeroRateLimit(undefined, "c1", d)).toBe(300)
    expect(d.connection.findUnique).toHaveBeenCalledWith({ where: { id: "c1" }, select: { warmZeroRateLimitMBps: true } })
  })

  it("is unlimited when the connection has no cap, or cannot be read", async () => {
    expect(await resolveWarmZeroRateLimit(null, "c1", db(null))).toBe(0)
    expect(await resolveWarmZeroRateLimit(undefined, "c1", db(0))).toBe(0)
    expect(await resolveWarmZeroRateLimit(undefined, "c1", db(new Error("db down")))).toBe(0)
  })
})
