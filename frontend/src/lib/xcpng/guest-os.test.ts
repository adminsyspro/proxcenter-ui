import { describe, it, expect } from "vitest"
import { xenGuestOs } from "./guest-os"

describe("xenGuestOs", () => {
  it("keeps what the guest agent reported", () => {
    expect(xenGuestOs({ osVersion: { name: "Microsoft Windows Server 2025 Standard Evaluation|C:\\WINDOWS", distro: "windows" }, otherConfig: { base_template_name: "Debian Bookworm 12" } }))
      .toBe("Microsoft Windows Server 2025 Standard Evaluation|C:\\WINDOWS")
    expect(xenGuestOs({ osVersion: { distro: "debian" } })).toBe("debian")
  })

  it("falls back to the template the VM was installed from when the VM Tools never reported", () => {
    expect(xenGuestOs({ osVersion: {}, otherConfig: { base_template_name: "Windows 10 (64-bit)" } })).toBe("Windows 10 (64-bit)")
    expect(xenGuestOs({ osVersion: null, otherConfig: { base_template_name: "Other install media" }, referenceLabel: "windows-server-2025" })).toBe("windows server 2025")
  })

  it("takes a VM with the viridian flag for Windows when nothing else names its OS", () => {
    expect(xenGuestOs({ viridian: "true" })).toBe("Windows")
    expect(xenGuestOs({ viridian: true })).toBe("Windows")
    expect(xenGuestOs({ viridian: "false" })).toBe("")
    expect(xenGuestOs({})).toBe("")
  })
})
