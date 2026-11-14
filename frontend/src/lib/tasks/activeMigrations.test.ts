import { describe, expect, it } from "vitest"

import { ENDED_MIGRATION_STATUSES, activeMigrations, isWaitingForCutover } from "./activeMigrations"
import { TERMINAL_STATUSES, type SharedTask } from "./sharedTask"

const task = (over: Partial<SharedTask>): SharedTask => ({
  id: "j", kind: "migration", label: "vm", sourceVmName: "vm", sourceConnectionId: "vc1", sourceVmId: "vm-1", batchId: null, targetNode: "pve1", targetVmid: null, status: "full_copy",
  currentStep: "full_copy", progress: 10, totalDisks: null, currentDisk: null, bytesTransferred: null, totalBytes: null,
  transferSpeed: null, error: null, projectedDowntimeSec: null, cutoverMode: null, convertGuest: null, isMine: true,
  createdByName: "x", createdAt: "2026-11-14T10:00:00.000Z", startedAt: null, completedAt: null, ...over,
})

describe("activeMigrations", () => {
  it("ends a migration on the same statuses as the server", () => {
    expect([...ENDED_MIGRATION_STATUSES]).toEqual([...TERMINAL_STATUSES])
  })

  it("keeps the migrations that have not ended, oldest first", () => {
    const list = activeMigrations([
      task({ id: "late", createdAt: "2026-11-14T11:00:00.000Z" }),
      task({ id: "done", status: "completed" }),
      task({ id: "failed", status: "failed" }),
      task({ id: "cancelled", status: "cancelled" }),
      task({ id: "early", createdAt: "2026-11-14T09:00:00.000Z" }),
    ])
    expect(list.map(t => t.id)).toEqual(["early", "late"])
  })
})

describe("isWaitingForCutover", () => {
  it("is a warm run held for its operator, measured at least once, or parked at the gate", () => {
    expect(isWaitingForCutover(task({ status: "delta_sync", cutoverMode: "manual", projectedDowntimeSec: 112 }))).toBe(true)
    expect(isWaitingForCutover(task({ status: "awaiting_cutover", cutoverMode: "auto" }))).toBe(true)
  })

  it("is not a sync on its way to an automatic cutover, nor a hold before its first measure", () => {
    expect(isWaitingForCutover(task({ status: "delta_sync", cutoverMode: "auto", projectedDowntimeSec: 112 }))).toBe(false)
    expect(isWaitingForCutover(task({ status: "delta_sync", cutoverMode: "manual", projectedDowntimeSec: null }))).toBe(false)
    expect(isWaitingForCutover(task({ status: "cutover", cutoverMode: "manual", projectedDowntimeSec: 112 }))).toBe(false)
  })
})
