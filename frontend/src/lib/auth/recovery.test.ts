import { describe, expect, it, beforeEach, vi } from "vitest"
import {
  generateRecoveryCodes,
  hashRecoveryCode,
  consumeRecoveryCode,
  countRemainingRecoveryCodes,
  RECOVERY_CODE_PATTERN,
} from "./recovery"

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    userTotpRecoveryCode: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
  },
}))

import { prisma } from "@/lib/db/prisma"

describe("recovery codes", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("generates 10 unique codes matching the format", () => {
    const codes = generateRecoveryCodes()
    expect(codes).toHaveLength(10)
    expect(new Set(codes).size).toBe(10)
    for (const c of codes) {
      expect(c).toMatch(RECOVERY_CODE_PATTERN)
      expect(c).not.toMatch(/[0OIL1]/)
    }
  })

  it("hashRecoveryCode produces a salt:derived hex string that round-trips", async () => {
    const code = "ABCDE-FGHJK"
    const h = await hashRecoveryCode(code)
    expect(h).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}$/)

    // Verify via the public consume path on a mocked row
    ;(prisma.userTotpRecoveryCode.findMany as any).mockResolvedValue([{ id: "r1", codeHash: h }])
    ;(prisma.userTotpRecoveryCode.updateMany as any).mockResolvedValue({ count: 1 })
    const ok = await consumeRecoveryCode("u1", code, null)
    expect(ok).toBe(true)
  })

  it("consumeRecoveryCode succeeds and marks the row atomically", async () => {
    const code = "ABCDE-FGHJK"
    const hash = await hashRecoveryCode(code)
    ;(prisma.userTotpRecoveryCode.findMany as any).mockResolvedValue([
      { id: "r1", codeHash: hash },
    ])
    ;(prisma.userTotpRecoveryCode.updateMany as any).mockResolvedValue({ count: 1 })

    const ok = await consumeRecoveryCode("u1", code, "1.2.3.4")

    expect(ok).toBe(true)
    expect((prisma.userTotpRecoveryCode.updateMany as any).mock.calls[0][0].where.id).toBe("r1")
  })

  it("rejects an unknown code", async () => {
    ;(prisma.userTotpRecoveryCode.findMany as any).mockResolvedValue([
      { id: "r1", codeHash: await hashRecoveryCode("ZZZZZ-ZZZZZ") },
    ])

    const ok = await consumeRecoveryCode("u1", "ABCDE-FGHJK", null)

    expect(ok).toBe(false)
    expect(prisma.userTotpRecoveryCode.updateMany).not.toHaveBeenCalled()
  })

  it("rejects when updateMany finds no row (race lost)", async () => {
    const code = "ABCDE-FGHJK"
    const hash = await hashRecoveryCode(code)
    ;(prisma.userTotpRecoveryCode.findMany as any).mockResolvedValue([
      { id: "r1", codeHash: hash },
    ])
    ;(prisma.userTotpRecoveryCode.updateMany as any).mockResolvedValue({ count: 0 })

    const ok = await consumeRecoveryCode("u1", code, null)

    expect(ok).toBe(false)
  })

  it("countRemainingRecoveryCodes calls prisma.count with the right filter", async () => {
    ;(prisma.userTotpRecoveryCode.count as any).mockResolvedValue(7)
    const n = await countRemainingRecoveryCodes("u1")
    expect(n).toBe(7)
    expect((prisma.userTotpRecoveryCode.count as any).mock.calls[0][0])
      .toEqual({ where: { userId: "u1", consumedAt: null } })
  })
})
