import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  checkNbdNodePreflight,
  parseNbdPreflightOutput,
  runXcpngWarmNodePreflight,
} from "./xcpng-node-preflight"

vi.mock("@/lib/ssh/exec", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: vi.fn() }
})
import { executeSSH } from "@/lib/ssh/exec"
const mockSSH = executeSSH as unknown as ReturnType<typeof vi.fn>

vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn(async () => ({ baseUrl: "https://pve.local:8006" })),
}))
vi.mock("../pve-tasks", () => ({
  getNodeIpForMigration: vi.fn(async () => "10.0.0.7"),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))
import { getNodeIpForMigration } from "../pve-tasks"
const mockNodeIp = getNodeIpForMigration as unknown as ReturnType<typeof vi.fn>

const ALL_OK = [
  "nbdkit=ok",
  "nbdkit-nbd-plugin=ok",
  "nbd-client=ok",
  "nbdinfo=ok",
  "nbd-module=ok",
].join("\n")

describe("parseNbdPreflightOutput", () => {
  it("reports ok with no missing tools when every probe succeeds", () => {
    expect(parseNbdPreflightOutput(ALL_OK)).toEqual({ ok: true, missing: [] })
  })

  it("reports a missing nbdkit nbd plugin", () => {
    const output = ALL_OK.replace("nbdkit-nbd-plugin=ok", "nbdkit-nbd-plugin=missing")

    expect(parseNbdPreflightOutput(output)).toEqual({
      ok: false,
      missing: ["nbdkit-nbd-plugin"],
    })
  })
})

describe("checkNbdNodePreflight", () => {
  beforeEach(() => mockSSH.mockReset())

  it("returns an error when executeSSH fails", async () => {
    mockSSH.mockResolvedValueOnce({ success: false, error: "connection refused" })

    const result = await checkNbdNodePreflight("conn", "10.0.0.7")

    expect(result.ok).toBe(false)
    expect(result.missing).toEqual([])
    expect(result.error).toMatch(/connection refused|preflight/i)
  })
})

describe("runXcpngWarmNodePreflight", () => {
  beforeEach(() => {
    mockSSH.mockReset()
    mockNodeIp.mockReset()
    mockNodeIp.mockResolvedValue("10.0.0.7")
  })

  it("resolves the migration node IP and probes that node", async () => {
    mockSSH.mockResolvedValueOnce({ success: true, output: ALL_OK })

    await expect(runXcpngWarmNodePreflight("conn", "pve1"))
      .resolves.toEqual({ ok: true, missing: [] })

    expect(mockNodeIp).toHaveBeenCalledWith(
      expect.anything(),
      "conn",
      "pve1",
      "https://pve.local:8006",
    )
    expect(mockSSH).toHaveBeenCalledWith(
      "conn",
      "10.0.0.7",
      expect.stringContaining("nbdkit-nbd-plugin=ok"),
    )
  })
})
