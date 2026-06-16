import { describe, it, expect } from "vitest"
import {
  TERMINAL_STATUSES,
  sourceTypeLabel,
  sharedTaskWindowWhere,
  jobInSharedTaskWindow,
  jobPassesSharedTaskScope,
  toSharedTask,
} from "./sharedTask"

const baseJob = {
  id: "job-1",
  config: { sourceType: "vcenter" },
  sourceVmName: "web01",
  sourceVmId: "vm-100",
  targetConnectionId: "pve-a",
  targetNode: "pve1",
  targetVmid: 123,
  status: "transferring",
  currentStep: "transferring disk 1",
  progress: 42,
  totalDisks: 2,
  currentDisk: 1,
  bytesTransferred: BigInt(10),
  totalBytes: BigInt(100),
  transferSpeed: "50 MB/s",
  error: null,
  createdBy: "u1",
  createdAt: new Date("2026-06-16T10:00:00.000Z"),
  startedAt: new Date("2026-06-16T10:00:05.000Z"),
  completedAt: null,
  updatedAt: new Date("2026-06-16T10:05:00.000Z"),
  logs: [{ t: 1, m: "hi" }],
}

describe("sourceTypeLabel", () => {
  it("maps known source types and falls back to the raw value then External", () => {
    expect(sourceTypeLabel("vcenter")).toBe("vCenter")
    expect(sourceTypeLabel("esxi-direct")).toBe("ESXi")
    expect(sourceTypeLabel("xcpng")).toBe("XCP-ng")
    expect(sourceTypeLabel("weirdthing")).toBe("weirdthing")
    expect(sourceTypeLabel(null)).toBe("External")
  })
})

describe("sharedTaskWindowWhere / jobInSharedTaskWindow", () => {
  const cutoff = new Date("2026-06-16T10:00:00.000Z")

  it("window where includes active OR recently-updated", () => {
    expect(sharedTaskWindowWhere(cutoff)).toEqual({
      OR: [
        { status: { notIn: TERMINAL_STATUSES } },
        { updatedAt: { gte: cutoff } },
      ],
    })
  })

  it("active job is always in window regardless of updatedAt", () => {
    expect(jobInSharedTaskWindow({ status: "delta_sync", updatedAt: new Date("2020-01-01") }, cutoff)).toBe(true)
  })

  it("terminal job is in window only if updatedAt >= cutoff", () => {
    expect(jobInSharedTaskWindow({ status: "failed", updatedAt: new Date("2026-06-16T10:01:00Z") }, cutoff)).toBe(true)
    expect(jobInSharedTaskWindow({ status: "failed", updatedAt: new Date("2026-06-16T09:00:00Z") }, cutoff)).toBe(false)
  })
})

describe("jobPassesSharedTaskScope", () => {
  it("DEFAULT passes everything, even an unreachable/deleted target connection", () => {
    expect(jobPassesSharedTaskScope({ targetConnectionId: "gone" }, { isDefault: true, reachableConnectionIds: new Set() })).toBe(true)
  })
  it("non-DEFAULT passes only reachable target connections", () => {
    const scope = { isDefault: false, reachableConnectionIds: new Set(["pve-a"]) }
    expect(jobPassesSharedTaskScope({ targetConnectionId: "pve-a" }, scope)).toBe(true)
    expect(jobPassesSharedTaskScope({ targetConnectionId: "pve-b" }, scope)).toBe(false)
  })
})

describe("toSharedTask", () => {
  it("maps fields, coerces BigInt, builds label, never includes raw createdBy", () => {
    const st = toSharedTask(baseJob as any, { isMine: true, createdByName: "Alice" })
    expect(st.id).toBe("job-1")
    expect(st.kind).toBe("migration")
    expect(st.label).toBe("web01 (vCenter -> Proxmox)")
    expect(st.bytesTransferred).toBe(10)
    expect(st.totalBytes).toBe(100)
    expect(st.isMine).toBe(true)
    expect(st.createdByName).toBe("Alice")
    expect(st.createdAt).toBe("2026-06-16T10:00:00.000Z")
    expect(st.completedAt).toBeNull()
    expect((st as any).createdBy).toBeUndefined()
    expect((st as any).logs).toBeUndefined()
  })
})
