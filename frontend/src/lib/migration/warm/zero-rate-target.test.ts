import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

import { resolveWarmZeroRateLimit, tightenZeroRateLimit } from "./zero-rate-target"

const db = (value: number | null | Error) => ({
  connection: {
    findUnique: vi.fn(async () => {
      if (value instanceof Error) throw value
      return { warmZeroRateLimitMBps: value }
    }),
  },
})

describe("resolveWarmZeroRateLimit (roadmap#45)", () => {
  it("follows the target connection's cap when the job sets none", async () => {
    const d = db(300)
    expect(await resolveWarmZeroRateLimit(undefined, "c1", d)).toBe(300)
    expect(d.connection.findUnique).toHaveBeenCalledWith({ where: { id: "c1" }, select: { warmZeroRateLimitMBps: true } })
  })

  it("lets a migration tighten the cluster's cap, never loosen it", async () => {
    expect(await resolveWarmZeroRateLimit(150, "c1", db(300))).toBe(150)
    // higher than the cluster's cap, or unlimited: held to the cluster's cap
    expect(await resolveWarmZeroRateLimit(900, "c1", db(300))).toBe(300)
    expect(await resolveWarmZeroRateLimit(0, "c1", db(300))).toBe(300)
  })

  it("applies the job's value as is when the cluster has no cap", async () => {
    expect(await resolveWarmZeroRateLimit(150, "c1", db(null))).toBe(150)
    expect(await resolveWarmZeroRateLimit(0, "c1", db(0))).toBe(0)
    expect(await resolveWarmZeroRateLimit(null, "c1", db(null))).toBe(0)
  })

  it("keeps the job's own value, or unlimited, when the connection cannot be read", async () => {
    expect(await resolveWarmZeroRateLimit(150, "c1", db(new Error("db down")))).toBe(150)
    expect(await resolveWarmZeroRateLimit(undefined, "c1", db(new Error("db down")))).toBe(0)
  })
})

describe("tightenZeroRateLimit", () => {
  it.each([
    [300, undefined, 300], [300, 150, 150], [300, 300, 300], [300, 301, 300], [300, 0, 300],
    [0, undefined, 0], [0, 150, 150], [0, 0, 0],
  ])("cluster %j, job %j -> %j", (cluster, own, want) => {
    expect(tightenZeroRateLimit(cluster, own as number | undefined)).toBe(want)
  })
})
