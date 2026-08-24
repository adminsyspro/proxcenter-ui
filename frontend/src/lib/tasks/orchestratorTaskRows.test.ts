/**
 * The ProxCenter tab of the taskbar used to list nothing but the external
 * migrations of the last 30 minutes, so a rolling update, a DRS move, a
 * replication run, a failover or simply an older migration was nowhere to be
 * seen outside the Task Center page. It now mirrors the Task Center list.
 */
import { describe, expect, it } from "vitest"

import { mergeTaskbarRows, orchestratorTaskRows, taskbarRowId } from "./orchestratorTaskRows"

const T0 = Date.parse("2026-08-24T12:00:00Z")
const minutesAgo = (n: number) => new Date(T0 - n * 60 * 1000).toISOString()

const job = (over: Record<string, any> = {}) => ({
  id: "ru-1",
  name: "Rolling Update - pve1.example.com",
  type: "rolling_update",
  status: "running",
  progress: 40,
  startedAt: minutesAgo(5),
  detail: "1/3 nodes",
  metadata: {},
  ...over,
})

const sharedTask = (over: Record<string, any> = {}) => ({
  id: "mig-1",
  kind: "migration",
  label: "srv-app (vCenter -> Proxmox)",
  status: "transferring",
  currentStep: "disk 1/2",
  progress: 42,
  error: null,
  isMine: true,
  createdByName: "Alice",
  createdAt: minutesAgo(3),
  ...over,
})

describe("taskbarRowId", () => {
  it("puts a migration in the shared-task namespace and everything else in its own", () => {
    expect(taskbarRowId({ id: "mig-1", type: "migration" })).toBe("migration-mig-1")
    expect(taskbarRowId({ id: "ru-1", type: "rolling_update" })).toBe("job-ru-1")
    expect(taskbarRowId({ id: "sr-1", type: "site_recovery" })).toBe("job-sr-1")
  })
})

describe("orchestratorTaskRows", () => {
  it("maps a running rolling update to a read-only taskbar row", () => {
    expect(orchestratorTaskRows([job()])).toEqual([
      {
        id: "job-ru-1",
        type: "generic",
        icon: "ri-refresh-line",
        label: "Rolling Update - pve1.example.com",
        detail: "1/3 nodes",
        progress: 40,
        status: "running",
        rawStatus: "running",
        error: undefined,
        createdAt: Date.parse(minutesAgo(5)),
        shared: true,
        readOnly: true,
        orchestrator: true,
        jobId: "ru-1",
      },
    ])
  })

  it("keeps finished jobs, however old: the taskbar mirrors the Task Center", () => {
    const rows = orchestratorTaskRows([
      job({ id: "old-1", status: "success", startedAt: minutesAgo(60 * 24 * 79), endedAt: minutesAgo(60 * 24 * 79) }),
      job({ id: "old-2", status: "failed", startedAt: minutesAgo(60 * 24 * 12) }),
    ])
    expect(rows.map(r => r.id)).toEqual(["job-old-1", "job-old-2"])
  })

  it("maps each status onto the three states a row can render", () => {
    const statuses = ["success", "completed", "failed", "cancelled", "paused", "pending", "queued"]
    const rows = orchestratorTaskRows(statuses.map((status, i) => job({ id: `j${i}`, status })))
    expect(rows.map(r => r.status)).toEqual(["done", "done", "error", "error", "running", "running", "running"])
    // The precise word stays available for the chip label.
    expect(rows.map(r => r.rawStatus)).toEqual(statuses)
  })

  it("carries the per-type icon and the error of a failed job", () => {
    const rows = orchestratorTaskRows([
      job({ id: "d-1", type: "drs", name: "DRS Migration - vm1" }),
      job({ id: "r-1", type: "replication", name: "Replication - vm1" }),
      job({ id: "sr-1", type: "site_recovery", name: "Failover - dr-plan", status: "failed", metadata: { error: "boom" } }),
      job({ id: "m-1", type: "migration", name: "Migration - srv" }),
    ])
    expect(rows.map(r => r.icon)).toEqual([
      "ri-exchange-line",
      "ri-repeat-line",
      "ri-shield-star-line",
      "ri-swap-box-line",
    ])
    expect(rows.find(r => r.id === "job-sr-1")?.error).toBe("boom")
  })

  it("survives a missing or malformed payload", () => {
    expect(orchestratorTaskRows(undefined as any)).toEqual([])
    expect(orchestratorTaskRows([{ status: "running" }] as any)).toEqual([])
    const [row] = orchestratorTaskRows([{ id: "x", status: "running" }])
    expect(row.label).toBe("x")
    expect(row.progress).toBe(0)
    expect(row.createdAt).toBe(0)
    expect(row.icon).toBe("ri-file-list-line")
  })
})

describe("mergeTaskbarRows", () => {
  it("lists local tasks, shared migrations and Task Center jobs together", () => {
    const local = [{ id: "upload-1", type: "upload" as const, label: "ISO", progress: 10, status: "running" as const, createdAt: T0 }]
    const rows = mergeTaskbarRows(local, [sharedTask()] as any, [job({ id: "sr-1", type: "site_recovery", status: "success" })])
    expect(rows.map(r => r.id).sort()).toEqual(["job-sr-1", "migration-mig-1", "upload-1"])
  })

  it("keeps the shared row for a migration the jobs endpoint also returns", () => {
    const rows = mergeTaskbarRows([], [sharedTask()] as any, [
      job({ id: "mig-1", type: "migration", name: "Migration - srv-app", status: "transferring" }),
    ])
    expect(rows).toHaveLength(1)
    const row = rows[0]
    expect(row.id).toBe("migration-mig-1")
    // The shared row's richer shape survived: initiator, own detail, no
    // orchestrator flag (so a click still opens the migration dialog).
    expect(row.startedByName).toBe("Alice")
    expect(row.detail).toBe("disk 1/2")
    expect(row.orchestrator).toBeUndefined()
  })

  it("shows an older migration the shared window no longer returns", () => {
    const rows = mergeTaskbarRows([], [], [
      job({ id: "mig-old", type: "migration", name: "Migration - NginX", status: "completed", startedAt: minutesAgo(60 * 96) }),
    ])
    expect(rows.map(r => r.id)).toEqual(["migration-mig-old"])
    expect(rows[0].orchestrator).toBe(true)
  })

  it("sorts running rows first, then most recent first", () => {
    const rows = mergeTaskbarRows([], [], [
      job({ id: "old-done", status: "success", startedAt: minutesAgo(600) }),
      job({ id: "recent-done", status: "success", startedAt: minutesAgo(10) }),
      job({ id: "live", status: "running", startedAt: minutesAgo(900) }),
    ])
    expect(rows.map(r => r.id)).toEqual(["job-live", "job-recent-done", "job-old-done"])
  })
})
