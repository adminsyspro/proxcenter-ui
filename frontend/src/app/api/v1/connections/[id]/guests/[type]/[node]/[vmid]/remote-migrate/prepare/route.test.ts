import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, deniedPermissionResponse } from "@/__tests__/setup/route-test"

const {
  pveFetchMock, getConnectionByIdMock, checkPermissionMock,
  getCurrentTenantIdMock, getInfraMock, canMigrateConnectionsMock, auditMock,
} = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  getInfraMock: vi.fn(),
  canMigrateConnectionsMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: (...a: any[]) => getConnectionByIdMock(...a) }))
vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}/${node}/${type}/${vmid}`,
  PERMISSIONS: { VM_MIGRATE: "vm.migrate", VM_SNAPSHOT: "vm.snapshot", NODE_MANAGE: "node.manage" },
}))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: (...a: any[]) => getCurrentTenantIdMock(...a) }))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
  canMigrateConnections: (...a: any[]) => canMigrateConnectionsMock(...a),
}))
vi.mock("@/lib/audit", () => ({ audit: (...a: any[]) => auditMock(...a) }))

import { POST } from "./route"

const PARAMS = { id: "conn-src", type: "qemu", node: "pve1", vmid: "100" }
const CONN = { id: "conn-src", baseUrl: "https://source:8006", apiToken: "token" }
const HA = { sid: "vm:100", state: "started", group: "source-ha", max_restart: "3", max_relocate: 2, failback: 0, "auto-rebalance": 1 }
const JOB = { id: "100-4", guest: 100, target: "pve3", schedule: "*/15", rate: "5", comment: "source job", disable: 0 }
const CAPTURE = {
  ha: { sid: "vm:100", state: "started", group: "source-ha", maxRestart: 3, maxRelocate: 2, failback: 0, autoRebalance: 1 },
  replication: [{ ...JOB, rate: 5 }],
  snapshotsDeleted: [],
}
const ALL_ACTIONS = { removeHa: true, removeReplication: true, removeSnapshots: ["snap1"] }

function wirePveFetch(opts: {
  remaining?: boolean
  snapshotFailure?: string
  replicationDeleteFailure?: string
  captureError?: string
  haMissing?: boolean
  jobs?: any[]
} = {}) {
  let replicationReads = 0
  pveFetchMock.mockImplementation(async (_conn: any, path: string, init?: { method?: string }) => {
    const method = init?.method || "GET"
    if (method === "DELETE") {
      if (path.endsWith(`/snapshot/${opts.snapshotFailure}`)) throw new Error("snapshot deletion failed")
      if (path.endsWith(`/replication/${opts.replicationDeleteFailure}`)) throw new Error("replication deletion failed")
      return path.includes("/snapshot/") ? `UPID:${path.split("/").pop()}` : undefined
    }
    if (path === "/cluster/ha/resources/vm%3A100") {
      if (opts.captureError === "ha") throw new Error("HA capture failed")
      if (opts.haMissing) throw new Error("PVE 404")
      return { ...HA }
    }
    if (path === "/cluster/replication") {
      if (opts.captureError === "replication") throw new Error("replication capture failed")
      replicationReads++
      return replicationReads === 1 || opts.remaining ? (opts.jobs || [{ ...JOB }]) : []
    }
    if (path.endsWith("/snapshot")) return [{ name: "current" }, { name: "snap1" }, { name: "snap2" }, { name: "snap3" }]
    if (path.includes("/tasks/")) return { status: "stopped", exitstatus: "OK" }
    throw new Error(`Unexpected PVE call: ${method} ${path}`)
  })
}

function prepare(body: Record<string, unknown> = ALL_ACTIONS, params = PARAMS) {
  return callRoute(POST, { method: "POST", params, body })
}

function deletes() {
  return pveFetchMock.mock.calls.filter(([, , init]) => init?.method === "DELETE")
}

beforeEach(() => {
  vi.resetAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getConnectionByIdMock.mockResolvedValue(CONN)
  getCurrentTenantIdMock.mockResolvedValue("tenant-1")
  getInfraMock.mockResolvedValue({ kind: "provider" })
  canMigrateConnectionsMock.mockReturnValue(true)
  auditMock.mockResolvedValue(undefined)
  wirePveFetch()
})

afterEach(() => { vi.useRealTimers() })

describe("POST .../remote-migrate/prepare", () => {
  it("rejects non-qemu guests before permissions or PVE access", async () => {
    const res = await prepare(ALL_ACTIONS, { ...PARAMS, type: "lxc" })
    expect(res.status).toBe(400)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it.each([{ vmid: "100;bad" }, { node: "pve1/bad" }])("rejects invalid route parameters: %s", async params => {
    const res = await prepare(ALL_ACTIONS, { ...PARAMS, ...params })
    expect(res.status).toBe(400)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("rejects a tenant without migration scope", async () => {
    canMigrateConnectionsMock.mockReturnValue(false)
    const res = await prepare()
    expect(res.status).toBe(403)
    expect(getCurrentTenantIdMock).toHaveBeenCalledOnce()
    expect(getInfraMock).toHaveBeenCalledWith("tenant-1")
    expect(canMigrateConnectionsMock).toHaveBeenCalledWith({ kind: "provider" }, PARAMS.id)
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it.each(["vm.migrate", "vm.snapshot", "node.manage"])("requires permission %s before any PVE access", async permission => {
    checkPermissionMock.mockImplementation(async requested => requested === permission ? deniedPermissionResponse() : null)
    const res = await prepare()
    expect(res.status).toBe(403)
    expect(checkPermissionMock.mock.calls.map(([requested]) => requested)).toEqual(
      ["vm.migrate", "vm.snapshot", "node.manage"].slice(0, ["vm.migrate", "vm.snapshot", "node.manage"].indexOf(permission) + 1),
    )
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("checks permissions in migration, snapshot, cluster order", async () => {
    const res = await prepare()
    expect(res.status).toBe(200)
    expect(checkPermissionMock.mock.calls).toEqual([
      ["vm.migrate", "vm", "conn-src/pve1/qemu/100"],
      ["vm.snapshot", "vm", "conn-src/pve1/qemu/100"],
      ["node.manage", "connection", "conn-src"],
    ])
  })

  it.each(["absent", "current"])("rejects snapshot %s before any destructive call", async name => {
    const res = await prepare({ ...ALL_ACTIONS, removeSnapshots: ["snap1", name] })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain(name)
    expect(deletes()).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
  })

  it.each([
    { removeSnapshots: "snap1" }, { removeSnapshots: [123] },
    { removeHa: "true" }, { removeReplication: 1 },
  ])("rejects malformed removal requests: %s", async body => {
    const res = await prepare(body)
    expect(res.status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("captures both configs before deleting, deletes snapshots before polling, and returns the capture", async () => {
    const res = await prepare()
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(pveFetchMock.mock.calls.map(([, path, init]) => `${init?.method || "GET"} ${path}`)).toEqual([
      "GET /cluster/ha/resources/vm%3A100",
      "GET /cluster/replication",
      "GET /nodes/pve1/qemu/100/snapshot",
      "DELETE /cluster/ha/resources/vm%3A100",
      "DELETE /cluster/replication/100-4",
      "DELETE /nodes/pve1/qemu/100/snapshot/snap1",
      "GET /nodes/pve1/tasks/UPID%3Asnap1/status",
      "GET /cluster/replication",
    ])
    expect(json).toEqual({
      success: true,
      capture: { ...CAPTURE, snapshotsDeleted: ["snap1"] },
      cleared: { ha: true, replicationJobs: ["100-4"], snapshots: ["snap1"] },
      pending: { replicationJobs: [] },
      warnings: [],
    })
    expect(deletes().every(([, , init]) => JSON.stringify(init) === JSON.stringify({ method: "DELETE" }))).toBe(true)
    expect(auditMock.mock.calls.map(([entry]) => entry)).toEqual([
      { action: "delete", category: "vms", resourceType: "qemu", resourceId: "100", details: { connectionId: "conn-src", node: "pve1", prerequisite: "ha", sid: "vm:100" } },
      { action: "delete", category: "vms", resourceType: "qemu", resourceId: "100", details: { connectionId: "conn-src", node: "pve1", prerequisite: "replication", jobId: "100-4" } },
      { action: "delete", category: "vms", resourceType: "qemu", resourceId: "100", details: { connectionId: "conn-src", node: "pve1", prerequisite: "snapshots", name: "snap1" } },
    ])
  })

  it("reports jobs still pending after the 150-second budget using fake time", async () => {
    vi.useFakeTimers()
    wirePveFetch({ remaining: true })
    const response = prepare({ removeReplication: true })
    await vi.advanceTimersByTimeAsync(150_000)
    const res = await response
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.pending.replicationJobs).toEqual(["100-4"])
    expect(json.warnings).toEqual([expect.stringMatching(/still removing replication job 100-4 in the background/)] )
    expect(json.capture).toEqual(CAPTURE)
  })

  it("preserves capture and partial deletions when a snapshot fails", async () => {
    wirePveFetch({ snapshotFailure: "snap2" })
    const res = await prepare({ ...ALL_ACTIONS, removeSnapshots: ["snap1", "snap2", "snap3"] })
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.error).toContain("snap2")
    expect(json.capture).toEqual({ ...CAPTURE, snapshotsDeleted: ["snap1"] })
    expect(json.cleared).toEqual({ ha: true, replicationJobs: ["100-4"], snapshots: ["snap1"] })
    expect(json.pending.replicationJobs).toEqual([])
    expect(deletes().map(([, path]) => path)).not.toContain("/nodes/pve1/qemu/100/snapshot/snap3")
    expect(auditMock).toHaveBeenCalledTimes(3)
  })

  it.each(["ha", "replication"])("never deletes anything if the %s capture fails", async captureError => {
    wirePveFetch({ captureError })
    const res = await prepare()
    expect(res.status).toBe(500)
    expect(deletes()).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
  })

  it("preserves capture and completed actions after a replication removal failure", async () => {
    wirePveFetch({ jobs: [JOB, { ...JOB, id: "100-5" }], replicationDeleteFailure: "100-5" })
    const res = await prepare()
    const json = await res.json()
    expect(res.status).toBe(500)
    expect(json.capture.replication.map((job: any) => job.id)).toEqual(["100-4", "100-5"])
    expect(json.cleared).toEqual({ ha: true, replicationJobs: ["100-4"], snapshots: [] })
    expect(json.pending.replicationJobs).toEqual(["100-4"])
    expect(auditMock).toHaveBeenCalledTimes(2)
  })

  it("does not delete or audit anything without explicit removal flags", async () => {
    const res = await prepare({})
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.capture).toEqual(CAPTURE)
    expect(deletes()).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
    expect(checkPermissionMock.mock.calls).toEqual([["vm.migrate", "vm", "conn-src/pve1/qemu/100"]])
  })

  it("skips absent HA and replication resources", async () => {
    wirePveFetch({ haMissing: true, jobs: [] })
    const res = await prepare({ removeHa: true, removeReplication: true })
    expect(res.status).toBe(200)
    expect((await res.json()).cleared).toEqual({ ha: false, replicationJobs: [], snapshots: [] })
    expect(deletes()).toEqual([])
    expect(auditMock).not.toHaveBeenCalled()
  })

  it("deduplicates explicitly selected snapshots without requiring cluster permission", async () => {
    const res = await prepare({ removeSnapshots: ["snap1", "snap1"] })
    expect(res.status).toBe(200)
    expect((await res.json()).cleared.snapshots).toEqual(["snap1"])
    expect(deletes()).toHaveLength(1)
    expect(auditMock).toHaveBeenCalledOnce()
    expect(checkPermissionMock.mock.calls.map(([permission]) => permission)).toEqual(["vm.migrate", "vm.snapshot"])
  })
})
