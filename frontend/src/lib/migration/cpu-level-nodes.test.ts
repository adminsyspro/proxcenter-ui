import { describe, it, expect, vi } from "vitest"

vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: vi.fn(async () => ({ baseUrl: "https://pve:8006" })) }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))

import { pveFetch } from "@/lib/proxmox/client"
import { readClusterCpuLevels } from "./cpu-level-nodes"

const v3 = "cx16 lahf_lm popcnt sse4_1 sse4_2 ssse3 avx avx2 bmi1 bmi2 f16c fma abm movbe xsave"

describe("readClusterCpuLevels (#1000)", () => {
  it("reads every online node's level and the flags it lacks for v3", async () => {
    vi.mocked(pveFetch).mockImplementation(async (_c: any, path: string) => {
      if (path === "/nodes") return [{ node: "pve1", status: "online" }, { node: "old", status: "online" }, { node: "off", status: "offline" }, { node: "mute", status: "online" }] as any
      if (path === "/nodes/pve1/status") return { cpuinfo: { flags: v3 } } as any
      if (path === "/nodes/old/status") return { cpuinfo: { flags: "cx16 lahf_lm popcnt sse4_1 sse4_2 ssse3 avx" } } as any
      throw new Error("timeout")
    })
    expect(await readClusterCpuLevels("c1")).toEqual([
      { node: "pve1", level: 3, missingV3: [] },
      { node: "old", level: 2, missingV3: ["avx2", "bmi1", "bmi2", "f16c", "fma", "abm", "movbe", "xsave"] },
      { node: "off", level: null, missingV3: [] },
      { node: "mute", level: null, missingV3: [] },
    ])
  })

  it("answers an empty list when the cluster cannot be read", async () => {
    vi.mocked(pveFetch).mockRejectedValue(new Error("401"))
    expect(await readClusterCpuLevels("c1")).toEqual([])
  })
})
