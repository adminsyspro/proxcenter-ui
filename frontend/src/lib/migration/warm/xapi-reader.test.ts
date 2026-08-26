import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  buildNbdkitXapiCmd,
  parseAllocatedExtents,
  readAllocatedExtents,
  startXapiReader,
  stopXapiReader,
  type XapiNbdTarget,
} from "./xapi-reader"

vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() }
})
import { executeSSH } from "@/lib/ssh/exec"
const mockSSH = executeSSH as unknown as ReturnType<typeof vi.fn>

const TARGET: XapiNbdTarget = {
  sock: "/tmp/xapi.sock",
  address: "10.0.0.9",
  port: 10809,
  exportname: "vdi/abc?session_id=OpaqueRef:session",
  cert: "-----BEGIN CERTIFICATE-----\ntest-certificate\n-----END CERTIFICATE-----",
}

describe("buildNbdkitXapiCmd", () => {
  it("builds a read-only TLS nbd plugin command with a safely escaped export", () => {
    const cmd = buildNbdkitXapiCmd(TARGET, "/tmp/xapi.sock.ca")

    expect(cmd).toContain("nbdkit -r -U '/tmp/xapi.sock' nbd")
    expect(cmd).toContain("hostname='10.0.0.9'")
    expect(cmd).toContain("port='10809'")
    expect(cmd).toContain("export='vdi/abc?session_id=OpaqueRef:session'")
    expect(cmd).toContain("tls=require")
    expect(cmd).toContain("tls-certificates='/tmp/xapi.sock.ca'")
    expect(cmd).not.toContain("tls-verify")
  })
})

describe("parseAllocatedExtents", () => {
  it("drops ZERO extents while keeping HOLE-only and ordinary extents", () => {
    const result = parseAllocatedExtents(JSON.stringify([
      { offset: 0, length: 10, type: 2 },
      { offset: 10, length: 20, type: 3 },
      { offset: 30, length: 30, type: 1 },
      { offset: 60, length: 20, type: 0 },
    ]), 100)

    expect(result).toEqual([
      { offset: 30, length: 30 },
      { offset: 60, length: 20 },
    ])
  })

  it("clamps the last extent to diskBytes and drops extents past the end", () => {
    const result = parseAllocatedExtents(JSON.stringify([
      { offset: 80, length: 40, type: 0 },
      { offset: 100, length: 10, type: 0 },
      { offset: 120, length: 10, type: 0 },
    ]), 100)

    expect(result).toEqual([{ offset: 80, length: 20 }])
  })

  it("throws on an empty map", () => {
    expect(() => parseAllocatedExtents("[]", 100)).toThrow(/empty map/i)
  })
})

describe("readAllocatedExtents", () => {
  beforeEach(() => mockSSH.mockReset())

  it("returns the whole disk when executeSSH fails", async () => {
    mockSSH.mockResolvedValueOnce({ success: false, error: "nbdinfo failed" })

    await expect(readAllocatedExtents("conn", "10.0.0.7", TARGET.sock, 100))
      .resolves.toEqual([{ offset: 0, length: 100 }])
  })

  it("returns the whole disk when nbdinfo returns invalid JSON", async () => {
    mockSSH.mockResolvedValueOnce({ success: true, output: "not json" })

    await expect(readAllocatedExtents("conn", "10.0.0.7", TARGET.sock, 100))
      .resolves.toEqual([{ offset: 0, length: 100 }])
  })

  it("returns parsed extents when nbdinfo succeeds", async () => {
    mockSSH.mockResolvedValueOnce({
      success: true,
      output: JSON.stringify([
        { offset: 0, length: 25, type: 0 },
        { offset: 25, length: 25, type: 2 },
        { offset: 50, length: 75, type: 1 },
      ]),
    })

    await expect(readAllocatedExtents("conn", "10.0.0.7", TARGET.sock, 100))
      .resolves.toEqual([
        { offset: 0, length: 25 },
        { offset: 50, length: 50 },
      ])
  })
})

describe("startXapiReader", () => {
  beforeEach(() => mockSSH.mockReset())

  it("launches, waits until the second socket poll, and returns the attached device", async () => {
    mockSSH
      .mockResolvedValueOnce({ success: true, output: "12345" })
      .mockResolvedValueOnce({ success: true, output: "" })
      .mockResolvedValueOnce({ success: true, output: "EXISTS" })
      .mockResolvedValueOnce({ success: true, output: "NBD_DEV=/dev/nbd3" })

    const handle = await startXapiReader("conn", "10.0.0.7", TARGET, { intervalMs: 0 })

    expect(handle).toEqual({
      nbdDev: "/dev/nbd3",
      sock: "/tmp/xapi.sock",
      logFile: "/tmp/xapi.sock.log",
      caDir: "/tmp/xapi.sock.ca",
    })

    const launchCmd = mockSSH.mock.calls[0][2] as string
    expect(launchCmd).toContain("rm -rf '/tmp/xapi.sock.ca'; (umask 077; mkdir -p '/tmp/xapi.sock.ca'")
    expect(launchCmd).toContain("printf '%s\\n' '-----BEGIN CERTIFICATE-----\ntest-certificate\n-----END CERTIFICATE-----' > '/tmp/xapi.sock.ca/ca-cert.pem'")
    expect(launchCmd.indexOf("mkdir -p '/tmp/xapi.sock.ca'")).toBeLessThan(launchCmd.indexOf("nohup nbdkit"))
  })

  it("tears down and rejects when the socket never appears", async () => {
    mockSSH
      .mockResolvedValueOnce({ success: true, output: "12345" })
      .mockResolvedValueOnce({ success: true, output: "" })
      .mockResolvedValueOnce({ success: true, output: "" })
      .mockResolvedValueOnce({ success: true, output: "socket setup failed" })
      .mockResolvedValueOnce({ success: true, output: "" })

    await expect(startXapiReader("conn", "10.0.0.7", TARGET, {
      intervalMs: 0,
      maxAttempts: 2,
    })).rejects.toThrow(/socket never appeared/i)

    const teardownCmd = mockSSH.mock.calls[4][2] as string
    expect(teardownCmd).toContain('pkill -f "[n]bdkit.*/tmp/xapi.sock"')
  })
})

describe("stopXapiReader", () => {
  beforeEach(() => mockSSH.mockReset())

  it("detaches the device and kills nbdkit", async () => {
    mockSSH.mockResolvedValueOnce({ success: true, output: "" })

    await stopXapiReader("conn", "10.0.0.7", {
      nbdDev: "/dev/nbd3",
      sock: "/tmp/xapi.sock",
      logFile: "/tmp/xapi.sock.log",
      caDir: "/tmp/xapi.sock.ca",
    })

    const cmd = mockSSH.mock.calls[0][2] as string
    expect(cmd).toContain("nbd-client -d /dev/nbd3")
    expect(cmd).toContain('pkill -f "[n]bdkit.*/tmp/xapi.sock"')
    expect(cmd).toContain("; rm -rf '/tmp/xapi.sock.ca'")
  })
})
