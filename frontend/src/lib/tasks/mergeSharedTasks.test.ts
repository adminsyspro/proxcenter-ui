import { describe, it, expect } from "vitest"
import { mergeSharedTasks } from "./mergeSharedTasks"
import type { SharedTask } from "./sharedTask"
import type { PCTask } from "@/contexts/ProxCenterTasksContext"

const st = (over: Partial<SharedTask> = {}): SharedTask => ({
  id: "job-1", kind: "migration", label: "web01 (vCenter -> Proxmox)", sourceVmName: "web01",
  targetNode: "pve1", targetVmid: 1, status: "transferring", currentStep: "x", progress: 20,
  totalDisks: 1, currentDisk: 1, bytesTransferred: null, totalBytes: null, transferSpeed: null,
  error: null, isMine: false, createdByName: "Alice", createdAt: "2026-06-16T10:00:00.000Z",
  startedAt: null, completedAt: null, ...over,
})

const local = (over: Partial<PCTask> = {}): PCTask => ({
  id: "migration-job-1", type: "generic", label: "local", progress: 50, status: "running",
  createdAt: Date.parse("2026-06-16T10:00:00.000Z"), ...over,
})

describe("mergeSharedTasks", () => {
  it("maps server rows; active->running, completed->done, failed/cancelled->error; readOnly from !isMine", () => {
    const out = mergeSharedTasks([], [
      st({ id: "a", status: "delta_sync", isMine: false }),
      st({ id: "b", status: "completed", isMine: true }),
      st({ id: "c", status: "cancelled", isMine: false }),
    ])
    const byId = Object.fromEntries(out.map(t => [t.id, t]))
    expect(byId["migration-a"].status).toBe("running")
    expect(byId["migration-a"].readOnly).toBe(true)
    expect(byId["migration-b"].status).toBe("done")
    expect(byId["migration-b"].readOnly).toBe(false)
    expect(byId["migration-c"].status).toBe("error")
    expect(byId["migration-c"].rawStatus).toBe("cancelled")
    expect(byId["migration-a"].jobId).toBe("a")
  })

  it("passes through local non-migration tasks untouched", () => {
    const up: PCTask = { id: "up-1", type: "upload", label: "iso", progress: 10, status: "running", createdAt: 1 }
    const out = mergeSharedTasks([up], [])
    expect(out.find(t => t.id === "up-1")).toBeTruthy()
  })

  it("server terminal row ALWAYS wins over a stale local running row", () => {
    const out = mergeSharedTasks([local({ status: "running", label: "local" })], [st({ status: "failed", label: "server" })])
    const row = out.find(t => t.id === "migration-job-1")!
    expect(row.status).toBe("error")
    expect(row.label).toBe("server")
    expect((row as any).shared).toBe(true)
  })

  it("over an ACTIVE server row, a running local row wins (keeps interactivity)", () => {
    const out = mergeSharedTasks([local({ status: "running", label: "local" })], [st({ status: "transferring" })])
    const row = out.find(t => t.id === "migration-job-1")!
    expect(row.label).toBe("local")
    expect((row as any).shared).toBeUndefined()
  })

  it("over an ACTIVE server row, an interrupted (error) local row loses to the server", () => {
    const out = mergeSharedTasks(
      [local({ status: "error", error: "Interrupted by page reload" })],
      [st({ status: "transferring", label: "live" })],
    )
    const row = out.find(t => t.id === "migration-job-1")!
    expect(row.status).toBe("running")
    expect((row as any).shared).toBe(true)
  })

  it("sorts running first, then createdAt desc", () => {
    const out = mergeSharedTasks([], [
      st({ id: "old-done", status: "completed", createdAt: "2026-06-16T09:00:00.000Z" }),
      st({ id: "new-run", status: "transferring", createdAt: "2026-06-16T11:00:00.000Z" }),
    ])
    expect(out[0].id).toBe("migration-new-run")
  })
})
