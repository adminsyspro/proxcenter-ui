/**
 * #767: the Task Center posted every action to the rolling-updates routes
 * whatever the job type, so the Cancel button shown on a DRS, replication or
 * migration job hit the wrong endpoint. These tests pin the per-type routing
 * and the log normalisation between the two log shapes in the product.
 */
import { afterEach, describe, expect, it, vi } from "vitest"

import {
  extractLogs,
  jobActionPermission,
  jobActionRequest,
  jobActions,
  jobActionUrl,
  jobDetailUrl,
  normalizeLog,
  pveTaskStopUrl,
  runJobAction,
  runPveTaskStop,
  syntheticLogs,
} from "./jobActions"

const migration = (over: Record<string, any> = {}) => ({
  id: "mig-1",
  type: "migration",
  status: "running",
  metadata: { cancellable: true, ...(over.metadata ?? {}) },
  ...over,
})

const drs = (over: Record<string, any> = {}) => ({
  id: "d-1",
  type: "drs",
  status: "running",
  metadata: {
    connectionId: "c1",
    taskId: "UPID:pve3:0000ABCD:001:qmigrate:100:root@pam:",
    sourceNode: "pve1",
    ...(over.metadata ?? {}),
  },
  ...over,
})

const DRS_TASK_URL = "/api/v1/tasks/c1/pve3/UPID%3Apve3%3A0000ABCD%3A001%3Aqmigrate%3A100%3Aroot%40pam%3A"

describe("jobDetailUrl", () => {
  it("routes a rolling update to the orchestrator detail", () => {
    expect(jobDetailUrl({ id: "ru-1", type: "rolling_update" })).toBe(
      "/api/v1/orchestrator/rolling-updates/ru-1",
    )
  })

  it("routes a migration to the tasks.view-gated shared detail, not /api/v1/migrations", () => {
    // history=1 lifts the footer's 30-minute window: the Task Center lists the
    // full history, so an old finished job must still return its logs.
    expect(jobDetailUrl(migration())).toBe("/api/v1/tasks/shared/mig-1?history=1")
  })

  it("routes a replication job to the orchestrator log route", () => {
    expect(jobDetailUrl({ id: "r-1", type: "replication" })).toBe(
      "/api/v1/orchestrator/replication/jobs/r-1/logs",
    )
  })

  it("routes a DRS migration to the PVE task log, taking the node from the UPID", () => {
    const drs = {
      id: "d-1",
      type: "drs",
      metadata: { connectionId: "c1", taskId: "UPID:pve3:0000ABCD:001:qmigrate:100:root@pam:", sourceNode: "pve1" },
    }
    expect(jobDetailUrl(drs)).toBe(
      "/api/v1/tasks/c1/pve3/UPID%3Apve3%3A0000ABCD%3A001%3Aqmigrate%3A100%3Aroot%40pam%3A",
    )
  })

  it("falls back to the recorded source node when the UPID is not parseable", () => {
    const drs = { id: "d-1", type: "drs", metadata: { connectionId: "c1", taskId: "weird", sourceNode: "pve1" } }
    expect(jobDetailUrl(drs)).toBe("/api/v1/tasks/c1/pve1/weird")
  })

  it("has no detail endpoint for a DRS row without a task id, nor for Site Recovery", () => {
    expect(jobDetailUrl({ id: "d-1", type: "drs", metadata: { connectionId: "c1" } })).toBeNull()
    expect(jobDetailUrl({ id: "d-2", type: "drs", metadata: { taskId: "UPID:pve1:x" } })).toBeNull()
    // A RecoveryExecution has no log column: syntheticLogs covers it instead.
    expect(jobDetailUrl({ id: "sr-1", type: "site_recovery" })).toBeNull()
  })

  it("returns null without an id", () => {
    expect(jobDetailUrl(null)).toBeNull()
    expect(jobDetailUrl({ type: "rolling_update" })).toBeNull()
  })
})

describe("jobActions", () => {
  it("offers pause/cancel on a running rolling update and resume/cancel when paused", () => {
    expect(jobActions({ id: "ru-1", type: "rolling_update", status: "running" })).toEqual(["pause", "cancel"])
    expect(jobActions({ id: "ru-1", type: "rolling_update", status: "paused" })).toEqual(["resume", "cancel"])
    // Paused for a manual approval: the operator approves, they do not resume.
    expect(
      jobActions({ id: "ru-1", type: "rolling_update", status: "paused", metadata: { pendingApproval: "pve2" } }),
    ).toEqual(["approve", "cancel"])
    expect(jobActions({ id: "ru-1", type: "rolling_update", status: "success" })).toEqual([])
  })

  it("offers cancel on an in-flight migration only", () => {
    expect(jobActions(migration())).toEqual(["cancel"])
    expect(jobActions(migration({ status: "success", metadata: { cancellable: false } }))).toEqual([])
    // No metadata at all (older payload) must not offer a cancel that 400s.
    expect(jobActions({ id: "mig-2", type: "migration", status: "running" })).toEqual([])
  })

  it("offers nothing for a job that is not running, and nothing at all without one", () => {
    expect(jobActions({ id: "r-1", type: "replication", status: "paused" })).toEqual([])
    expect(jobActions({ id: "sr-1", type: "site_recovery", status: "success" })).toEqual([])
    expect(jobActions(null)).toEqual([])
  })

  // #974 lot 3: the orchestrator grew the two routes these types had never
  // had, so a running replication run and a running recovery execution now
  // offer a stop like everything else in the list.
  it("offers cancel on a replication run and on a Site Recovery execution in flight", () => {
    expect(jobActions({ id: "r-1", type: "replication", status: "running" })).toEqual(["cancel"])
    expect(jobActions({ id: "sr-1", type: "site_recovery", status: "running" })).toEqual(["cancel"])
  })

  // #974: the work of a DRS migration is a qmigrate on the node, so the stop
  // that counts is the PVE task, and it exists as soon as the row carries the
  // UPID the orchestrator recorded.
  it("offers cancel on a running DRS migration that carries its PVE task", () => {
    expect(jobActions(drs())).toEqual(["cancel"])
  })

  it("offers no DRS cancel once the migration is over, or without its UPID", () => {
    expect(jobActions(drs({ status: "success" }))).toEqual([])
    expect(jobActions({ id: "d-1", type: "drs", status: "running" })).toEqual([])
    expect(jobActions({ id: "d-1", type: "drs", status: "running", metadata: { connectionId: "c1" } })).toEqual([])
  })
})

describe("jobActionUrl", () => {
  it("keeps rolling updates on the orchestrator route", () => {
    expect(jobActionUrl({ id: "ru-1", type: "rolling_update" }, "pause")).toBe(
      "/api/v1/orchestrator/rolling-updates/ru-1/pause",
    )
    expect(jobActionUrl({ id: "ru-1", type: "rolling_update" }, "approve")).toBe(
      "/api/v1/orchestrator/rolling-updates/ru-1/approve",
    )
    expect(jobActionUrl({ id: "ru-1", type: "rolling_update" }, "cancel")).toBe(
      "/api/v1/orchestrator/rolling-updates/ru-1/cancel",
    )
  })

  it("cancels a migration through /api/v1/migrations, and supports nothing else", () => {
    expect(jobActionUrl(migration(), "cancel")).toBe("/api/v1/migrations/mig-1/cancel")
    expect(jobActionUrl(migration(), "pause")).toBeNull()
    expect(jobActionUrl(migration(), "resume")).toBeNull()
  })

  it("never invents an endpoint for a type that has none", () => {
    expect(jobActionUrl({ id: "d-1", type: "drs" }, "cancel")).toBeNull()
    expect(jobActionUrl({ id: "sr-1", type: "site_recovery" }, "pause")).toBeNull()
    expect(jobActionUrl(null, "cancel")).toBeNull()
  })
})

describe("jobActionRequest", () => {
  it("posts every orchestrator action", () => {
    expect(jobActionRequest({ id: "ru-1", type: "rolling_update" }, "pause")).toEqual({
      url: "/api/v1/orchestrator/rolling-updates/ru-1/pause",
      method: "POST",
    })
    expect(jobActionRequest(migration(), "cancel")).toEqual({
      url: "/api/v1/migrations/mig-1/cancel",
      method: "POST",
    })
  })

  // The one action that is not a POST: stopping a DRS migration means deleting
  // the PVE task, since the orchestrator only polls it.
  it("deletes the PVE task to stop a DRS migration", () => {
    expect(jobActionRequest(drs(), "cancel")).toEqual({ url: DRS_TASK_URL, method: "DELETE" })
    expect(jobActionRequest(drs({ metadata: { taskId: null } }), "cancel")).toBeNull()
    expect(jobActionRequest(drs(), "pause")).toBeNull()
  })

  it("routes a replication run and a recovery execution to their own cancel routes", () => {
    expect(jobActionRequest({ id: "r-1", type: "replication", status: "running" }, "cancel")).toEqual({
      url: "/api/v1/orchestrator/replication/jobs/r-1/cancel",
      method: "POST",
    })
    // A site_recovery row carries the EXECUTION id, which is what the
    // orchestrator's cancel route addresses (not the plan id).
    expect(jobActionRequest({ id: "exec-1", type: "site_recovery", status: "running" }, "cancel")).toEqual({
      url: "/api/v1/orchestrator/replication/executions/exec-1/cancel",
      method: "POST",
    })
  })
})

describe("jobActionPermission", () => {
  // The three cancel routes do not enforce the same permission, and a row that
  // shows a button the route will answer 403 to is worse than no button.
  it("names the permission each cancel route enforces", () => {
    expect(jobActionPermission({ id: "ru-1", type: "rolling_update" })).toBe("automation.execute")
    expect(jobActionPermission(migration())).toBe("vm.migrate")
    expect(jobActionPermission(drs())).toBe("node.manage")
  })

  it("gates both orchestrator-owned types on automation.manage", () => {
    expect(jobActionPermission({ id: "r-1", type: "replication" })).toBe("automation.manage")
    expect(jobActionPermission({ id: "sr-1", type: "site_recovery" })).toBe("automation.manage")
  })

  it("has nothing to gate on a row that carries no type", () => {
    expect(jobActionPermission({ id: "x-1" })).toBeNull()
    expect(jobActionPermission(null)).toBeNull()
  })
})

describe("pveTaskStopUrl", () => {
  it("encodes the three segments of a task address", () => {
    expect(pveTaskStopUrl("c1", "pve3", "UPID:pve3:0000ABCD:001:qmigrate:100:root@pam:")).toBe(DRS_TASK_URL)
  })

  it("returns null as soon as one segment is missing", () => {
    expect(pveTaskStopUrl(null, "pve3", "UPID:pve3:x")).toBeNull()
    expect(pveTaskStopUrl("c1", null, "UPID:pve3:x")).toBeNull()
    expect(pveTaskStopUrl("c1", "pve3", null)).toBeNull()
  })
})

describe("extractLogs", () => {
  it("reads {data:{logs}} (rolling updates, migrations)", () => {
    expect(extractLogs({ data: { logs: [{ msg: "a" }] } })).toEqual([{ msg: "a" }])
  })

  it("reads {logs} (PVE task)", () => {
    expect(extractLogs({ upid: "UPID:pve1:x", logs: [{ n: 1, t: "line" }] })).toEqual([{ n: 1, t: "line" }])
  })

  it("reads a bare array and {data:[...]} (replication log route)", () => {
    expect(extractLogs([{ message: "a" }])).toEqual([{ message: "a" }])
    expect(extractLogs({ data: [{ message: "b" }] })).toEqual([{ message: "b" }])
  })

  it("returns an empty array for anything else", () => {
    expect(extractLogs(null)).toEqual([])
    expect(extractLogs({ data: { logs: "nope" } })).toEqual([])
    expect(extractLogs({ error: "Not found" })).toEqual([])
  })
})

describe("syntheticLogs", () => {
  const execution = (vmResults: any[]) => ({ id: "sr-1", type: "site_recovery", metadata: { vmResults } })

  it("turns per-VM results into one line each, coloured by outcome", () => {
    const out = syntheticLogs(
      execution([
        { vm_name: "web-01", status: "completed", target_node: "pve2", target_vmid: 70004, restore_point: "snap-1" },
        { vm_name: "db-01", status: "failed", target_node: "pve2", error: "timeout waiting for boot" },
      ]),
    )
    expect(out).toEqual([
      { node: "web-01", message: "completed on pve2 (VMID 70004), restore point snap-1", level: "success" },
      { node: "db-01", message: "failed on pve2: timeout waiting for boot", level: "error" },
    ])
  })

  it("names a VM with no name by its id and keeps a running VM neutral", () => {
    expect(syntheticLogs(execution([{ vm_id: 101, status: "running", step: "restoring" }]))).toEqual([
      { node: "VM 101", message: "running, step restoring", level: "info" },
    ])
  })

  it("stays empty for every other type and for a row without results", () => {
    expect(syntheticLogs({ id: "ru-1", type: "rolling_update", metadata: { vmResults: [{}] } })).toEqual([])
    expect(syntheticLogs({ id: "sr-1", type: "site_recovery" })).toEqual([])
    expect(syntheticLogs({ id: "sr-1", type: "site_recovery", metadata: { vmResults: null } })).toEqual([])
    expect(syntheticLogs(null)).toEqual([])
  })
})

describe("normalizeLog", () => {
  it("keeps the rolling-update shape", () => {
    expect(normalizeLog({ timestamp: "2026-08-24T10:00:00Z", node: "pve1", message: "hello", level: "error" })).toEqual({
      timestamp: "2026-08-24T10:00:00Z",
      node: "pve1",
      message: "hello",
      level: "error",
    })
  })

  it("maps the migration pipeline shape {ts,msg}", () => {
    expect(normalizeLog({ ts: "2026-08-24T10:00:00Z", msg: "disk 1/2 copied", level: "success" })).toEqual({
      timestamp: "2026-08-24T10:00:00Z",
      node: null,
      message: "disk 1/2 copied",
      level: "success",
    })
  })

  it("maps the replication shape {created_at,message,vmid}", () => {
    expect(normalizeLog({ created_at: "2026-08-24T10:00:00Z", message: "synced", level: "info", vmid: 101 })).toEqual({
      timestamp: "2026-08-24T10:00:00Z",
      node: "VM 101",
      message: "synced",
      level: "info",
    })
  })

  it("maps a PVE task line {n,t}, which carries no timestamp", () => {
    expect(normalizeLog({ n: 12, t: "migration status: completed" })).toEqual({
      timestamp: null,
      node: null,
      message: "migration status: completed",
      level: "info",
    })
  })

  it("survives a bare string and a malformed entry", () => {
    expect(normalizeLog("raw line")).toEqual({ timestamp: null, node: null, message: "raw line", level: "info" })
    expect(normalizeLog(null)).toEqual({ timestamp: null, node: null, message: "", level: "info" })
  })
})

describe("runJobAction and runPveTaskStop", () => {
  afterEach(() => { vi.unstubAllGlobals() })

  const stubFetch = (response: any) => {
    const fetchMock = vi.fn(async () => response)
    vi.stubGlobal("fetch", fetchMock)

    return fetchMock
  }

  it("sends the verb the route expects: POST for a migration, DELETE for a DRS task", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({}) })

    expect(await runJobAction(migration(), "cancel")).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenLastCalledWith("/api/v1/migrations/mig-1/cancel", { method: "POST" })

    expect(await runJobAction(drs(), "cancel")).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenLastCalledWith(DRS_TASK_URL, { method: "DELETE" })
  })

  it("reports the server's refusal instead of failing silently", async () => {
    stubFetch({ ok: false, json: async () => ({ error: "Forbidden" }) })

    expect(await runJobAction(migration(), "cancel")).toEqual({ ok: false, error: "Forbidden" })
    expect(await runPveTaskStop("c1", "pve3", "UPID:pve3:x")).toEqual({ ok: false, error: "Forbidden" })
  })

  it("refuses to call anything it cannot address", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({}) })

    expect((await runJobAction({ id: "x-1", type: "not_a_job_type" }, "cancel")).ok).toBe(false)
    expect((await runPveTaskStop("c1", null, "UPID:pve3:x")).ok).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("deletes the task a Proxmox row points at", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({}) })

    expect(await runPveTaskStop("c1", "pve3", "UPID:pve3:0000ABCD:001:qmigrate:100:root@pam:")).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(DRS_TASK_URL, { method: "DELETE" })
  })
})
