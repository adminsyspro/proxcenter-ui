import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/ssh/exec", async (importActual) => ({ ...(await importActual<typeof import("@/lib/ssh/exec")>()), executeSSH: vi.fn() }))

import { executeSSH } from "@/lib/ssh/exec"
import {
  buildXenPvNeutralizeReg, neutralizeXenPvDrivers, parseXenPvScan, xenPvLogLine, xenPvMergeCommand, xenPvScanCommand, xenPvUnlockCommand,
} from "./xen-pv-drivers"

const ssh = vi.mocked(executeSSH)

const XENFILT = "58,00,45,00,4e,00,46,00,49,00,4c,00,54,00,00,00,00,00"
const PARTMGR = "70,00,61,00,72,00,74,00,6d,00,67,00,72,00,00,00,00,00"
const XENFILT_AND_PARTMGR = "58,00,45,00,4e,00,46,00,49,00,4c,00,54,00,00,00,70,00,61,00,72,00,74,00,6d,00,67,00,72,00,00,00,00,00"

/** Trimmed from the scan of a Windows Server 2025 with XenServer VM Tools 9.6 (lab, 09/11/2026). */
const SCAN = [
  String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Control\Class\{4d36e967-e325-11ce-bfc1-08002be10318}]`,
  `"UpperFilters"=hex(7):${PARTMGR}`,
  String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Control\Class\{4d36e96a-e325-11ce-bfc1-08002be10318}]`,
  `"UpperFilters"=hex(7):${XENFILT}`,
  String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Control\Class\{4d36e97d-e325-11ce-bfc1-08002be10318}]`,
  `"UpperFilters"=hex(7):${XENFILT_AND_PARTMGR}`,
  String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Services\XEN]`,
  String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Services\XenInstall]`,
  String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Services\XenSvc]`,
  String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Services\xenbus]`,
  String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Services\xenfilt]`,
  String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Services\xenvbd]`,
  String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet002\Control\Class\{4d36e96a-e325-11ce-bfc1-08002be10318}]`,
  `"UpperFilters"=hex(7):${XENFILT}`,
  String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet002\Services\xenbus]`,
  "XENPV-EXIT=0",
].join("\n")

beforeEach(() => ssh.mockReset())

describe("xenPvScanCommand", () => {
  it("exports the SYSTEM hive once with the disk format and reports virt-win-reg's exit code", () => {
    const cmd = xenPvScanCommand("/dev/r177/vm-118-disk-1", "raw")
    expect(cmd).toContain("virt-win-reg --format=raw '/dev/r177/vm-118-disk-1' 'HKLM\\SYSTEM'")
    expect(cmd).toContain("LIBGUESTFS_BACKEND=direct")
    expect(cmd).toMatch(/echo "XENPV-EXIT=\$RC"$/)
    expect(cmd).toContain('rm -f "$T"')
  })

  it("quotes a disk path with shell characters as one word", () => {
    expect(xenPvScanCommand("/var/lib/vz/images/9 9/vm-99-disk-0.qcow2", "qcow2")).toContain("--format=qcow2 '/var/lib/vz/images/9 9/vm-99-disk-0.qcow2'")
  })
})

describe("parseXenPvScan", () => {
  it("finds the Xen PV services and the XENFILT class filters in every control set", () => {
    const scan = parseXenPvScan(SCAN)!
    expect(scan.services).toEqual(["XenSvc", "xenbus", "xenfilt", "xenvbd"])
    expect(scan.serviceKeys).toEqual([
      String.raw`HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Services\XenSvc`,
      String.raw`HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Services\xenbus`,
      String.raw`HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Services\xenfilt`,
      String.raw`HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Services\xenvbd`,
      String.raw`HKEY_LOCAL_MACHINE\SYSTEM\ControlSet002\Services\xenbus`,
    ])
    expect(scan.filters.map(f => [f.key.split("\\").pop(), f.values])).toEqual([
      ["{4d36e96a-e325-11ce-bfc1-08002be10318}", ["XENFILT"]],
      ["{4d36e97d-e325-11ce-bfc1-08002be10318}", ["XENFILT", "partmgr"]],
      ["{4d36e96a-e325-11ce-bfc1-08002be10318}", ["XENFILT"]],
    ])
  })

  it("leaves out XEN (xen.sys, loaded through xenbus) and the installer service", () => {
    expect(parseXenPvScan(SCAN)!.services).not.toContain("XEN")
    expect(parseXenPvScan(SCAN)!.services).not.toContain("XenInstall")
  })

  it("is null when virt-win-reg failed or the output was cut", () => {
    expect(parseXenPvScan("XENPV-EXIT=1")).toBeNull()
    expect(parseXenPvScan(String.raw`[HKEY_LOCAL_MACHINE\SYSTEM\ControlSet001\Services\xenbus]`)).toBeNull()
  })

  it("finds nothing in a guest without VM Tools", () => {
    expect(parseXenPvScan(`[HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e967-e325-11ce-bfc1-08002be10318}]\n"UpperFilters"=hex(7):${PARTMGR}\nXENPV-EXIT=0`))
      .toEqual({ serviceKeys: [], services: [], filters: [] })
  })
})

describe("buildXenPvNeutralizeReg", () => {
  it("disables every Xen service key and drops XENFILT, keeping the other filters", () => {
    const reg = buildXenPvNeutralizeReg(parseXenPvScan(SCAN)!)!
    const lines = reg.split("\r\n")
    expect(lines[0]).toBe("Windows Registry Editor Version 5.00")
    expect(reg).toContain(`[HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e96a-e325-11ce-bfc1-08002be10318}]\r\n"UpperFilters"=-`)
    expect(reg).toContain(`[HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet001\\Control\\Class\\{4d36e97d-e325-11ce-bfc1-08002be10318}]\r\n"UpperFilters"=hex(7):${PARTMGR}`)
    expect(reg).toContain(`[HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet002\\Control\\Class\\{4d36e96a-e325-11ce-bfc1-08002be10318}]\r\n"UpperFilters"=-`)
    expect(lines.filter(l => l === '"Start"=dword:00000004')).toHaveLength(5)
    expect(reg).toContain(`[HKEY_LOCAL_MACHINE\\SYSTEM\\ControlSet002\\Services\\xenbus]\r\n"Start"=dword:00000004`)
  })

  it("is null when there is nothing to neutralize", () => {
    expect(buildXenPvNeutralizeReg({ serviceKeys: [], services: [], filters: [] })).toBeNull()
  })
})

describe("xenPvUnlockCommand", () => {
  it("drops the hiberfile first, resets the journal only if the volume is still unsafe, and reports the probe", () => {
    const cmd = xenPvUnlockCommand("/dev/r177/vm-113-disk-1", "raw")
    expect(cmd).toContain("guestfish --ro --format=raw -a '/dev/r177/vm-113-disk-1' run : inspect-os")
    expect(cmd.indexOf("remove_hiberfile")).toBeLessThan(cmd.indexOf("ntfsfix"))
    expect(cmd).toContain('echo "XENPV-PROBE=$P"')
    expect(cmd).toContain("XENPV-NOROOT")
  })
})

describe("xenPvMergeCommand", () => {
  it("ships the .reg base64-encoded and merges it in place", () => {
    const cmd = xenPvMergeCommand("/dev/r177/vm-118-disk-1", "raw", "Windows Registry Editor Version 5.00\r\n")
    expect(cmd).toContain(`echo '${Buffer.from("Windows Registry Editor Version 5.00\r\n").toString("base64")}' | base64 -d > "$F"`)
    expect(cmd).toContain("virt-win-reg --merge --format=raw '/dev/r177/vm-118-disk-1' \"$F\" 2>&1 && echo XENPV-MERGED")
    expect(cmd).toContain('rm -f "$F"')
  })
})

describe("neutralizeXenPvDrivers", () => {
  const args = { connectionId: "c1", nodeIp: "10.42.0.101", disk: "/dev/r177/vm-118-disk-1", format: "raw" as const }

  it("scans then merges, and reports what it disabled", async () => {
    ssh.mockResolvedValueOnce({ success: true, output: SCAN }).mockResolvedValueOnce({ success: true, output: "XENPV-MERGED\n" })
    const r = await neutralizeXenPvDrivers(args)
    expect(r).toEqual({ changed: true, services: ["XenSvc", "xenbus", "xenfilt", "xenvbd"], filters: 3 })
    expect(ssh).toHaveBeenCalledTimes(2)
    expect(String(ssh.mock.calls[1][2])).toContain("virt-win-reg --merge")
    expect(xenPvLogLine(r)).toEqual({ level: "success", msg: expect.stringContaining("(XenSvc, xenbus, xenfilt, xenvbd) and XENFILT removed from 3 device class filter list(s)") })
  })

  it("does not merge anything into a guest without VM Tools", async () => {
    ssh.mockResolvedValueOnce({ success: true, output: "XENPV-EXIT=0\n" })
    const r = await neutralizeXenPvDrivers(args)
    expect(r).toEqual({ changed: false, services: [], filters: 0 })
    expect(ssh).toHaveBeenCalledTimes(1)
    expect(xenPvLogLine(r).level).toBe("info")
  })

  it("returns the failure of an unreadable registry, never throws", async () => {
    ssh.mockResolvedValueOnce({ success: true, output: "XENPV-EXIT=1\n" })
    const r = await neutralizeXenPvDrivers(args)
    expect(r.changed).toBe(false)
    expect(r.error).toMatch(/could not be read/)
    expect(xenPvLogLine(r)).toEqual({ level: "warn", msg: expect.stringMatching(/0x0000DEAD.*uninstall the XenServer \/ XCP-ng VM Tools/) })
  })

  it("returns the failure of the merge with its last output line", async () => {
    ssh.mockResolvedValueOnce({ success: true, output: SCAN }).mockResolvedValueOnce({ success: true, output: "hivex: commit failed\n" })
    const r = await neutralizeXenPvDrivers(args)
    expect(r.changed).toBe(false)
    expect(r.error).toContain("hivex: commit failed")
  })

  it("makes a volume Windows left hibernated or unclean writable, then merges again", async () => {
    const ro = "virt-win-reg: /Windows/System32/config/SYSTEM: could not upload registry file: upload: /Windows/System32/config/SYSTEM: Read-only file system at /usr/bin/virt-win-reg line 596."
    ssh.mockResolvedValueOnce({ success: true, output: SCAN })
      .mockResolvedValueOnce({ success: false, output: ro })
      .mockResolvedValueOnce({ success: true, output: "XENPV-UNLOCK= hiberfile ntfsfix\nXENPV-PROBE=0\n" })
      .mockResolvedValueOnce({ success: true, output: "XENPV-MERGED\n" })
    const r = await neutralizeXenPvDrivers(args)
    expect(r).toMatchObject({ changed: true, unlocked: ["hiberfile", "ntfsfix"] })
    expect(String(ssh.mock.calls[2][2])).toContain("ntfs-3g-probe")
    expect(xenPvLogLine(r)).toEqual({ level: "warn", msg: expect.stringMatching(/not cleanly shut down.*checks the disk at first boot/) })
  })

  it("gives up when the volume stays read-only, without a second merge", async () => {
    ssh.mockResolvedValueOnce({ success: true, output: SCAN })
      .mockResolvedValueOnce({ success: false, output: "upload: Read-only file system" })
      .mockResolvedValueOnce({ success: true, output: "XENPV-UNLOCK= hiberfile ntfsfix\nXENPV-PROBE=14\n" })
    const r = await neutralizeXenPvDrivers(args)
    expect(r.changed).toBe(false)
    expect(r.error).toMatch(/Read-only file system/)
    expect(ssh).toHaveBeenCalledTimes(3)
    expect(xenPvLogLine(r).msg).toMatch(/fast startup disabled/)
  })

  it("turns an SSH exception into a returned error", async () => {
    ssh.mockRejectedValueOnce(new Error("orchestrator connection lost"))
    expect((await neutralizeXenPvDrivers(args)).error).toBe("orchestrator connection lost")
  })
})
