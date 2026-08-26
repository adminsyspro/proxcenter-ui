import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/tenant", () => ({ getTenantPrisma: vi.fn() }))
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/ssh/exec", () => ({ executeSSH: vi.fn(), shellEscape: vi.fn() }))

import { cbtEligibilityXcpng, XCPNG_SNAPSHOT_PREFIX } from "./xcpng-warm-pipeline"
import type { XoDiskInfo } from "@/lib/xcpng/client"

function disk(label: string, srType: string): XoDiskInfo {
  return {
    vdiUuid: `vdi-${label}`,
    label,
    sizeBytes: 1024,
    position: 0,
    srUuid: `sr-${label}`,
    srType,
  }
}

describe("cbtEligibilityXcpng", () => {
  it("allows ext and nfs storage repositories", () => {
    expect(cbtEligibilityXcpng([
      disk("root", "ext"),
      disk("data", "nfs"),
    ])).toEqual({ eligible: true })
  })

  it("rejects an unsupported storage repository and names its disk", () => {
    const result = cbtEligibilityXcpng([
      disk("root", "ext"),
      disk("database", "zfs-vol"),
    ])

    expect(result.eligible).toBe(false)
    expect(result.reason).toContain("database")
  })

  it("rejects an empty storage repository type and names its disk", () => {
    const result = cbtEligibilityXcpng([
      disk("unknown-storage", ""),
    ])

    expect(result.eligible).toBe(false)
    expect(result.reason).toContain("unknown-storage")
  })
})

it("uses the stable XCP-ng warm snapshot prefix", () => {
  expect(XCPNG_SNAPSHOT_PREFIX).toBe("proxcenter-warm")
})
