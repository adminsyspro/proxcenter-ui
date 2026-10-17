import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

import { resolveIntegritySettings } from "./integrity-target"

describe("resolveIntegritySettings (roadmap#1)", () => {
  it("reads the target connection", async () => {
    const findUnique = vi.fn(async () => ({ integrityCheckEnabled: false, integrityRegionCount: 2, integrityRegionSizeMiB: 8 }))
    expect(await resolveIntegritySettings("c1", { connection: { findUnique } })).toEqual({ enabled: false, regionCount: 2, regionSizeMiB: 8 })
    expect(findUnique).toHaveBeenCalledWith({ where: { id: "c1" }, select: { integrityCheckEnabled: true, integrityRegionCount: true, integrityRegionSizeMiB: true } })
  })
  it("keeps the check ON with the defaults when the connection cannot be read", async () => {
    const findUnique = vi.fn(async () => { throw new Error("db down") })
    expect(await resolveIntegritySettings("c1", { connection: { findUnique } })).toEqual({ enabled: true, regionCount: 8, regionSizeMiB: 4 })
  })
})
