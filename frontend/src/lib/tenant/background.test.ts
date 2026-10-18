import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/auth/principal", () => ({
  getPrincipal: vi.fn(async () => { throw new Error("`headers` was called outside a request scope") }),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

import { backgroundTenantId, runWithBackgroundTenant } from "./background"
import { getCurrentTenantId } from "./index"

describe("background tenant (roadmap#53)", () => {
  it("is set only inside runWithBackgroundTenant, across awaits", async () => {
    expect(backgroundTenantId()).toBeUndefined()
    const seen = await runWithBackgroundTenant("msp-1", async () => {
      await new Promise(r => setTimeout(r, 1))
      return backgroundTenantId()
    })
    expect(seen).toBe("msp-1")
    expect(backgroundTenantId()).toBeUndefined()
  })

  it("answers getCurrentTenantId without touching the request", async () => {
    await expect(runWithBackgroundTenant("msp-1", () => getCurrentTenantId())).resolves.toBe("msp-1")
    await expect(getCurrentTenantId()).rejects.toThrow(/outside a request scope/)
  })
})
