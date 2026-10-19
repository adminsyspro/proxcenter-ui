import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/ssh/exec", async (importActual) => ({ ...(await importActual<typeof import("@/lib/ssh/exec")>()), executeSSH: vi.fn() }))

import { executeSSH } from "@/lib/ssh/exec"
import {
  buildConversionScript, buildConversionXml, conversionDir, conversionPreflightCommand, convertGuestAtCutover,
  describeWindowsStaticIps, missingConversionPrereqs, parseConversionOutcome, windowsStaticIpArgs, GUEST_CONVERSION_ESTIMATE_SEC,
} from "./guest-conversion"

const msg = (type: string, message: string) => JSON.stringify({ message, timestamp: "2026-10-19T08:35:37+02:00", type })

// Real machine-readable lines of the lab runs (virt-v2v-in-place 2.6.0, 19/10/2026).
const rockyOk = [
  msg("message", "Opening the source"),
  msg("message", "Inspecting the source"),
  msg("message", "Converting Rocky Linux 9.8 (Blue Onyx) (rocky9) to run on KVM"),
  msg("info", "This guest has virtio drivers installed."),
  msg("info", "This guest requires UEFI on the target to boot."),
  msg("message", "Finishing off"),
].join("\n")

const win2025 = [
  msg("message", "Converting Windows Server 2025 Standard Evaluation (win2k25) to run on KVM"),
  msg("warning", "Balloon Server (blnsvr.exe) not found on tools ISO/directory. You may want to install this component manually after conversion."),
  msg("warning", "there are no virtio drivers available for this version of Windows (10.0 x86_64 Server win2k25).  virt-v2v looks for drivers in /usr/share/virtio-win/virtio-win.iso\n\nThe guest will be configured to use slower emulated devices."),
  msg("info", "This guest does not have virtio drivers installed."),
].join("\n")

describe("parseConversionOutcome", () => {
  it("accepts a conversion that installed the VirtIO drivers, and names the guest", () => {
    expect(parseConversionOutcome(rockyOk, 0)).toEqual({ ok: true, os: "Rocky Linux 9.8 (Blue Onyx)", warnings: [] })
  })

  it("refuses an exit code 0 without drivers: virt-v2v 2.6.0 does not know Windows Server 2025", () => {
    const out = parseConversionOutcome(win2025, 0)
    expect(out.ok).toBe(false)
    expect(out.os).toBe("Windows Server 2025 Standard Evaluation")
    expect(out.reason).toMatch(/^there are no virtio drivers available for this version of Windows \(10\.0 x86_64 Server win2k25\)/)
    expect(out.warnings).toHaveLength(2)
  })

  it("refuses a guest that reports no drivers without saying why", () => {
    expect(parseConversionOutcome(msg("info", "This guest does not have virtio drivers installed."), 0).reason)
      .toBe("virt-v2v could not install the VirtIO drivers in this guest")
  })

  it("refuses an exit code 0 that says nothing about drivers", () => {
    expect(parseConversionOutcome(msg("message", "Finishing off"), 0)).toMatchObject({ ok: false, reason: "virt-v2v-in-place did not report VirtIO drivers in the guest" })
  })

  it("takes the reason of a failed run from its last error", () => {
    const log = [msg("message", "Inspecting the source"), msg("error", "inspection could not detect the source guest (or physical machine).")].join("\n")
    expect(parseConversionOutcome(log, 1).reason).toBe("inspection could not detect the source guest (or physical machine).")
  })

  it("falls back to the plain stderr line, without the program prefix", () => {
    expect(parseConversionOutcome("{ truncated\nvirt-v2v-in-place: error: exception: End_of_file", 1).reason).toBe("exception: End_of_file")
    expect(parseConversionOutcome("", 3).reason).toBe("virt-v2v-in-place exited with code 3")
  })

  it("names the overlay failure and an unfinished run", () => {
    expect(parseConversionOutcome("", 90).reason).toBe("the conversion overlay could not be created on the node")
    expect(parseConversionOutcome("", null).reason).toBe("virt-v2v-in-place did not finish")
  })

  it("keeps a long reason readable", () => {
    const reason = parseConversionOutcome(msg("error", `boom ${"x".repeat(400)}`), 1).reason!
    expect(reason).toHaveLength(300)
    expect(reason.endsWith("...")).toBe(true)
  })
})

describe("buildConversionXml", () => {
  it("declares UEFI and one SCSI disk per overlay, in order", () => {
    const xml = buildConversionXml({ name: "r9 & co", firmware: "efi", overlays: ["/tmp/d/disk0.qcow2", "/tmp/d/disk1.qcow2"], memoryMB: 4096 })
    expect(xml).toContain('<os firmware="efi">')
    expect(xml).toContain("<name>r9 &amp; co</name>")
    expect(xml).toContain('<memory unit="MiB">4096</memory>')
    expect(xml.indexOf("disk0.qcow2")).toBeLessThan(xml.indexOf("disk1.qcow2"))
    expect(xml).toContain('<target dev="sdb" bus="scsi"/>')
    expect(xml).toContain('<driver name="qemu" type="qcow2"/>')
  })

  it("leaves the firmware to BIOS and never asks for less than 256 MiB", () => {
    const xml = buildConversionXml({ name: "", firmware: "bios", overlays: ["/o"], memoryMB: 64 })
    expect(xml).toContain("<os><type")
    expect(xml).toContain("<name>guest</name>")
    expect(xml).toContain('<memory unit="MiB">256</memory>')
  })
})

describe("buildConversionScript", () => {
  it("overlays every device, converts with virtio-scsi and stdin closed, and records the exit code", () => {
    const script = buildConversionScript("job-1", ["/dev/rbd3", "/dev/pve/vm-1-disk-1"], "<domain/>")
    expect(script).toContain("D='/tmp/proxcenter-convert-job-1'")
    expect(script).toContain("qemu-img create -q -f qcow2 -b '/dev/rbd3' -F raw \"$D/disk0.qcow2\"")
    expect(script).toContain("-b '/dev/pve/vm-1-disk-1' -F raw \"$D/disk1.qcow2\"")
    expect(script).toContain("echo 90 > \"$D/exit\"")
    expect(script).toMatch(/virt-v2v-in-place -i libvirtxml "\$D\/guest\.xml" --block-driver virtio-scsi --machine-readable < \/dev\/null/)
    expect(script.trim().endsWith('echo $? > "$D/exit"')).toBe(true)
    // The domain XML travels base64-encoded, so no quoting can break it.
    expect(script).toContain(Buffer.from("<domain/>").toString("base64"))
  })

  it("pins the interface names inside the overlays before virt-v2v, without stopping the run on failure (#1000 follow-up)", () => {
    const script = buildConversionScript("job-1", ["/dev/rbd3", "/dev/rbd4"], "<domain/>", "#!/bin/sh\necho pinned\n")
    const lines = script.split("\n")
    const pin = lines.findIndex(l => l.startsWith("LIBGUESTFS_BACKEND=direct guestfish"))
    const v2v = lines.findIndex(l => l.includes("virt-v2v-in-place"))
    expect(pin).toBeGreaterThan(lines.findIndex(l => l.includes("disk1.qcow2")))
    expect(pin).toBeLessThan(v2v)
    expect(lines[pin]).toContain('--format=qcow2 -a "$D/disk0.qcow2" -a "$D/disk1.qcow2" -i')
    expect(lines[pin]).toContain('sh "/bin/sh /root/.proxcenter-netpin.sh" : download /root/.proxcenter-netpin.txt "$D/netpin.txt"')
    expect(lines[pin]).not.toMatch(/\|\||&&|exit/)
    expect(script).toContain(Buffer.from("#!/bin/sh\necho pinned\n").toString("base64"))
    expect(buildConversionScript("job-1", ["/dev/rbd3"], "<domain/>")).not.toContain("guestfish")
  })

  it("passes extra virt-v2v arguments quoted, before the machine-readable flag", () => {
    const script = buildConversionScript("job-1", ["/dev/rbd3"], "<domain/>", undefined, ["--mac", "00:50:56:9c:a1:f0:ip:10.42.0.239,10.42.0.1,24,1.1.1.1"])
    expect(script).toContain("--block-driver virtio-scsi '--mac' '00:50:56:9c:a1:f0:ip:10.42.0.239,10.42.0.1,24,1.1.1.1' --machine-readable")
  })

  it("keeps the job id out of the shell", () => {
    expect(conversionDir("a;b$(c)")).toBe("/tmp/proxcenter-convert-abc")
  })
})

describe("conversion prerequisites", () => {
  it("probes the three prerequisites without failing the command", () => {
    const cmd = conversionPreflightCommand()
    expect(cmd).toContain("test -x /usr/bin/virt-v2v-in-place")
    expect(cmd).toContain("/usr/share/virtio-win/virtio-win.iso")
    expect(cmd.trim().endsWith("true")).toBe(true)
  })

  it("only asks Windows for the VirtIO drivers and the first-boot helper", () => {
    expect(missingConversionPrereqs("v2v-in-place", false)).toEqual([])
    expect(missingConversionPrereqs("", false)).toEqual(["virt-v2v-in-place (package virt-v2v)"])
    expect(missingConversionPrereqs("v2v-in-place\n", true)).toEqual([
      "the VirtIO drivers for Windows (/usr/share/virtio-win/virtio-win.iso)",
      "rhsrvany.exe (Windows first-boot helper)",
    ])
    expect(missingConversionPrereqs("v2v-in-place virtio-win srvany", true)).toEqual([])
  })
})

describe("convertGuestAtCutover", () => {
  const ssh = vi.mocked(executeSSH)
  const ok = (output = "") => ({ success: true, output })
  const log = vi.fn(async () => {})
  const base = {
    jobId: "j1", connectionId: "c1", nodeIp: "10.0.0.1", name: "r9", firmware: "efi" as const, isWindows: false,
    devices: ["/dev/rbd3"], log, isCancelled: () => false, pollMs: 1,
  }
  const commands = () => ssh.mock.calls.map(c => String(c[2]))

  /** Answer the node like the lab did: prerequisites, launch, exit file, log, commits. */
  function node(opts: { prereqs?: string; launch?: string; exit?: string[]; log?: string; commit?: boolean } = {}) {
    const exits = [...(opts.exit ?? ["RUNNING", "0"])]
    ssh.mockImplementation(async (_c: string, _n: any, cmd: string) => {
      if (cmd.startsWith("test -x")) return ok(opts.prereqs ?? "v2v-in-place\nvirtio-win\nsrvany\n")
      if (cmd.startsWith("nohup bash")) return ok(opts.launch ?? "4242\n")
      if (cmd.startsWith("cat ") && cmd.includes("/exit")) return ok(exits.length > 1 ? exits.shift()! : exits[0])
      if (cmd.startsWith("cat ") && cmd.includes("v2v.log")) return ok(opts.log ?? rockyOk)
      if (cmd.startsWith("qemu-img commit")) return opts.commit === false ? { success: false, output: "", error: "No space left" } : ok()
      return ok()
    })
  }

  beforeEach(() => {
    ssh.mockReset()
    log.mockClear()
  })

  it("commits the overlays of a successful conversion, then cleans up", async () => {
    node()
    const r = await convertGuestAtCutover(base)
    expect(r).toMatchObject({ converted: true, os: "Rocky Linux 9.8 (Blue Onyx)" })
    expect(commands()).toContain("qemu-img commit -q '/tmp/proxcenter-convert-j1/disk0.qcow2'")
    expect(commands().at(-1)).toBe("rm -rf '/tmp/proxcenter-convert-j1'")
    // The process ended on its own: nothing to kill.
    expect(commands().some(c => c.startsWith("pkill"))).toBe(false)
  })

  it("never commits a conversion that installed no drivers", async () => {
    node({ log: win2025 })
    const r = await convertGuestAtCutover({ ...base, isWindows: true })
    expect(r.converted).toBe(false)
    expect(r.reason).toMatch(/no virtio drivers available/)
    expect(commands().some(c => c.startsWith("qemu-img commit"))).toBe(false)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Guest conversion: virt-v2v warning: Balloon Server/), "warn")
    // the warning that is the reason is not logged twice
    expect(log.mock.calls.filter(c => /no virtio drivers available/.test(String(c[0])))).toHaveLength(0)
  })

  it("stops before anything runs when the node lacks a prerequisite", async () => {
    node({ prereqs: "v2v-in-place" })
    const r = await convertGuestAtCutover({ ...base, isWindows: true })
    expect(r).toEqual({ converted: false, reason: "missing on the node: the VirtIO drivers for Windows (/usr/share/virtio-win/virtio-win.iso), rhsrvany.exe (Windows first-boot helper)" })
    expect(commands().some(c => c.startsWith("nohup"))).toBe(false)
  })

  it("refuses a volume without a device", async () => {
    node()
    expect((await convertGuestAtCutover({ ...base, devices: ["/dev/rbd3", ""] })).reason).toBe("a target volume has no block device on the node")
  })

  it("reports a launch that returned no process id", async () => {
    node({ launch: "" })
    expect((await convertGuestAtCutover(base)).reason).toBe("virt-v2v-in-place could not be started: no process id")
  })

  it("gives up after the timeout and stops the conversion", async () => {
    node({ exit: ["RUNNING"] })
    const r = await convertGuestAtCutover({ ...base, timeoutMs: 5 })
    expect(r.converted).toBe(false)
    expect(r.reason).toMatch(/did not finish within/)
    expect(commands()).toContain("pkill -TERM -P 4242; kill 4242")
  })

  it("rethrows a cancellation after stopping the conversion", async () => {
    node({ exit: ["RUNNING"] })
    await expect(convertGuestAtCutover({ ...base, isCancelled: () => true })).rejects.toThrow("Migration cancelled")
    expect(commands()).toContain("pkill -TERM -P 4242; kill 4242")
    expect(commands().at(-1)).toBe("rm -rf '/tmp/proxcenter-convert-j1'")
  })

  it("says which disks were already written when a commit fails", async () => {
    node({ commit: false })
    const r = await convertGuestAtCutover({ ...base, devices: ["/dev/rbd3"] })
    expect(r.reason).toBe("the converted disk 1 could not be written back (No space left)")
  })

  it("turns an SSH failure into a reason rather than an exception", async () => {
    ssh.mockRejectedValue(new Error("Keepalive timeout"))
    expect(await convertGuestAtCutover(base)).toEqual({ converted: false, reason: "Keepalive timeout" })
  })

  it("pins a Linux guest's interfaces and logs it once the conversion is committed (#1000 follow-up)", async () => {
    node()
    const read = ssh.getMockImplementation()!
    ssh.mockImplementation(async (c: string, n: any, cmd: string) =>
      cmd.startsWith("cat ") && cmd.includes("netpin.txt") ? ok("pinned ens33 00:50:56:9c:c0:8f\n") : read(c, n, cmd))
    const r = await convertGuestAtCutover({ ...base, nics: [{ mac: "00:50:56:9c:c0:8f", names: ["ens33"] }] })
    expect(r.converted).toBe(true)
    expect(commands().find(c => c.startsWith("nohup"))).toContain("guestfish")
    expect(r.network).toEqual([{ msg: expect.stringMatching(/^Guest network: ens33 \(00:50:56:9c:c0:8f\) keeps the name/), level: "success" }])
  })

  it("says so when the pinning left no report", async () => {
    node()
    const read = ssh.getMockImplementation()!
    ssh.mockImplementation(async (c: string, n: any, cmd: string) =>
      cmd.startsWith("cat ") && cmd.includes("netpin.txt") ? ok("FAILED\nguestfish: no operating system was found") : read(c, n, cmd))
    const r = await convertGuestAtCutover({ ...base, nics: [{ mac: "00:50:56:9c:c0:8f", names: [] }] })
    expect(r.network).toEqual([{ msg: "Guest network: the interface names could not be pinned (guestfish: no operating system was found); check the network settings after the first boot", level: "warn" }])
  })

  it("never pins a Windows guest, nor logs anything about it when the conversion fails", async () => {
    node()
    await convertGuestAtCutover({ ...base, isWindows: true, nics: [{ mac: "00:50:56:9c:c0:8f", names: ["ens33"] }] })
    expect(commands().find(c => c.startsWith("nohup"))).not.toContain("guestfish")
    node({ log: win2025 })
    expect(await convertGuestAtCutover({ ...base, nics: [{ mac: "00:50:56:9c:c0:8f", names: ["ens33"] }] })).not.toHaveProperty("network")
  })

  it("sets a Windows guest's static IP again through virt-v2v, and says so once committed (#1000 follow-up)", async () => {
    node()
    const ip = { mac: "00:50:56:9c:a1:f0", address: "10.42.0.239", prefixLength: 24, gateway: "10.42.0.1", dns: ["1.1.1.1"], extraAddresses: 0 }
    const r = await convertGuestAtCutover({ ...base, isWindows: true, nics: [{ mac: "00:50:56:9c:a1:f0", names: [] }], staticIps: [ip] })
    const launch = commands().find(c => c.startsWith("nohup"))!
    expect(launch).not.toContain("guestfish")
    expect(launch).toContain("--mac")
    expect(r.network).toEqual([{ msg: "Guest network: the static IPv4 configuration of 00:50:56:9c:a1:f0 (10.42.0.239/24, gateway 10.42.0.1, DNS 1.1.1.1) is set again on the new adapter at the first boot", level: "success" }])
  })

  it("announces about a minute of downtime", () => {
    expect(GUEST_CONVERSION_ESTIMATE_SEC).toBe(60)
  })
})

describe("parseConversionOutcome: a Windows powered off hard (#1000, lab 19/10)", () => {
  it("says why and what to do instead of virt-v2v's raw message", () => {
    const log = JSON.stringify({ type: "error", message: "filesystem was mounted read-only, even though we asked for it to be mounted read-write. This usually means that the filesystem was not cleanly unmounted. Possible causes include trying to convert a guest which is running, or using Windows Hibernation or Fast Restart. Original error message: touch" })
    const out = parseConversionOutcome(log, 1)
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/^the Windows filesystem was not shut down cleanly .*Install the guest tools on the source \(VMware Tools, XCP-ng Windows PV tools\)/)
  })
})

describe("parseConversionOutcome: a guest named by its version only (#1000, lab 19/10)", () => {
  it("keeps the inspector's id when the name is a bare version", () => {
    const log = [msg("message", "Converting 13.7 (debian13) to run on KVM"), msg("info", "This guest has virtio drivers installed.")].join("\n")
    expect(parseConversionOutcome(log, 0).os).toBe("13.7 (debian13)")
  })
})

describe("Windows static IPv4 (#1000 follow-up)", () => {
  const ip = (mac: string, extra = 0, gateway?: string) => ({ mac, address: "10.0.0.5", prefixLength: 24, ...(gateway && { gateway }), dns: ["10.0.0.53", "1.1.1.1"], extraAddresses: extra })

  it("only sets the NICs the target keeps the MAC of, in virt-v2v's format", () => {
    expect(windowsStaticIpArgs([ip("00:50:56:AA:00:01", 0, "10.0.0.1"), ip("00:50:56:aa:00:02")], ["00:50:56:aa:00:01"]))
      .toEqual(["--mac", "00:50:56:aa:00:01:ip:10.0.0.5,10.0.0.1,24,10.0.0.53,1.1.1.1"])
    expect(windowsStaticIpArgs([ip("00:50:56:aa:00:02")], ["00:50:56:aa:00:02"])).toEqual(["--mac", "00:50:56:aa:00:02:ip:10.0.0.5,,24,10.0.0.53,1.1.1.1"])
  })

  it("warns when a NIC had more addresses than virt-v2v sets", () => {
    const lines = describeWindowsStaticIps([ip("00:50:56:aa:00:01", 2)], ["00:50:56:aa:00:01"])
    expect(lines.map(l => l.level)).toEqual(["success", "warn"])
    expect(lines[0].msg).toBe("Guest network: the static IPv4 configuration of 00:50:56:aa:00:01 (10.0.0.5/24, DNS 10.0.0.53 1.1.1.1) is set again on the new adapter at the first boot")
    expect(lines[1].msg).toContain("2 more static IPv4 address(es)")
    expect(describeWindowsStaticIps([ip("00:50:56:aa:00:01")], [])).toEqual([])
  })
})
