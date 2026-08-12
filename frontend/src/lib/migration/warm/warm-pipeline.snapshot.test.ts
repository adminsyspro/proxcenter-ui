import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock only the SOAP surface; the helpers under test are the pure orchestration
// around it (tracking MORs for cleanup, sweeping leftovers).
vi.mock("@/lib/vmware/soap", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/vmware/soap")>()
  return {
    ...actual,
    soapCreateSnapshot: vi.fn(),
    soapRemoveSnapshot: vi.fn(),
    soapFindSnapshotsByNamePrefix: vi.fn(),
  }
})

import { soapCreateSnapshot, soapRemoveSnapshot, soapFindSnapshotsByNamePrefix } from "@/lib/vmware/soap"
import { createWarmSnapshot, sweepWarmSnapshots } from "./warm-pipeline"

const create = vi.mocked(soapCreateSnapshot)
const remove = vi.mocked(soapRemoveSnapshot)
const findByPrefix = vi.mocked(soapFindSnapshotsByNamePrefix)
const session = { baseUrl: "https://vcenter", cookie: "c", insecureTLS: true, propertyCollector: "pc", sessionManager: "sm", rootFolder: "rf", isVcenter: true } as any

beforeEach(() => { create.mockReset(); remove.mockReset(); findByPrefix.mockReset() })

describe("createWarmSnapshot", () => {
  it("records the MOR for cleanup on the happy path", async () => {
    create.mockResolvedValue("snapshot-12")
    const ourSnapshots: string[] = []
    await expect(createWarmSnapshot(session, "vm-9", "proxcenter-warm-full", ourSnapshots)).resolves.toBe("snapshot-12")
    expect(ourSnapshots).toEqual(["snapshot-12"])
  })

  it("recovers the orphan by name when the create times out, then rethrows the real error", async () => {
    // The production incident: CreateSnapshot times out, vCenter creates the
    // snapshot anyway, and the MOR was never recorded -> orphan left on the VM.
    const boom = new Error('Snapshot creation "proxcenter-warm-delta-1" on VM vm-9 did not complete within 30min')
    create.mockRejectedValue(boom)
    findByPrefix.mockResolvedValue([{ name: "proxcenter-warm-delta-1", mor: "snapshot-77" }])
    const ourSnapshots: string[] = []
    const onRecovered = vi.fn()

    await expect(createWarmSnapshot(session, "vm-9", "proxcenter-warm-delta-1", ourSnapshots, onRecovered))
      .rejects.toBe(boom)

    expect(findByPrefix).toHaveBeenCalledWith(session, "vm-9", "proxcenter-warm-delta-1")
    expect(ourSnapshots).toEqual(["snapshot-77"])
    expect(onRecovered).toHaveBeenCalledWith("snapshot-77")
  })

  it("never lets a failed recovery mask the original error", async () => {
    const boom = new Error("create timed out")
    create.mockRejectedValue(boom)
    findByPrefix.mockRejectedValue(new Error("session expired"))
    const ourSnapshots: string[] = []
    await expect(createWarmSnapshot(session, "vm-9", "proxcenter-warm-full", ourSnapshots)).rejects.toBe(boom)
    expect(ourSnapshots).toEqual([])
  })

  it("recovers and throws when the create succeeds without returning a reference", async () => {
    create.mockResolvedValue("")
    findByPrefix.mockResolvedValue([{ name: "proxcenter-warm-full", mor: "snapshot-5" }])
    const ourSnapshots: string[] = []
    await expect(createWarmSnapshot(session, "vm-9", "proxcenter-warm-full", ourSnapshots))
      .rejects.toThrow(/returned no snapshot reference/)
    expect(ourSnapshots).toEqual(["snapshot-5"])
  })

  it("does not record a MOR twice when it is already tracked", async () => {
    create.mockRejectedValue(new Error("boom"))
    findByPrefix.mockResolvedValue([{ name: "proxcenter-warm-full", mor: "snapshot-5" }])
    const ourSnapshots = ["snapshot-5"]
    const onRecovered = vi.fn()
    await expect(createWarmSnapshot(session, "vm-9", "proxcenter-warm-full", ourSnapshots, onRecovered)).rejects.toThrow()
    expect(ourSnapshots).toEqual(["snapshot-5"])
    expect(onRecovered).not.toHaveBeenCalled()
  })
})

describe("sweepWarmSnapshots", () => {
  it("removes every leftover proxcenter-warm-* snapshot and logs one line each", async () => {
    findByPrefix.mockResolvedValue([
      { name: "proxcenter-warm-full", mor: "snapshot-2" },
      { name: "proxcenter-warm-delta-1", mor: "snapshot-3" },
    ])
    remove.mockResolvedValue(undefined)
    const lines: string[] = []
    await expect(sweepWarmSnapshots(session, "vm-9", async m => { lines.push(m) })).resolves.toBe(2)
    expect(findByPrefix).toHaveBeenCalledWith(session, "vm-9", "proxcenter-warm-")
    // never removeChildren: a user snapshot taken under ours must survive
    expect(remove.mock.calls.map(c => [c[1], c[2]])).toEqual([["snapshot-2", false], ["snapshot-3", false]])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/Removed leftover warm snapshot "proxcenter-warm-full" \(snapshot-2\)/)
  })

  it("keeps going and never throws when one removal fails", async () => {
    findByPrefix.mockResolvedValue([
      { name: "proxcenter-warm-full", mor: "snapshot-2" },
      { name: "proxcenter-warm-delta-1", mor: "snapshot-3" },
    ])
    remove.mockRejectedValueOnce(new Error("still consolidating")).mockResolvedValueOnce(undefined)
    const lines: string[] = []
    await expect(sweepWarmSnapshots(session, "vm-9", async m => { lines.push(m) })).resolves.toBe(1)
    expect(lines[0]).toMatch(/could not be confirmed removed \(still consolidating\)/)
    expect(lines[1]).toMatch(/Removed leftover warm snapshot "proxcenter-warm-delta-1"/)
  })

  it("returns 0 without throwing when the lookup itself fails", async () => {
    findByPrefix.mockRejectedValue(new Error("session expired"))
    await expect(sweepWarmSnapshots(session, "vm-9", async () => {})).resolves.toBe(0)
    expect(remove).not.toHaveBeenCalled()
  })

  it("survives a logger that rejects", async () => {
    findByPrefix.mockResolvedValue([{ name: "proxcenter-warm-full", mor: "snapshot-2" }])
    remove.mockResolvedValue(undefined)
    await expect(sweepWarmSnapshots(session, "vm-9", async () => { throw new Error("db down") })).resolves.toBe(1)
  })
})
