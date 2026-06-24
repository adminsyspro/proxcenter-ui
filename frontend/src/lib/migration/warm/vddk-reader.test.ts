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
  it("frees a stale device, then connects the unix socket to a kernel nbd device", () => {
    const c = buildNbdConnectCmd("/tmp/v.sock", "/dev/nbd3")
    expect(c).toContain("nbd-client -unix /tmp/v.sock /dev/nbd3")
    // Defensively detach /dev/nbd3 first: a device left allocated by a previous
    // failed/aborted attempt otherwise blocks the attach with "Failed to setup
    // device" on every retry (#503). The detach must precede the attach.
    expect(c).toContain("nbd-client -d /dev/nbd3")
    expect(c.indexOf("nbd-client -d /dev/nbd3")).toBeLessThan(c.indexOf("nbd-client -unix"))
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
})

describe("startVddkReader", () => {
  beforeEach(() => mockSSH.mockReset())

  it("writes the password file, launches nbdkit, waits for the socket, attaches the device", async () => {
    // call 0: pw-write + launch ; call 1: socket missing ; call 2: socket EXISTS ; call 3: nbd-client connect
    mockSSH
      .mockResolvedValueOnce({ success: true, output: "12345" })
      .mockResolvedValueOnce({ success: true, output: "" })
      .mockResolvedValueOnce({ success: true, output: "EXISTS" })
      .mockResolvedValueOnce({ success: true, output: "" })

    const handle = await startVddkReader("conn", "10.99.99.201", OPTS, "s3cr3t", "/dev/nbd3", { intervalMs: 0, maxAttempts: 5 })

    expect(handle.nbdDev).toBe("/dev/nbd3")
    expect(handle.sock).toBe("/tmp/v.sock")
    expect(handle.pwFile).toBe("/tmp/pw")
    // The launch call writes the password (no trailing newline) and backgrounds nbdkit to a log file.
    const launchCmd = mockSSH.mock.calls[0][2] as string
    expect(launchCmd).toContain("printf '%s'")
    expect(launchCmd).toContain("nohup nbdkit -r -U '/tmp/v.sock' vddk")
    expect(launchCmd).not.toContain("\ns3cr3t\n") // password not heredoc'd raw
    // The device-attach call uses the connect builder.
    const connectCmd = mockSSH.mock.calls[3][2] as string
    expect(connectCmd).toContain("nbd-client -unix /tmp/v.sock /dev/nbd3")
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
      startVddkReader("conn", "10.99.99.201", OPTS, "pw", "/dev/nbd3", { intervalMs: 0, maxAttempts: 3 }),
    ).rejects.toThrow(/bad thumbprint|nbdkit/i)
  })

  it("throws when nbd-client fails to attach the device", async () => {
    mockSSH.mockImplementation(async (...args: unknown[]) => {
      const cmd = String(args[2] ?? "")
      if (cmd.includes("test -S")) return { success: true, output: "EXISTS" }
      if (cmd.includes("nbd-client -unix")) return { success: false, output: "", error: "Device or resource busy" }
      return { success: true, output: "" }
    })
    await expect(
      startVddkReader("conn", "10.99.99.201", OPTS, "pw", "/dev/nbd3", { intervalMs: 0, maxAttempts: 3 }),
    ).rejects.toThrow(/busy|nbd-client/i)
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
