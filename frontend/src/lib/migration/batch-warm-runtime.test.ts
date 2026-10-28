import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({ vddk: vi.fn(), nbd: vi.fn(), version: vi.fn() }))
vi.mock("@/lib/migration/warm/vddk-preflight", () => ({ runWarmNodePreflight: m.vddk }))
vi.mock("@/lib/migration/warm/xcpng-node-preflight", () => ({ runXcpngWarmNodePreflight: m.nbd }))
vi.mock("@/lib/migration/warm/source-version", async (orig) => ({
  ...(await orig<typeof import("@/lib/migration/warm/source-version")>()),
  fetchSourceApiVersion: m.version,
}))

import { checkBatchWarmRuntime } from "./batch-warm-runtime"

const VDDK9 = "/usr/lib/vmware-vix-disklib/lib64/libvixDiskLib.so.9.1.0.0"
const base = { sourceConnectionId: "src", targetConnectionId: "tgt" }

beforeEach(() => {
  m.vddk.mockReset().mockResolvedValue({ ok: true, missing: [], vddkLib: VDDK9 })
  m.nbd.mockReset().mockResolvedValue({ ok: true, missing: [] })
  m.version.mockReset().mockResolvedValue("8.0.3")
})

describe("checkBatchWarmRuntime", () => {
  it("probes each distinct node once and reports none when all are ready", async () => {
    expect(await checkBatchWarmRuntime({ ...base, sourceType: "vmware", nodes: ["pve1", "pve2", "pve1"] })).toEqual([])
    expect(m.vddk.mock.calls).toEqual([["tgt", "pve1"], ["tgt", "pve2"]])
    expect(m.version).toHaveBeenCalledTimes(1)
  })

  it("reports a VMware node that misses part of the VDDK stack, with the probe's message", async () => {
    m.vddk.mockImplementation(async (_c: string, node: string) => node === "pve2"
      ? { ok: false, missing: ["vddk-lib"], error: "VDDK warm-migration preflight failed. Missing: vddk-lib" }
      : { ok: true, missing: [], vddkLib: VDDK9 })

    expect(await checkBatchWarmRuntime({ ...base, sourceType: "vmware", nodes: ["pve1", "pve2"] })).toEqual([
      { node: "pve2", missing: ["vddk-lib"], message: "pve2 is not ready for warm migration: VDDK warm-migration preflight failed. Missing: vddk-lib" },
    ])
  })

  it("blocks a node whose VDDK cannot read the source version", async () => {
    m.version.mockResolvedValue("5.5.0")

    const problems = await checkBatchWarmRuntime({ ...base, sourceType: "vmware", nodes: ["pve1"] })

    expect(problems).toHaveLength(1)
    expect(problems[0].message).toMatch(/^pve1 is not ready for warm migration: Warm migration cannot read a vSphere 5\.5\.0 source/)
  })

  it("checks the NBD toolchain for an XCP-ng source, without reading a vSphere version", async () => {
    m.nbd.mockResolvedValue({ ok: false, missing: ["nbdinfo"] })

    expect(await checkBatchWarmRuntime({ ...base, sourceType: "xcpng", nodes: ["pve1"] })).toEqual([
      { node: "pve1", missing: ["nbdinfo"], message: "pve1 is not ready for warm migration: missing nbdinfo" },
    ])
    expect(m.vddk).not.toHaveBeenCalled()
    expect(m.version).not.toHaveBeenCalled()
  })

  it("counts a node whose probe throws as not ready", async () => {
    m.vddk.mockRejectedValue(new Error("ssh down"))

    expect(await checkBatchWarmRuntime({ ...base, sourceType: "vmware", nodes: ["pve1"] })).toEqual([
      { node: "pve1", missing: [], message: "pve1: the warm-migration readiness check failed or did not answer in time" },
    ])
  })
})
