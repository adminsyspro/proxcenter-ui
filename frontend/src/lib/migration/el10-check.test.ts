import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/vmware/soap", () => ({ soapGetGuestIdentities: vi.fn() }))

import { soapGetGuestIdentities } from "@/lib/vmware/soap"
import { el10InspectionWarning, warnIfEl10OnLowCpu } from "./el10-check"

const session = { baseUrl: "https://vc" } as any
const log = vi.fn(async () => {})

beforeEach(() => { vi.mocked(soapGetGuestIdentities).mockReset(); log.mockClear() })

describe("warnIfEl10OnLowCpu (#1000)", () => {
  it("warns for an EL10 guest the Tools data reveals, on the default CPU type", async () => {
    vi.mocked(soapGetGuestIdentities).mockResolvedValue(new Map([["vm-1", { guestId: "almalinux_64Guest", guestOS: "AlmaLinux (64-bit)", detailedData: "distroName='AlmaLinux' distroVersion='10.1' kernelVersion='6.12.0.el10_1.x86_64'" }]]))
    expect(await warnIfEl10OnLowCpu({ session, vmid: "vm-1", guest: { guestId: "almalinux_64Guest", guestOS: "AlmaLinux (64-bit)" }, log })).toBe(true)
    expect(log.mock.calls[0][0]).toMatch(/^This guest is an EL10/)
  })

  it("asks nothing when the CPU type is high enough, and keeps quiet for other guests", async () => {
    expect(await warnIfEl10OnLowCpu({ session, vmid: "vm-1", guest: { guestId: "rhel10_64Guest" }, cpuType: "x86-64-v3", log })).toBe(false)
    expect(soapGetGuestIdentities).not.toHaveBeenCalled()
    vi.mocked(soapGetGuestIdentities).mockResolvedValue(new Map())
    expect(await warnIfEl10OnLowCpu({ session, vmid: "vm-1", guest: { guestId: "rhel9_64Guest" }, log })).toBe(false)
    expect(await warnIfEl10OnLowCpu({ session: null, vmid: "vm-1", guest: { guestId: "rhel10_64Guest" }, cpuType: "kvm64", log })).toBe(true)
  })

  it("never throws", async () => {
    vi.mocked(soapGetGuestIdentities).mockRejectedValue(new Error("down"))
    expect(await warnIfEl10OnLowCpu({ session, vmid: "vm-1", guest: {}, log })).toBe(false)
  })
})

describe("el10InspectionWarning", () => {
  const out = '{ "message": "Converting AlmaLinux release 10.1 (Heliotrope Lion) (redhat-based10.1) to run on KVM", "type": "message" }'
  it("warns from the inspection line", () => {
    expect(el10InspectionWarning(out)).toMatch(/x86-64-v2-AES CPU type/)
    expect(el10InspectionWarning(out, "host")).toBeNull()
    expect(el10InspectionWarning("nothing")).toBeNull()
  })
})
