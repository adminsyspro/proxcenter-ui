import { describe, it, expect } from "vitest"
import { tpmstate0Param, vtpmPreflightWarning, vtpmCreatedLine } from "./vtpm"

describe("vTPM awareness", () => {
  it("creates an empty TPM 2.0 state volume on the target storage", () => {
    expect(tpmstate0Param("CephStoragePool")).toBe("CephStoragePool:1,version=v2.0")
  })
  it("warns that the TPM state is never copied and that the BitLocker recovery key is needed", () => {
    const w = vtpmPreflightWarning()
    expect(w).toMatch(/virtual TPM/)
    expect(w).toMatch(/never copied/)
    expect(w).toMatch(/BitLocker/)
    expect(w).toMatch(/recovery key/)
    expect(w).toMatch(/tpmstate0/)
    expect(vtpmCreatedLine("local-lvm")).toContain('"local-lvm"')
  })
})
