import { describe, expect, it } from "vitest"

import { ENDED_MIGRATION_STATUSES, activeMigrations, isWaitingForCutover, migrationJobDetail, migrationStepText } from "./activeMigrations"
import { TERMINAL_STATUSES, type SharedTask } from "./sharedTask"

const task = (over: Partial<SharedTask>): SharedTask => ({
  id: "j", kind: "migration", label: "vm", sourceVmName: "vm", sourceConnectionId: "vc1", sourceVmId: "vm-1", batchId: null, targetNode: "pve1", targetVmid: null, status: "full_copy",
  currentStep: "full_copy", progress: 10, totalDisks: null, currentDisk: null, bytesTransferred: null, totalBytes: null,
  transferSpeed: null, error: null, projectedDowntimeSec: null, cutoverMode: null, migrationType: null, convertGuest: null, isMine: true,
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

describe("migrationStepText", () => {
  // Echoes the key, so the test reads which translation was picked.
  const t = (key: string) => `<${key}>`

  it("names a numbered delta pass instead of showing delta_19", () => {
    expect(migrationStepText(t, { status: "delta_sync", currentStep: "delta_19", cutoverMode: "auto", projectedDowntimeSec: null })).toBe("<tasks.steps.delta>")
  })

  it("says the run waits for its cutover rather than which pass it is on", () => {
    expect(migrationStepText(t, { status: "delta_sync", currentStep: "delta_3", cutoverMode: "manual", projectedDowntimeSec: 112 })).toBe("<tasks.shared.waitingForCutover>")
    expect(migrationStepText(t, { status: "awaiting_cutover", currentStep: "awaiting_cutover", cutoverMode: "auto", projectedDowntimeSec: 400 })).toBe("<tasks.shared.waitingForCutover>")
  })

  it("translates a known step and keeps a free-text one, such as a virt-v2v phase", () => {
    expect(migrationStepText(t, { status: "transferring", currentStep: "full_copy", cutoverMode: null, projectedDowntimeSec: null })).toBe("<tasks.steps.full_copy>")
    expect(migrationStepText(t, { status: "transferring", currentStep: "Copying disk 1/2", cutoverMode: null, projectedDowntimeSec: null })).toBe("Copying disk 1/2")
  })

  it("has nothing to say without a step", () => {
    expect(migrationStepText(t, { status: "pending", currentStep: null, cutoverMode: null, projectedDowntimeSec: null })).toBeNull()
  })
})

describe("migrationJobDetail", () => {
  const t = (key: string) => `<${key}>`
  const job = (status: string, metadata: Record<string, unknown>) => ({ type: "migration", status, detail: "vCenter → pve1 (VMID 118) • delta_4", metadata })

  it("puts the translated step after the route of a running migration", () => {
    expect(migrationJobDetail(t, job("running", { route: "vCenter → pve1 (VMID 118)", migrationStatus: "delta_sync", currentStep: "delta_4", cutoverMode: "auto", projectedDowntimeSec: null })))
      .toBe("vCenter → pve1 (VMID 118) • <tasks.steps.delta>")
    expect(migrationJobDetail(t, job("running", { route: "vCenter → pve1 (VMID 118)", migrationStatus: "delta_sync", currentStep: "delta_4", cutoverMode: "manual", projectedDowntimeSec: 112 })))
      .toBe("vCenter → pve1 (VMID 118) • <tasks.shared.waitingForCutover>")
  })

  it("shows the route alone once the run has ended or before it has a step", () => {
    expect(migrationJobDetail(t, job("completed", { route: "r", migrationStatus: "completed", currentStep: "completed" }))).toBe("r")
    expect(migrationJobDetail(t, job("pending", { route: "r", migrationStatus: "pending", currentStep: null }))).toBe("r")
  })

  it("leaves any other job, or a row from an older server without the route, as it came", () => {
    expect(migrationJobDetail(t, { type: "drs", status: "running", detail: "x", metadata: {} })).toBe("x")
    expect(migrationJobDetail(t, { type: "migration", status: "running", detail: "a • delta_2", metadata: {} })).toBe("a • delta_2")
  })
})
