import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/ssh/exec", async (importActual) => ({ ...(await importActual<typeof import("@/lib/ssh/exec")>()), executeSSH: vi.fn() }))

import { executeSSH } from "@/lib/ssh/exec"
import {
  buildCommitScript, buildConversionScript, buildConversionXml, canKeepTrimsOut, conversionDir, conversionNotAppliedMessage, conversionPreflightCommand,
  convertGuestAtCutover, describeWindowsStaticIps, missingConversionPrereqs, nbdChainFunctions, parseConversionOutcome, virtV2vSupportOf, windowsStaticIpArgs,
  GUEST_CONVERSION_ESTIMATE_SEC,
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

  it("names the node's virt-v2v version as the cause, not the ISO (#1173)", () => {
    const out = parseConversionOutcome(win2025, 0, { version: "2.6.0", knows: [] })
    expect(out.ok).toBe(false)
    expect(out.reason).toMatch(/^virt-v2v 2\.6\.0 on this node does not support Windows Server 2025 \(support starts with virt-v2v 2\.7\.2\)/)
    expect(out.reason).not.toContain("virt-v2v looks for drivers")
    // a virt-v2v that knows Server 2025 and still finds nothing: the ISO is to blame
    expect(parseConversionOutcome(win2025, 0, { version: "2.6.0", knows: ["2k25"] }).reason).toMatch(/^there are no virtio drivers available/)
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

  it("names each disk's NBD device by a placeholder when the overlays go through NBD (#1169)", () => {
    const xml = buildConversionXml({ name: "r9", firmware: "bios", overlays: ["/tmp/d/disk0.qcow2", "/tmp/d/disk1.qcow2"], viaNbd: true })
    expect(xml).toContain('<disk type="block" device="disk"><driver name="qemu" type="raw"/><source dev="@NBD0@"/><target dev="sda" bus="scsi"/></disk>')
    expect(xml).toContain('<source dev="@NBD1@"/><target dev="sdb" bus="scsi"/>')
    expect(xml).not.toContain("qcow2")
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

  it("converts through NBD chains that drop trims, and takes them down before the exit code (#1169)", () => {
    const script = buildConversionScript("job-1", ["/dev/rbd3", "/dev/rbd4"], "<nbd/>", undefined, [], "<file/>")
    const lines = script.split("\n")
    const at = (re: RegExp) => lines.findIndex(l => re.test(l))
    expect(script).toContain(Buffer.from("<file/>").toString("base64") + "' | base64 -d > \"$D/guest-file.xml\"")
    expect(at(/^if nbd_chain_up 0 && nbd_chain_up 1; then$/)).toBeGreaterThan(at(/disk1\.qcow2" > "\$D\/overlay\.log"/))
    expect(script).toContain('  sed -i "s|@NBD1@|$(cat "$D/nbd1.dev")|" "$D/guest.xml"')
    // A chain that cannot come up: the direct overlays, said to the caller.
    expect(script).toContain('  nbd_chain_down; mv "$D/guest-file.xml" "$D/guest.xml"; echo fallback > "$D/nbd-fallback"')
    expect(at(/^RC=\$\?$/)).toBe(at(/virt-v2v-in-place/) + 1)
    expect(lines.slice(-2)).toEqual(["nbd_chain_down", 'echo $RC > "$D/exit"'])
  })

  it("keeps the job id out of the shell", () => {
    expect(conversionDir("a;b$(c)")).toBe("/tmp/proxcenter-convert-abc")
  })
})

describe("NBD chains and commit (#1169)", () => {
  const fns = nbdChainFunctions()

  it("exposes an overlay through qemu-nbd without discard, behind nbdkit's nozero filter, on the first free device", () => {
    expect(fns).toContain('qemu-nbd --fork --persistent --discard=ignore -f qcow2 -k "$D/q$1.sock" --pid-file="$D/q$1.pid" "$D/disk$1.qcow2"')
    expect(fns).toContain('nbdkit -P "$D/k$1.pid" -U "$D/k$1.sock" --filter=nozero nbd socket="$D/q$1.sock" zeromode=none')
    expect(fns).toContain("[ -s /sys/block/nbd$j/pid ] && continue")
    expect(fns).toContain('echo /dev/nbd$j > "$D/nbd$1.dev"; return 0')
  })

  it("only detaches the devices it recorded, releases their holders first, and waits for nbdkit then qemu-nbd", () => {
    const down = fns.slice(fns.indexOf("nbd_chain_down() {"))
    expect(down.indexOf('nbd_release_holders "$n"')).toBeLessThan(down.indexOf('nbd-client -d "$n"'))
    expect(down).toContain('for p in "$D"/k*.pid "$D"/q*.pid; do')
    expect(down).toContain('while kill -0 "$pid" 2>/dev/null && [ $t -lt 100 ]')
    expect(fns).toContain("nbd_release_holders() {")
  })

  it("commits the overlays in order and says which one failed", () => {
    expect(buildCommitScript("j1", 2).split("\n")).toEqual([
      "D='/tmp/proxcenter-convert-j1'",
      ': > "$D/commit.log"',
      `qemu-img commit -q "$D/disk0.qcow2" >> "$D/commit.log" 2>&1 || { echo 'failed 0' > "$D/commit-exit"; exit 0; }`,
      `qemu-img commit -q "$D/disk1.qcow2" >> "$D/commit.log" 2>&1 || { echo 'failed 1' > "$D/commit-exit"; exit 0; }`,
      'echo ok > "$D/commit-exit"',
    ])
  })
})

describe("conversionNotAppliedMessage", () => {
  it("says the copy is unchanged when no commit ran", () => {
    expect(conversionNotAppliedMessage({ converted: false, reason: "no drivers." })).toEqual({
      msg: "Guest conversion not applied: no drivers. The copied disks are unchanged and the guest keeps the hardware it boots on without new drivers (SATA disks and e1000 NICs for Windows, a SATA boot disk for UEFI guests)",
      level: "warn",
    })
  })

  it("never says so after a commit that did not finish (#1169)", () => {
    const m = conversionNotAppliedMessage({ converted: false, volumesWritten: true, reason: "the converted disk 1 could not be written back (EIO)" })
    expect(m.level).toBe("error")
    expect(m.msg).toBe("Guest conversion failed while writing the converted disks back: the converted disk 1 could not be written back (EIO). A disk may be partly converted: the guest is started on the hardware it boots on without new drivers (SATA disks and e1000 NICs for Windows, a SATA boot disk for UEFI guests), check that it boots")
  })
})

describe("conversion prerequisites", () => {
  it("probes the three prerequisites without failing the command", () => {
    const cmd = conversionPreflightCommand()
    expect(cmd).toContain("test -x /usr/bin/virt-v2v-in-place")
    expect(cmd).toContain("/usr/share/virtio-win/virtio-win.iso")
    expect(cmd.trim().endsWith("true")).toBe(true)
  })

  it("probes the NBD chain apart: it is not a prerequisite (#1169)", () => {
    expect(conversionPreflightCommand()).toContain("nbdkit --filter=nozero nbd --version >/dev/null 2>&1 && echo nbd-chain")
    expect(canKeepTrimsOut("v2v-in-place\nnbd-chain\n")).toBe(true)
    expect(canKeepTrimsOut("v2v-in-place")).toBe(false)
    expect(missingConversionPrereqs("v2v-in-place", false)).toEqual([])
  })

  it("reads the virt-v2v version and the Windows releases its binary knows (#1173)", () => {
    expect(conversionPreflightCommand()).toContain(`v=$(virt-v2v-in-place --version 2>/dev/null | awk '{print $2; exit}'); test -n "$v" && echo "v2v-version=$v"`)
    expect(conversionPreflightCommand()).toContain(`for m in 2k25; do grep -aqF "$m" /usr/bin/virt-v2v-in-place && echo "v2v-knows=$m"; done`)
    expect(virtV2vSupportOf("v2v-in-place\nvirtio-win\nv2v-version=2.6.0\nv2v-probed\n")).toEqual({ version: "2.6.0", knows: [] })
    expect(virtV2vSupportOf("v2v-in-place\nv2v-version=2.6.0\nv2v-probed\nv2v-knows=2k25\n")).toEqual({ version: "2.6.0", knows: ["2k25"] })
    expect(virtV2vSupportOf("")).toEqual({})
    expect(missingConversionPrereqs("v2v-in-place virtio-win srvany v2v-version=2.6.0 v2v-probed", true)).toEqual([])
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

  const launches = () => commands().filter(c => c.startsWith("nohup bash"))

  /** Answer the node like the lab did: prerequisites, launches, exit files, log. */
  function node(opts: { prereqs?: string; launch?: string; exit?: string[]; log?: string; commit?: string[]; fallback?: boolean } = {}) {
    const exits = [...(opts.exit ?? ["RUNNING", "0"])]
    const commits = [...(opts.commit ?? ["RUNNING", "ok"])]
    const next = (list: string[]) => list.length > 1 ? list.shift()! : list[0]
    ssh.mockImplementation(async (_c: string, _n: any, cmd: string) => {
      if (cmd.startsWith("test -x")) return ok(opts.prereqs ?? "v2v-in-place\nvirtio-win\nsrvany\n")
      if (cmd.startsWith("nohup bash")) return ok(opts.launch ?? "4242\n")
      if (cmd.startsWith("cat ") && cmd.includes("/exit")) return ok(next(exits))
      if (cmd.startsWith("cat ") && cmd.includes("/commit-exit")) return ok(next(commits))
      if (cmd.startsWith("cat ") && cmd.includes("/nbd-fallback")) return ok(opts.fallback ? "fallback\n" : "RUNNING")
      if (cmd.startsWith("cat ") && cmd.includes("v2v.log")) return ok(opts.log ?? rockyOk)
      if (cmd.startsWith("tail ") && cmd.includes("commit.log")) return ok("qemu-img: Could not write: No space left on device\n")
      return ok()
    })
  }

  beforeEach(() => {
    ssh.mockReset()
    log.mockClear()
  })

  it("does not run virt-v2v on a Windows release it does not know (#1173)", async () => {
    node({ prereqs: "v2v-in-place\nvirtio-win\nsrvany\nv2v-version=2.6.0\nv2v-probed\n" })
    const r = await convertGuestAtCutover({ ...base, isWindows: true, guestOs: "Microsoft Windows Server 2025 (64-bit)" })
    expect(r.converted).toBe(false)
    expect(r.reason).toMatch(/^virt-v2v 2\.6\.0 on this node does not support Windows Server 2025/)
    expect(launches()).toHaveLength(0)
  })

  it("runs it when the node's virt-v2v knows the release, or on a Linux guest", async () => {
    node({ prereqs: "v2v-in-place\nvirtio-win\nsrvany\nv2v-version=2.6.0\nv2v-probed\nv2v-knows=2k25\n" })
    expect((await convertGuestAtCutover({ ...base, isWindows: true, guestOs: "Microsoft Windows Server 2025 (64-bit)" })).converted).toBe(true)
    node({ prereqs: "v2v-in-place\nv2v-version=2.6.0\nv2v-probed\n" })
    expect((await convertGuestAtCutover({ ...base, guestOs: "Microsoft Windows Server 2025 (64-bit)" })).converted).toBe(true)
  })

  it("names the version when virt-v2v reveals the release itself, a source declared as another Windows (#1173)", async () => {
    node({ prereqs: "v2v-in-place\nvirtio-win\nsrvany\nv2v-version=2.6.0\nv2v-probed\n", log: win2025 })
    const r = await convertGuestAtCutover({ ...base, isWindows: true, guestOs: "Microsoft Windows Server 2022 (64-bit)" })
    expect(r.reason).toMatch(/^virt-v2v 2\.6\.0 on this node does not support Windows Server 2025/)
    expect(launches()).toHaveLength(1)
  })

  it("commits the overlays of a successful conversion, then cleans up", async () => {
    node()
    const r = await convertGuestAtCutover(base)
    expect(r).toMatchObject({ converted: true, os: "Rocky Linux 9.8 (Blue Onyx)" })
    // The commit runs detached, polled like the conversion (#1169).
    expect(launches()).toHaveLength(2)
    expect(launches()[1]).toContain('qemu-img commit -q "$D/disk0.qcow2"')
    expect(commands().filter(c => c.startsWith("cat ") && c.includes("/commit-exit"))).toHaveLength(2)
    expect(commands().at(-1)).toBe("rm -rf '/tmp/proxcenter-convert-j1'")
    // Both processes ended on their own: nothing to kill, no chain to take down.
    expect(commands().some(c => c.startsWith("pkill") || c.includes("nbd_chain_down"))).toBe(false)
  })

  it("converts through the NBD chains when the node has them, and takes them down at the end (#1169)", async () => {
    node({ prereqs: "v2v-in-place\nnbd-chain\n" })
    const r = await convertGuestAtCutover(base)
    expect(r.converted).toBe(true)
    const conversion = launches()[0]
    expect(conversion).toContain("nbd_chain_up 0")
    expect(conversion).toContain(Buffer.from(buildConversionXml({ name: "r9", firmware: "efi", overlays: ["/tmp/proxcenter-convert-j1/disk0.qcow2"], viaNbd: true })).toString("base64"))
    expect(conversion).toContain(Buffer.from(buildConversionXml({ name: "r9", firmware: "efi", overlays: ["/tmp/proxcenter-convert-j1/disk0.qcow2"] })).toString("base64"))
    const down = commands().findIndex(c => c.endsWith("\nnbd_chain_down"))
    expect(down).toBeGreaterThan(-1)
    expect(commands()[down].startsWith("D='/tmp/proxcenter-convert-j1'\n")).toBe(true)
    expect(down).toBeLessThan(commands().indexOf("rm -rf '/tmp/proxcenter-convert-j1'"))
    expect(log.mock.calls.some(c => /could not be attached through NBD/.test(String(c[0])))).toBe(false)
  })

  it("says the write-back may be long when the chains fell back to the direct overlays (#1169)", async () => {
    node({ prereqs: "v2v-in-place\nnbd-chain\n", fallback: true })
    expect((await convertGuestAtCutover(base)).converted).toBe(true)
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/^Guest conversion: the overlays could not be attached through NBD/), "warn")
  })

  it("waits for a long commit, saying so every five minutes, before the guest may start (#1169)", async () => {
    let now = 0
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 60_000))
    try {
      node({ commit: [...Array(8).fill("RUNNING"), "ok"] })
      const r = await convertGuestAtCutover(base)
      expect(r.converted).toBe(true)
      const notices = log.mock.calls.map(c => String(c[0])).filter(m => m.startsWith("Guest conversion: still writing"))
      expect(notices[0]).toMatch(/^Guest conversion: still writing the converted disks back \(\d+ min\); the guest starts once it is done$/)
      expect(notices.length).toBeGreaterThanOrEqual(1)
      expect(commands().some(c => c.startsWith("pkill"))).toBe(false)
    } finally {
      clock.mockRestore()
    }
  })

  it("stops a commit on cancellation", async () => {
    let calls = 0
    node({ commit: ["RUNNING"] })
    const cancelled = () => commands().some(c => c.includes("/commit-exit")) && ++calls > 1
    await expect(convertGuestAtCutover({ ...base, isCancelled: cancelled })).rejects.toThrow("Migration cancelled")
    expect(commands()).toContain("pkill -TERM -P 4242; kill 4242")
  })

  it("reports a commit that could not be started, before anything is written", async () => {
    node()
    const read = ssh.getMockImplementation()!
    let n = 0
    ssh.mockImplementation(async (c: string, nd: any, cmd: string) =>
      cmd.startsWith("nohup bash") && ++n === 2 ? { success: false, output: "", error: "Connection reset" } : read(c, nd, cmd))
    expect(await convertGuestAtCutover(base)).toEqual({ converted: false, reason: "the converted disks could not be written back: Connection reset" })
  })

  it("marks the volumes written when something breaks during the commit", async () => {
    node({ commit: ["RUNNING"] })
    let now = 0
    const clock = vi.spyOn(Date, "now").mockImplementation(() => (now += 10 * 60_000))
    log.mockImplementation(async (m: string) => { if (m.startsWith("Guest conversion: still writing")) throw new Error("database gone") })
    try {
      expect(await convertGuestAtCutover(base)).toEqual({ converted: false, reason: "database gone", volumesWritten: true })
    } finally {
      clock.mockRestore()
      log.mockImplementation(async () => {})
    }
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

  it("says which disks were already written when a commit fails, and that the volumes were written", async () => {
    node({ commit: ["failed 0"] })
    expect(await convertGuestAtCutover(base)).toEqual({
      converted: false, volumesWritten: true,
      reason: "the converted disk 1 could not be written back (qemu-img: Could not write: No space left on device)",
    })
    node({ commit: ["failed 1"] })
    expect((await convertGuestAtCutover({ ...base, devices: ["/dev/rbd3", "/dev/rbd4"] })).reason)
      .toBe("the converted disk 2 could not be written back (qemu-img: Could not write: No space left on device); disks 1 to 1 were already converted")
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
