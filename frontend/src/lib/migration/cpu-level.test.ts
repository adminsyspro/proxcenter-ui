import { describe, it, expect } from "vitest"

import {
  cpuModelLevel, cpuTooLowForEl10, el10CpuWarning, isEl10Guest, isEl10Inspection, missingFlagsForLevel, x86LevelFromFlags, EL10_CPU_TYPE,
} from "./cpu-level"

// Real values of the lab vCenter (19/10/2026, vSphere 8.0.3).
const almaData = "architecture='X86' bitness='64' cpeString='cpe:/o:almalinux:almalinux:10.1' distroAddlVersion='10.1 (Heliotrope Lion)' distroName='AlmaLinux' distroVersion='10.1' familyName='Linux' kernelVersion='6.12.0-124.56.5.el10_1.x86_64' prettyName='AlmaLinux 10.1 (Heliotrope Lion)'"
const rockyData = "architecture='X86' bitness='64' cpeString='cpe:/o:rocky:rocky:9::baseos' distroName='Rocky Linux' distroVersion='9.8' familyName='Linux' kernelVersion='5.14.0-687.10.1.el9_8.0.1.x86_64' prettyName='Rocky Linux 9.8 (Blue Onyx)'"

describe("isEl10Guest", () => {
  it("reads the version the guest reported, the configured type saying nothing", () => {
    expect(isEl10Guest({ guestId: "almalinux_64Guest", guestOS: "AlmaLinux (64-bit)", detailedData: almaData })).toBe(true)
    expect(isEl10Guest({ guestId: "rockylinux_64Guest", guestOS: "Rocky Linux (64-bit)", detailedData: rockyData })).toBe(false)
    expect(isEl10Guest({ guestId: "almalinux_64Guest", guestOS: "AlmaLinux (64-bit)" })).toBe(false)
  })

  it("leaves out the x86-64-v2 rebuild of AlmaLinux 10", () => {
    expect(isEl10Guest({ detailedData: almaData.replace("el10_1.x86_64", "el10_1.x86_64_v2") })).toBe(false)
  })

  it("falls back to the kernel, the guest id and the name", () => {
    expect(isEl10Guest({ detailedData: "kernelVersion='6.12.0-55.el10.x86_64'" })).toBe(true)
    expect(isEl10Guest({ guestId: "rhel10_64Guest" })).toBe(true)
    expect(isEl10Guest({ guestOS: "Red Hat Enterprise Linux 10 (64-bit)" })).toBe(true)
    expect(isEl10Guest({ guestOS: "Rocky Linux 10.0 (Red Quartz)" })).toBe(true)
    expect(isEl10Guest({ guestOS: "Red Hat Enterprise Linux 9 (64-bit)" })).toBe(false)
    expect(isEl10Guest({ guestOS: "Ubuntu Linux 10.04 (64-bit)" })).toBe(false)
    expect(isEl10Guest({ guestOS: "Microsoft Windows 10 (64-bit)" })).toBe(false)
    expect(isEl10Guest({})).toBe(false)
  })
})

describe("isEl10Inspection", () => {
  it("reads virt-v2v's osinfo id", () => {
    expect(isEl10Inspection("Converting AlmaLinux release 10.1 (Heliotrope Lion) (redhat-based10.1) to run on KVM")).toBe(true)
    expect(isEl10Inspection("Converting Red Hat Enterprise Linux 10.0 (Coughlan) (rhel10.0) to run on KVM")).toBe(true)
    expect(isEl10Inspection("Converting Rocky Linux 9.8 (Blue Onyx) (rocky9) to run on KVM")).toBe(false)
  })
})

describe("CPU levels", () => {
  it("knows the fixed levels and nothing else", () => {
    expect(cpuModelLevel("x86-64-v2-AES")).toBe(2)
    expect(cpuModelLevel("x86-64-v3")).toBe(3)
    expect(cpuModelLevel("kvm64")).toBe(1)
    expect(cpuModelLevel("host")).toBeNull()
    expect(cpuModelLevel("custom-gold")).toBeNull()
    expect(cpuModelLevel(undefined)).toBeNull()
    expect(cpuModelLevel("toString")).toBeNull()
  })

  it("flags only the models known to be below v3", () => {
    expect(cpuTooLowForEl10("x86-64-v2-AES")).toBe(true)
    expect(cpuTooLowForEl10("kvm64")).toBe(true)
    expect(cpuTooLowForEl10(EL10_CPU_TYPE)).toBe(false)
    expect(cpuTooLowForEl10("x86-64-v4")).toBe(false)
    expect(cpuTooLowForEl10("host")).toBe(false)
  })

  it("derives a node's level from its CPU flags", () => {
    const v2 = "fpu cx16 lahf_lm popcnt sse4_1 sse4_2 ssse3"
    const v3 = `${v2} avx avx2 bmi1 bmi2 f16c fma abm movbe xsave`
    expect(x86LevelFromFlags("fpu sse2")).toBe(1)
    expect(x86LevelFromFlags(v2)).toBe(2)
    expect(x86LevelFromFlags(v3)).toBe(3)
    expect(x86LevelFromFlags(`${v3} avx512f avx512bw avx512cd avx512dq avx512vl`)).toBe(4)
    // a v4 flag without the v3 ones does not make a v4 node
    expect(x86LevelFromFlags(`${v2} avx512f avx512bw avx512cd avx512dq avx512vl`)).toBe(2)
    expect(missingFlagsForLevel(v2, 3)).toEqual(["avx", "avx2", "bmi1", "bmi2", "f16c", "fma", "abm", "movbe", "xsave"])
    expect(missingFlagsForLevel(v3, 3)).toEqual([])
  })

  it("names the model and the fix in the warning", () => {
    expect(el10CpuWarning("kvm64")).toContain("with the kvm64 CPU type it stops at \"Run /init as init process\". Set the CPU type of the target VM to x86-64-v3")
  })
})
