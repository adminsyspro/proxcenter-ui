import { describe, it, expect } from "vitest"
import { MIGRATION_CPU_TYPE_DEFAULT, MIGRATION_CPU_TYPES, resolveMigrationCpuType } from "./cpu-type"

describe("resolveMigrationCpuType (roadmap#24)", () => {
  it("falls back to the Proxmox default when the caller sends nothing", () => {
    expect(resolveMigrationCpuType(undefined)).toBe(MIGRATION_CPU_TYPE_DEFAULT)
    expect(resolveMigrationCpuType(null)).toBe("x86-64-v2-AES")
    expect(resolveMigrationCpuType("")).toBe("x86-64-v2-AES")
  })

  it("accepts every offered model as is", () => {
    for (const model of MIGRATION_CPU_TYPES) expect(resolveMigrationCpuType(model)).toBe(model)
  })

  it("rejects anything else so the route answers 400 rather than handing it to qm create", () => {
    expect(resolveMigrationCpuType("host,flags=+aes")).toBeNull()
    expect(resolveMigrationCpuType("X86-64-V2-AES")).toBeNull()
    expect(resolveMigrationCpuType(42)).toBeNull()
  })
})
