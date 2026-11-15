import { describe, expect, it, vi } from "vitest"

import { resolveSyncIntervalSec } from "./sync-interval-source"

const db = (row: { migrationSyncIntervalSec: number | null } | null | Error) => ({
  connection: { findUnique: vi.fn(async () => { if (row instanceof Error) throw row; return row }) },
})

describe("resolveSyncIntervalSec", () => {
  it("uses the value typed for the migration over the connection's", async () => {
    expect(await resolveSyncIntervalSec(1800, "src", db({ migrationSyncIntervalSec: 900 }))).toBe(1800)
  })

  it("falls back to the source connection's setting", async () => {
    expect(await resolveSyncIntervalSec(undefined, "src", db({ migrationSyncIntervalSec: 900 }))).toBe(900)
  })

  it("falls back to one minute when neither is set", async () => {
    expect(await resolveSyncIntervalSec(undefined, "src", db({ migrationSyncIntervalSec: null }))).toBe(60)
    expect(await resolveSyncIntervalSec(undefined, "src", db(null))).toBe(60)
  })

  it("ignores a value outside the bounds, whichever side it comes from", async () => {
    expect(await resolveSyncIntervalSec(5, "src", db({ migrationSyncIntervalSec: 900 }))).toBe(900)
    expect(await resolveSyncIntervalSec(undefined, "src", db({ migrationSyncIntervalSec: 999999 }))).toBe(60)
  })

  it("keeps the migration's value, or one minute, when the connection cannot be read", async () => {
    expect(await resolveSyncIntervalSec(1800, "src", db(new Error("db down")))).toBe(1800)
    expect(await resolveSyncIntervalSec(undefined, "src", db(new Error("db down")))).toBe(60)
  })
})
