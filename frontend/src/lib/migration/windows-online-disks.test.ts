import { describe, it, expect } from "vitest"
import { windowsOnlineDisksCommand, windowsOnlineDisksPs1, windowsOnlineDisksFailed, windowsOnlineDisksScheduled } from "./windows-online-disks"

describe("windowsOnlineDisksPs1 (lab 22/10, Windows Server 2025 data disk offline after warm and cold)", () => {
  const ps1 = windowsOnlineDisksPs1(3)

  it("brings online, then writable, only the disks offline because of the SAN policy", () => {
    const lines = ps1.split("\r\n")
    const filter = lines.find(l => l.startsWith("foreach"))!
    expect(filter).toContain("$_.IsOffline")
    // The reason prints as "Policy" (Storage module enum) or 1 (raw CIM value).
    expect(filter).toContain("\"$($_.OfflineReason)\" -in @('Policy', '1')")
    // Not virt-v2v's filter: vioscsi disks are "QEMU QEMU HARDDISK".
    expect(ps1).not.toContain("VirtIO")
    const online = lines.findIndex(l => l.includes("-IsOffline $false"))
    const writable = lines.findIndex(l => l.includes("-IsReadOnly $false"))
    expect(online).toBeGreaterThan(0)
    expect(writable).toBeGreaterThan(online)
    // Constrained Language Mode: by number, no pipeline object into Set-Disk.
    expect(ps1).not.toMatch(/\|\s*Set-Disk/)
  })

  it("first waits, two minutes at most, for Windows to see all the guest's disks: it runs before virt-v2v's wait for PnP", () => {
    const lines = ps1.split("\r\n")
    expect(lines[1]).toBe("$until = (Get-Date).AddMinutes(2)")
    expect(lines[2]).toBe("while (@(Get-Disk).Count -lt 3 -and (Get-Date) -lt $until) { Start-Sleep -Seconds 5 }")
    expect(lines.findIndex(l => l.startsWith("foreach"))).toBe(3)
  })
})

describe("windowsOnlineDisksCommand", () => {
  it("keeps the script out of directories any guest user can write: it runs as SYSTEM (Sonar S5443)", () => {
    const cmd = windowsOnlineDisksCommand({ disk: "'/t/vm-sda'", disks: 2, localPath: "'/t/x.ps1'", logPath: "'/t/x.log'" })
    expect(cmd).not.toMatch(/Temp/i)
    expect(cmd).toContain(":'/Program Files/Guestfs/Firstboot/")
  })

  it("writes the script on the node and schedules it at first boot of the boot disk", () => {
    const cmd = windowsOnlineDisksCommand({ disk: '"$D/disk0.qcow2"', disks: 2, localPath: '"$D/online-disks.ps1"', logPath: '"$D/online-disks.log"', format: "qcow2" })
    const [write, customize] = cmd.split("\n")
    const b64 = /^echo '([A-Za-z0-9+/=]+)' \| base64 -d > "\$D\/online-disks\.ps1"$/.exec(write)?.[1]
    expect(Buffer.from(b64!, "base64").toString()).toBe(windowsOnlineDisksPs1(2))
    expect(customize).toBe(
      "LIBGUESTFS_BACKEND=direct virt-customize --no-network --format qcow2 -a \"$D/disk0.qcow2\""
      + " --mkdir '/Program Files/Guestfs/Firstboot'"
      + " --upload \"$D/online-disks.ps1\":'/Program Files/Guestfs/Firstboot/proxcenter-online-disks.ps1'"
      + String.raw` --firstboot-command 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\Program Files\Guestfs\Firstboot\proxcenter-online-disks.ps1"'`
      + " < /dev/null > \"$D/online-disks.log\" 2>&1",
    )
  })

  it("lets libguestfs pick the format when none is given", () => {
    expect(windowsOnlineDisksCommand({ disk: "'/t/vm-sda'", disks: 2, localPath: "'/t/x.ps1'", logPath: "'/t/x.log'" })).toContain("--no-network -a '/t/vm-sda' --mkdir")
  })
})

describe("online-disks log lines", () => {
  it("counts the data disks", () => {
    expect(windowsOnlineDisksScheduled(1)).toBe("Guest disks: Windows keeps the disks it finds on a new controller offline, so the data disk is brought online at the first boot")
    expect(windowsOnlineDisksScheduled(2)).toContain("so the 2 data disks are brought online")
  })

  it("gives the operator the way out when it could not be scheduled", () => {
    expect(windowsOnlineDisksFailed("virt-customize: error: no operating systems were found")).toBe(
      "Guest disks: the data disks could not be set to come online at the first boot (virt-customize: error: no operating systems were found); Windows keeps the disks it finds on a new controller offline, bring them online in Disk Management",
    )
    expect(windowsOnlineDisksFailed("")).toContain("(no detail)")
  })
})
