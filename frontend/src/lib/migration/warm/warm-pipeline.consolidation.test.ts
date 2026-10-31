import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock only the SOAP surface: the helpers under test decide when to consolidate
// the source and what to say about it in the job log (roadmap#177).
vi.mock("@/lib/vmware/soap", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/vmware/soap")>()
  return {
    ...actual,
    soapWaitForConsolidation: vi.fn(),
    soapStartConsolidateVmDisks: vi.fn(),
    soapConsolidateVmDisks: vi.fn(),
  }
})

import { soapWaitForConsolidation, soapStartConsolidateVmDisks, soapConsolidateVmDisks } from "@/lib/vmware/soap"
import { startPendingConsolidation, consolidateSourceAfterFailure, refreshDiskFileNames } from "./warm-pipeline"

const cleared = vi.mocked(soapWaitForConsolidation)
const start = vi.mocked(soapStartConsolidateVmDisks)
const consolidate = vi.mocked(soapConsolidateVmDisks)
const session = { baseUrl: "https://vcenter", cookie: "c", insecureTLS: true, propertyCollector: "pc", sessionManager: "sm", rootFolder: "rf", isVcenter: true } as any

let lines: Array<{ msg: string; level: string }>
const log = async (msg: string, level: "info" | "warn") => { lines.push({ msg, level }) }

beforeEach(() => {
  cleared.mockReset(); start.mockReset(); consolidate.mockReset()
  lines = []
})

describe("startPendingConsolidation", () => {
  it("does nothing on a source that is not flagged", async () => {
    cleared.mockResolvedValue(true)
    const onPending = vi.fn()
    await expect(startPendingConsolidation(session, "vm-9", log, onPending)).resolves.toBe(false)
    // One probe, no wait: the budget and poll interval are both 0.
    expect(cleared).toHaveBeenCalledWith(session, "vm-9", 0, 0)
    expect(start).not.toHaveBeenCalled()
    expect(onPending).not.toHaveBeenCalled()
    expect(lines).toEqual([])
  })

  it("starts the merge on a flagged source after announcing the wait", async () => {
    // The lab case: a network cut killed the copy, the snapshot removal could
    // not merge the locked delta, and the flag would have held the next run 4 h.
    cleared.mockResolvedValue(false)
    start.mockResolvedValue("task-7")
    const order: string[] = []
    const onPending = vi.fn(() => { order.push("pending") })
    start.mockImplementation(async () => { order.push("start"); return "task-7" })
    await expect(startPendingConsolidation(session, "vm-9", log, onPending)).resolves.toBe(true)
    expect(start).toHaveBeenCalledWith(session, "vm-9")
    expect(order).toEqual(["pending", "start"])
    expect(lines).toEqual([{ msg: "Source flagged for disk consolidation: started Consolidate on it", level: "info" }])
  })

  it("keeps going when vSphere refuses a second merge, and says why", async () => {
    cleared.mockResolvedValue(false)
    start.mockRejectedValue(new Error("Failed to consolidate the disks of vm-9: Another task is already in progress."))
    await expect(startPendingConsolidation(session, "vm-9", log)).resolves.toBe(true)
    expect(lines).toHaveLength(1)
    expect(lines[0].level).toBe("info")
    expect(lines[0].msg).toMatch(/Consolidate not started on the source \(.*Another task is already in progress.*\); waiting for the merge vSphere is running/)
  })

  it("stays quiet on a refusal during the periodic restarts, and still logs a start", async () => {
    // The wait restarts the merge every few minutes while the source stays
    // flagged: a refusal there means the merge already runs, said once already.
    cleared.mockResolvedValue(false)
    start.mockRejectedValueOnce(new Error("Another task is already in progress.")).mockResolvedValueOnce("task-8")
    await expect(startPendingConsolidation(session, "vm-9", log, undefined, { quietRefusal: true })).resolves.toBe(true)
    expect(lines).toEqual([])
    await expect(startPendingConsolidation(session, "vm-9", log, undefined, { quietRefusal: true })).resolves.toBe(true)
    expect(lines).toEqual([{ msg: "Source flagged for disk consolidation: started Consolidate on it", level: "info" }])
  })

  it("never lets a failed log append escape", async () => {
    cleared.mockResolvedValue(false)
    start.mockResolvedValue("task-7")
    await expect(startPendingConsolidation(session, "vm-9", async () => { throw new Error("db down") })).resolves.toBe(true)
  })
})

describe("consolidateSourceAfterFailure", () => {
  it("leaves a source that is not flagged alone", async () => {
    cleared.mockResolvedValue(true)
    await consolidateSourceAfterFailure(session, "vm-9", log)
    expect(consolidate).not.toHaveBeenCalled()
    expect(lines).toEqual([])
  })

  it("consolidates a flagged source within a bounded wait and logs it", async () => {
    cleared.mockResolvedValue(false)
    consolidate.mockResolvedValue(undefined)
    await consolidateSourceAfterFailure(session, "vm-9", log)
    expect(consolidate).toHaveBeenCalledWith(session, "vm-9", { timeoutMs: 10 * 60 * 1000 })
    expect(lines).toEqual([{ msg: "Consolidated the source VM disks (vSphere flagged a pending merge after the warm snapshot was removed)", level: "info" }])
  })

  it("warns, without throwing, when the merge fails, and points at the way out", async () => {
    cleared.mockResolvedValue(false)
    consolidate.mockRejectedValue(new Error("Failed to consolidate the disks of vm-9: file is locked"))
    await expect(consolidateSourceAfterFailure(session, "vm-9", log)).resolves.toBeUndefined()
    expect(lines).toHaveLength(1)
    expect(lines[0].level).toBe("warn")
    expect(lines[0].msg).toMatch(/Could not consolidate the source VM disks \(.*file is locked\); the next warm run of this VM starts the consolidation itself, or run "Consolidate" on the VM in vSphere/)
  })
})

describe("refreshDiskFileNames", () => {
  const disk = (deviceKey: number | undefined, fileName: string) => ({
    label: `Hard disk ${deviceKey}`, fileName, capacityBytes: 8 * 1024 ** 3, thinProvisioned: true,
    datastoreName: fileName.slice(1, fileName.indexOf("]")), relativePath: fileName.split("] ")[1], deviceKey,
  })

  it("points a disk left on a merged delta back at the file the source runs on", () => {
    // The lab case: planned while flagged, the VM ran on c7-000001.vmdk; the
    // consolidation merged it, and the reader then opened a file that was gone.
    const planned = [disk(2000, "[ds1] c7/c7-000001.vmdk"), disk(2001, "[ds1] c7/c7_1.vmdk")]
    const fresh = [disk(2000, "[ds1] c7/c7.vmdk"), disk(2001, "[ds1] c7/c7_1.vmdk")]
    expect(refreshDiskFileNames(planned, fresh)).toEqual([{ index: 0, from: "[ds1] c7/c7-000001.vmdk", to: "[ds1] c7/c7.vmdk" }])
    expect(planned[0].fileName).toBe("[ds1] c7/c7.vmdk")
    expect(planned[0].relativePath).toBe("c7/c7.vmdk")
    expect(planned[1].fileName).toBe("[ds1] c7/c7_1.vmdk")
  })

  it("matches by device key, not by position, and keeps the planned order", () => {
    const planned = [disk(2001, "[ds1] c7/c7_1-000001.vmdk"), disk(2000, "[ds1] c7/c7-000001.vmdk")]
    const fresh = [disk(2000, "[ds1] c7/c7.vmdk"), disk(2001, "[ds1] c7/c7_1.vmdk")]
    refreshDiskFileNames(planned, fresh)
    expect(planned.map(d => d.fileName)).toEqual(["[ds1] c7/c7_1.vmdk", "[ds1] c7/c7.vmdk"])
  })

  it("leaves a disk alone when the fresh read does not list it or names no file", () => {
    const planned = [disk(2000, "[ds1] c7/c7.vmdk"), disk(2002, "[ds1] c7/c7_2.vmdk"), disk(undefined, "[ds1] c7/x.vmdk")]
    const fresh = [disk(2000, ""), disk(undefined, "[ds1] c7/y.vmdk")]
    expect(refreshDiskFileNames(planned, fresh)).toEqual([])
    expect(planned.map(d => d.fileName)).toEqual(["[ds1] c7/c7.vmdk", "[ds1] c7/c7_2.vmdk", "[ds1] c7/x.vmdk"])
  })
})
