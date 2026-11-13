import { describe, expect, it, vi } from "vitest"

import { tenantWriteFailure } from "./writeFailure"

describe("tenantWriteFailure", () => {
  it("answers 409 for a slug already taken, whichever way the database says it", async () => {
    for (const e of [{ code: "P2002", message: "Unique constraint failed on the constraint: `tenants_slug_key`" }, new Error("UNIQUE constraint failed: tenants.slug")]) {
      const res = tenantWriteFailure(e, "create")
      expect(res.status).toBe(409)
      expect(await res.json()).toEqual({ error: "A tenant with this slug already exists" })
    }
  })

  it("answers 500 without the database error, which goes to the log", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    for (const e of [new Error("Invalid `prisma.tenant.update()` invocation in /srv/app/chunk.js"), null, "boom"]) {
      const res = tenantWriteFailure(e, "update")
      expect(res.status).toBe(500)
      expect(await res.json()).toEqual({ error: "Server error" })
    }
    expect(log).toHaveBeenCalledTimes(3)
    log.mockRestore()
  })
})
