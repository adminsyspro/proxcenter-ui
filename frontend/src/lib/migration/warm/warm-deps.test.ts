import { describe, it, expect } from "vitest"
import { needsVddkPush, buildWarmInstallScript } from "./warm-deps"

describe("needsVddkPush", () => {
  it("pushes when the node has no deployed VDDK", () => {
    expect(needsVddkPush("9.1.0", null)).toBe(true)
  })
  it("pushes when the deployed version differs", () => {
    expect(needsVddkPush("9.1.0", "8.0.3")).toBe(true)
  })
  it("skips when the deployed version matches", () => {
    expect(needsVddkPush("9.1.0", "9.1.0")).toBe(false)
  })
})

describe("buildWarmInstallScript", () => {
  const s = buildWarmInstallScript("9.1.0", "/tmp/proxcenter-vddk.tar.gz")

  it("installs nbdkit + nbd-client from Debian main, NOT the non-free plugin", () => {
    // nbdkit-plugin-vddk is non-free (admin prerequisite); warm-install only
    // covers the main packages + the uploaded VDDK lib.
    expect(s).toContain("apt-get install -y nbdkit nbd-client")
    expect(s).not.toContain("nbdkit-plugin-vddk")
  })
  it("tolerates a failing apt-get update (the enterprise repo 401 without a subscription)", () => {
    expect(s).toContain("apt-get update -qq || true")
  })
  it("extracts the delivered VDDK into the default libdir and records the version marker", () => {
    expect(s).toContain("/usr/lib/vmware-vix-disklib")
    expect(s).toContain("'9.1.0'")
    expect(s).toContain("tar -xzf '/tmp/proxcenter-vddk.tar.gz'")
  })
  it("ensures the so.8 -> so.9 symlink and loads the nbd module", () => {
    expect(s).toContain("libvixDiskLib.so.8")
    expect(s).toContain("modprobe nbd max_part=0")
  })
})
