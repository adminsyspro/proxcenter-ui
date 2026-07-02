import { describe, it, expect, vi, beforeEach } from "vitest"
import { buildNbdConnectCmd, buildReaderTeardownCmd, startVddkReader, stopVddkReader } from "./vddk-reader"
import type { VddkOpts } from "./vddk-cmd"

// Mock only executeSSH; keep the real shellEscape (vddk-cmd uses it transitively).
vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() }
})
import { executeSSH } from "@/lib/ssh/exec"
const mockSSH = executeSSH as unknown as ReturnType<typeof vi.fn>

const OPTS: VddkOpts = {
  sock: "/tmp/v.sock", libdir: "/opt/vddk", server: "10.0.0.9", user: "root",
  passwordFile: "/tmp/pw", thumbprint: "AB:CD", moref: "vm-9", diskPath: "[ds] vm/vm.vmdk",
}

describe("pure builders", () => {
  it("attaches the socket to the first FREE nbd device and echoes the choice", () => {
    const c = buildNbdConnectCmd("/tmp/v.sock")
    // Iterate the kernel NBD devices and skip any whose client is live (its pid
    // file is non-empty) — a device left allocated by a previous failed/aborted
    // attempt keeps its pid file, so it is skipped instead of blocking the retry
    // with "nbd0 already in use" (#521).
    expect(c).toContain("for i in 0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15")
    expect(c).toContain("[ -s /sys/block/nbd$i/pid ] && continue")
    // Attach to the candidate device and, on success, report which one we took.
    expect(c).toContain("nbd-client -unix /tmp/v.sock /dev/nbd$i")
    expect(c).toContain('echo "NBD_DEV=$ATTACHED"')
    // No fixed per-disk device is hardcoded any more (that was the collision cause).
    expect(c).not.toContain("/dev/nbd3")
    // Never detach inside the allocation loop: on a lost race the candidate is
    // owned by another concurrent migration, and `nbd-client -d` would disconnect
    // its live reader. A failed attach must simply fall through to the next device.
    expect(c).not.toContain("nbd-client -d")
  })
  it("tears down device, nbdkit, socket, password file", () => {
    const c = buildReaderTeardownCmd({ nbdDev: "/dev/nbd3", sock: "/tmp/v.sock", pwFile: "/tmp/pw" })
    expect(c).toContain("nbd-client -d /dev/nbd3")
    expect(c).toContain("/tmp/v.sock")
    expect(c).toContain("/tmp/pw")
    // Guard against the pkill self-match: the pattern must be "[n]bdkit", not
    // "nbdkit", otherwise pkill -f matches this teardown command's own shell
    // (its argv carries the pattern) and SIGTERMs it (exit 143, rm cleanup unrun).
    expect(c).toContain('pkill -f "[n]bdkit.*/tmp/v.sock"')
  })
  it("also removes the log file when present in the handle", () => {
    const c = buildReaderTeardownCmd({ nbdDev: "/dev/nbd3", sock: "/tmp/v.sock", pwFile: "/tmp/pw", logFile: "/tmp/v.log" })
    expect(c).toContain("/tmp/v.log")
  })
  it("omits the device detach when no device was allocated (attach failed before a device was chosen)", () => {
    const c = buildReaderTeardownCmd({ nbdDev: "", sock: "/tmp/v.sock", pwFile: "/tmp/pw" })
    // With no owned device there is nothing to detach; a bare `nbd-client -d`
    // would error and, worse, could target an unintended device.
    expect(c).not.toContain("nbd-client -d")
    // nbdkit and temp files are still cleaned up.
    expect(c).toContain('pkill -f "[n]bdkit.*/tmp/v.sock"')
    expect(c).toContain("rm -f /tmp/v.sock /tmp/pw")
  })
})

describe("startVddkReader", () => {
  beforeEach(() => mockSSH.mockReset())

  it("writes the password file, launches nbdkit, waits for the socket, attaches a free device", async () => {
    // call 0: pw-write + launch ; call 1: socket missing ; call 2: socket EXISTS ; call 3: nbd-client attach (reports the chosen device)
    mockSSH
      .mockResolvedValueOnce({ success: true, output: "12345" })
      .mockResolvedValueOnce({ success: true, output: "" })
      .mockResolvedValueOnce({ success: true, output: "EXISTS" })
      .mockResolvedValueOnce({ success: true, output: "NBD_DEV=/dev/nbd0" })

    const handle = await startVddkReader("conn", "10.99.99.201", OPTS, "s3cr3t", { intervalMs: 0, maxAttempts: 5 })

    // The device is whatever the node reported free, not a caller-chosen index.
    expect(handle.nbdDev).toBe("/dev/nbd0")
    expect(handle.sock).toBe("/tmp/v.sock")
    expect(handle.pwFile).toBe("/tmp/pw")
    // The launch call writes the password (no trailing newline) and backgrounds nbdkit to a log file.
    const launchCmd = mockSSH.mock.calls[0][2] as string
    expect(launchCmd).toContain("printf '%s'")
    expect(launchCmd).toContain("nohup nbdkit -r -U '/tmp/v.sock' vddk")
    expect(launchCmd).not.toContain("\ns3cr3t\n") // password not heredoc'd raw
    // The device-attach call uses the free-device connect builder.
    const connectCmd = mockSSH.mock.calls[3][2] as string
    expect(connectCmd).toContain("nbd-client -unix /tmp/v.sock /dev/nbd$i")
  })

  it("returns the actual device the node picked (not a fixed index)", async () => {
    mockSSH.mockImplementation(async (...args: unknown[]) => {
      const cmd = String(args[2] ?? "")
      if (cmd.includes("test -S")) return { success: true, output: "EXISTS" }
      if (cmd.includes("nbd-client -unix")) return { success: true, output: "NBD_DEV=/dev/nbd7" }
      return { success: true, output: "12345" }
    })
    const handle = await startVddkReader("conn", "10.99.99.201", OPTS, "pw", { intervalMs: 0, maxAttempts: 3 })
    expect(handle.nbdDev).toBe("/dev/nbd7")
  })

  it("throws with the nbdkit log when the socket never appears", async () => {
    // socket never EXISTS; on timeout the log fetch surfaces the real VDDK error
    mockSSH.mockImplementation(async (...args: unknown[]) => {
      const cmd = String(args[2] ?? "")
      if (cmd.includes("test -S")) return { success: true, output: "" }
      if (cmd.includes("cat ")) return { success: true, output: "nbdkit: vddk: Login failed: bad thumbprint" }
      return { success: true, output: "12345" }
    })

    await expect(
      startVddkReader("conn", "10.99.99.201", OPTS, "pw", { intervalMs: 0, maxAttempts: 3 }),
    ).rejects.toThrow(/bad thumbprint|nbdkit/i)
  })

  it("throws when no free device could be attached", async () => {
    // Every candidate was busy (or lost to a race): the command exits non-zero
    // with NBD_ALLOC_FAILED and no NBD_DEV line, so no device is returned.
    mockSSH.mockImplementation(async (...args: unknown[]) => {
      const cmd = String(args[2] ?? "")
      if (cmd.includes("test -S")) return { success: true, output: "EXISTS" }
      if (cmd.includes("nbd-client -unix")) return { success: false, output: "NBD_ALLOC_FAILED: nbd0 already in use", error: "" }
      return { success: true, output: "" }
    })
    await expect(
      startVddkReader("conn", "10.99.99.201", OPTS, "pw", { intervalMs: 0, maxAttempts: 3 }),
    ).rejects.toThrow(/free NBD device|already in use/i)
  })
})

describe("stopVddkReader", () => {
  beforeEach(() => mockSSH.mockReset())
  it("issues the teardown command", async () => {
    mockSSH.mockResolvedValue({ success: true, output: "" })
    await stopVddkReader("conn", "10.99.99.201", { nbdDev: "/dev/nbd3", sock: "/tmp/v.sock", pwFile: "/tmp/pw", logFile: "/tmp/v.log" })
    const cmd = mockSSH.mock.calls[0][2] as string
    expect(cmd).toContain("nbd-client -d /dev/nbd3")
    expect(cmd).toContain("pkill -f")
  })
})
