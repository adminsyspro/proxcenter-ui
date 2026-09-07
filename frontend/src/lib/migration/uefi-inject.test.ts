import { describe, it, expect } from "vitest"
import { buildUefiInjectScript } from "./uefi-inject"

const BOOT_DISK_PATH = "/mnt/pve/local/images/100/vm-100-disk-0.raw"

describe("buildUefiInjectScript", () => {
  it("defines the holder release functions once before calling them", () => {
    const s = buildUefiInjectScript(BOOT_DISK_PATH)
    expect(s.match(/nbd_release_tree\(\) \{/g)).toHaveLength(1)
    expect(s.match(/nbd_release_holders\(\) \{/g)).toHaveLength(1)
    expect(s).toContain('nbd_release_holders "$NBD";')
    expect(s.indexOf("nbd_release_holders() {"))
      .toBeLessThan(s.indexOf('nbd_release_holders "$NBD";'))
  })

  it("releases holders on the same line before every disconnect", () => {
    const lines = buildUefiInjectScript(BOOT_DISK_PATH).split("\n")
      .filter(line => line.includes("qemu-nbd --disconnect"))
    expect(lines).toHaveLength(3)
    for (const line of lines) {
      expect(line).toMatch(/^\s*nbd_release_holders "\$NBD"; qemu-nbd --disconnect "\$NBD" >\/dev\/null 2>&1/)
    }
    expect(lines[1]).toContain('; rmdir "$MNT"')
  })

  it("keeps best-effort execution, partition support, and the boot disk path", () => {
    const s = buildUefiInjectScript(BOOT_DISK_PATH)
    expect(s.split("\n")[0]).toBe("set +e")
    expect(s).toContain("modprobe nbd max_part=16")
    expect(s).toContain('qemu-nbd --connect="$NBD" --format=raw "/mnt/pve/local/images/100/vm-100-disk-0.raw"')
  })

  it("preserves all result markers for the caller", () => {
    const s = buildUefiInjectScript(BOOT_DISK_PATH)
    for (const result of [
      "NO_FREE_NBD", "NBD_FAIL", "NO_EFI_PART", "MOUNT_FAIL",
      "WINDOWS_INJECTED", "ALREADY_PRESENT", "NO_BOOTLOADER",
    ]) {
      expect(s).toContain(`RESULT=${result}`)
    }
    expect(s).toContain('echo "INJECT_RESULT=$RESULT"')
  })
})
