import { describe, it, expect } from "vitest"
import { parseVddkVersion, validateVddkTarballEntries } from "./vddk-artifact"

describe("parseVddkVersion", () => {
  it("extracts X.Y.Z from a Broadcom VDDK tarball name", () => {
    expect(parseVddkVersion("vmware-vix-disklib-9.1.0-24024531.x86_64.tar.gz")).toBe("9.1.0")
    expect(parseVddkVersion("VMware-vix-disklib-8.0.3-22624943.x86_64.tar.gz")).toBe("8.0.3")
  })
  it("returns null when no version is present", () => {
    expect(parseVddkVersion("random.tar.gz")).toBeNull()
  })
})

describe("validateVddkTarballEntries", () => {
  it("accepts a tarball that contains the VDDK shared library", () => {
    const entries = ["vmware-vix-disklib-distrib/", "vmware-vix-disklib-distrib/lib64/libvixDiskLib.so.9"]
    expect(validateVddkTarballEntries(entries).ok).toBe(true)
  })
  it("rejects a tarball without libvixDiskLib", () => {
    const r = validateVddkTarballEntries(["foo/bar.txt"])
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/libvixDiskLib/i)
  })
})
