import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/ssh/exec", async (importActual) => ({ ...(await importActual<typeof import("@/lib/ssh/exec")>()), executeSSH: vi.fn() }))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: vi.fn(async () => ({ baseUrl: "https://pve:8006" })) }))
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))
vi.mock("../pve-tasks", () => ({ getNodeSshEndpointForMigration: vi.fn(async () => "10.0.0.9") }))

import { executeSSH } from "@/lib/ssh/exec"
import { checkGuestConversionNode } from "./guest-conversion-node"

beforeEach(() => { vi.mocked(executeSSH).mockReset() })

describe("checkGuestConversionNode (#1000)", () => {
  it("reads the node with a read-only probe and splits what Linux and Windows guests need", async () => {
    vi.mocked(executeSSH).mockResolvedValue({ success: true, output: "v2v-in-place\n" })
    expect(await checkGuestConversionNode("c1", "pve1")).toEqual({
      linux: [],
      windows: ["the VirtIO drivers for Windows (/usr/share/virtio-win/virtio-win.iso)", "rhsrvany.exe (Windows first-boot helper)"],
    })
    expect(vi.mocked(executeSSH).mock.calls[0][1]).toBe("10.0.0.9")
    expect(vi.mocked(executeSSH).mock.calls[0][4]).toEqual({ readOnly: true })
  })

  it("reports a probe that could not run instead of throwing", async () => {
    vi.mocked(executeSSH).mockResolvedValue({ success: false, output: "", error: "auth failed" })
    expect(await checkGuestConversionNode("c1", "pve1")).toEqual({ linux: [], windows: [], error: "auth failed" })
    vi.mocked(executeSSH).mockImplementation(async () => { throw new Error("no route") })
    expect((await checkGuestConversionNode("c1", "pve1")).error).toBe("no route")
  })
})
