import { describe, it, expect, vi } from "vitest"

// The module also exposes fetchSourceApiVersion, which reaches the DB and the
// source over SOAP; the pure verdict logic below needs neither.
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))
vi.mock("@/lib/vmware/soap", () => ({ soapRetrieveServiceContent: vi.fn() }))

import {
  ABSOLUTE_MIN_SOURCE_VERSION,
  checkWarmSourceVersion,
  compareVersions,
  parseVersion,
  vddkMajorFromLibPath,
  warmSourceVersionError,
  warmSourceVersionWarning,
} from "./source-version"

describe("parseVersion", () => {
  it("accepts the component counts vSphere actually reports", () => {
    expect(parseVersion("5.5")).toEqual([5, 5])
    expect(parseVersion("6.7.3")).toEqual([6, 7, 3])
    expect(parseVersion("8.0.3.0")).toEqual([8, 0, 3, 0])
  })
  it("returns null for anything that is not a dotted number", () => {
    expect(parseVersion("")).toBeNull()
    expect(parseVersion("   ")).toBeNull()
    expect(parseVersion("unknown")).toBeNull()
    expect(parseVersion("6.7-beta")).toBeNull()
    expect(parseVersion("v7.0")).toBeNull()
  })
})

describe("compareVersions", () => {
  it("compares component by component, padding the shorter side with zeroes", () => {
    expect(compareVersions("5.5", "6.5")).toBeLessThan(0)
    expect(compareVersions("7.0", "6.7")).toBeGreaterThan(0)
    expect(compareVersions("8.0", "8.0.3.0")).toBeLessThan(0)
    expect(compareVersions("8.0.0.0", "8.0")).toBe(0)
  })
  // 6.7 sorts after 6.5 numerically, which is also the vSphere release order.
  it("orders the 6.x line the way vSphere released it", () => {
    expect(compareVersions("6.0", "6.5")).toBeLessThan(0)
    expect(compareVersions("6.5", "6.7")).toBeLessThan(0)
    expect(compareVersions("6.7", "7.0")).toBeLessThan(0)
  })
})

describe("vddkMajorFromLibPath", () => {
  // What the node probe resolves through the SONAME nbdkit dlopens.
  it("reads the generation from the real library file", () => {
    expect(vddkMajorFromLibPath("/usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.9.1.0.0")).toBe(9)
    expect(vddkMajorFromLibPath("/opt/vddk/lib64/libvixDiskLib.so.8.0.3")).toBe(8)
  })
  it("reads a bare SONAME too", () => {
    expect(vddkMajorFromLibPath("/opt/vddk/lib64/libvixDiskLib.so.8")).toBe(8)
  })
  it("is undefined when the probe read nothing", () => {
    expect(vddkMajorFromLibPath(undefined)).toBeUndefined()
    expect(vddkMajorFromLibPath("")).toBeUndefined()
    // The unversioned symlink says nothing about the generation behind it.
    expect(vddkMajorFromLibPath("/opt/vddk/lib64/libvixDiskLib.so")).toBeUndefined()
  })
})

describe("checkWarmSourceVersion", () => {
  const VDDK9 = "/usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.9.1.0.0"
  const VDDK8 = "/usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.8.0.3"

  // The #946 report: ESXi 5.5.0 build 3568722 against a node carrying VDDK 9.1.
  it("blocks the ESXi 5.5 source of #946", () => {
    const v = checkWarmSourceVersion({ sourceApiVersion: "5.5", vddkLibPath: VDDK9 })
    expect(v.blocked).toBe(true)
    expect(v.warning).toBe(false)
    expect(v.vddkMajor).toBe(9)
    expect(v.minVersion).toBe("7.0")
  })

  it("blocks anything under the absolute floor whatever the VDDK is", () => {
    for (const lib of [VDDK8, VDDK9, undefined]) {
      expect(checkWarmSourceVersion({ sourceApiVersion: "6.0", vddkLibPath: lib }).blocked).toBe(true)
      expect(checkWarmSourceVersion({ sourceApiVersion: "5.1", vddkLibPath: lib }).blocked).toBe(true)
    }
  })

  // Supported by VDDK 7, not by the 9 on the node: worth saying, not worth refusing.
  it("warns rather than blocks between the absolute floor and the installed VDDK's floor", () => {
    const v = checkWarmSourceVersion({ sourceApiVersion: "6.7", vddkLibPath: VDDK9 })
    expect(v.blocked).toBe(false)
    expect(v.warning).toBe(true)
    expect(v.minVersion).toBe("7.0")
  })

  it("stays silent on a source inside the installed VDDK's matrix", () => {
    for (const version of ["7.0", "8.0.3.0", "9.0"]) {
      const v = checkWarmSourceVersion({ sourceApiVersion: version, vddkLibPath: VDDK9 })
      expect(v.blocked).toBe(false)
      expect(v.warning).toBe(false)
    }
  })

  it("applies the VDDK 8 floor when that is what the node carries", () => {
    expect(checkWarmSourceVersion({ sourceApiVersion: "6.7", vddkLibPath: VDDK8 }).warning).toBe(false)
    expect(checkWarmSourceVersion({ sourceApiVersion: "6.5", vddkLibPath: VDDK8 }).warning).toBe(true)
  })

  // Never block on a reading we did not get: an unknown VDDK still refuses what
  // nothing can read, and says nothing about the rest.
  it("falls back to the absolute floor for an unrecognised VDDK", () => {
    const v = checkWarmSourceVersion({ sourceApiVersion: "6.5", vddkLibPath: "/opt/vddk/lib64/libvixDiskLib.so" })
    expect(v.minVersion).toBe(ABSOLUTE_MIN_SOURCE_VERSION)
    expect(v.blocked).toBe(false)
    expect(v.warning).toBe(false)
    expect(checkWarmSourceVersion({ sourceApiVersion: "5.5", vddkLibPath: undefined }).blocked).toBe(true)
  })

  it("says nothing when the source version could not be read", () => {
    for (const version of ["", "unknown"]) {
      const v = checkWarmSourceVersion({ sourceApiVersion: version, vddkLibPath: VDDK9 })
      expect(v.blocked).toBe(false)
      expect(v.warning).toBe(false)
    }
  })
})

describe("operator messages", () => {
  it("names both versions and points at the cold path", () => {
    const v = checkWarmSourceVersion({
      sourceApiVersion: "5.5",
      vddkLibPath: "/usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.9.1.0.0",
    })
    const msg = warmSourceVersionError(v)
    expect(msg).toContain("5.5")
    expect(msg).toContain("VDDK 9.x")
    expect(msg).toContain("cold migration")
  })
  it("warns without claiming the run will fail", () => {
    const v = checkWarmSourceVersion({
      sourceApiVersion: "6.7",
      vddkLibPath: "/usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.9.1.0.0",
    })
    const msg = warmSourceVersionWarning(v)
    expect(msg).toContain("6.7")
    expect(msg).toContain("7.0")
    expect(msg).toContain("may fail")
  })
})
