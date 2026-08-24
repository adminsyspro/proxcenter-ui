/**
 * Task 15 (security): GET /api/v1/orchestrator/jobs used to build its
 * connection perimeter from getSessionPrisma() -- empty for iaas tenants
 * (provider-pool connections reached only via vDC binding), under-inclusive
 * for the provider (excludes MSP-owned connections) -- and, worse, treated
 * a job with NO connectionId/sourceCluster/targetCluster as "no key = pass"
 * instead of denying it. These tests pin the corrected behaviour: provider
 * fleet view unchanged, iaas perimeter follows the narrowed vDC view
 * context (not the wider tenant union), msp uses its owned-connection
 * union, and any job carrying no linkage at all is excluded for everyone
 * except the provider.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { getInfraMock, getCurrentTenantIdMock, tenantConnectionIdsMock, findManyMock, migrationFindManyMock } = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
  findManyMock: vi.fn(),
  migrationFindManyMock: vi.fn(),
}))

// Keep the real maskingScope (pure function); only stub the scope resolver.
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

// getSessionPrisma / DEFAULT_TENANT_ID are unused by the route itself but are
// imported at module scope by @/lib/tasks/sharedTask (sourceTypeLabel,
// TERMINAL_STATUSES), and a partial factory makes those imports throw.
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: (...a: any[]) => getCurrentTenantIdMock(...a),
  getTenantConnectionIds: (...a: any[]) => tenantConnectionIdsMock(...a),
  getSessionPrisma: vi.fn(),
  DEFAULT_TENANT_ID: "default",
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findMany: (...a: any[]) => findManyMock(...a) },
    migrationJob: { findMany: (...a: any[]) => migrationFindManyMock(...a) },
  },
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { TASKS_VIEW: "tasks.view" },
}))

vi.mock("@/lib/orchestrator/headers", () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => extra,
}))

const ALL_CONNS = [
  { id: "c1", name: "cluster-1", baseUrl: "https://pve1.example.com:8006" },
  { id: "c2", name: "cluster-2", baseUrl: "https://pve2.example.com:8006" },
]

findManyMock.mockImplementation(async ({ where }: any) => {
  const ids: string[] = where?.id?.in ?? []
  return ALL_CONNS.filter(c => ids.includes(c.id))
})

const ROLLING_UPDATES = [
  { id: "ru-c1", connection_id: "c1", status: "running", total_nodes: 2, completed_nodes: 1, started_at: "2026-01-01T00:00:00Z" },
  { id: "ru-c2", connection_id: "c2", status: "running", total_nodes: 2, completed_nodes: 1, started_at: "2026-01-01T00:00:00Z" },
  // No connection_id at all -- must be denied for every non-provider caller.
  { id: "ru-none", status: "running", total_nodes: 1, completed_nodes: 0, started_at: "2026-01-01T00:00:00Z" },
]
const DRS_MIGRATIONS = [
  { id: "dm-c1", connection_id: "c1", vmid: 100, vm_name: "vm1", status: "completed", started_at: "2026-01-01T00:00:00Z" },
]

// External hypervisor -> Proxmox migrations live in our DB, not the
// orchestrator (#767). Row shape mirrors the MigrationJob model.
const migrationRow = (over: Record<string, any> = {}) => ({
  id: "mig-c1",
  sourceConnectionId: "vmw-1",
  sourceVmId: "vm-42",
  sourceVmName: "srv-app",
  sourceHost: "esxi-1.lab",
  targetConnectionId: "c1",
  targetNode: "pve-node-01",
  targetVmid: 210,
  config: { sourceType: "vcenter" },
  status: "transferring",
  currentStep: "disk 1/2",
  progress: 42,
  totalDisks: 2,
  currentDisk: 1,
  transferSpeed: "180 MiB/s",
  error: null,
  startedAt: new Date("2026-01-02T00:00:00Z"),
  completedAt: null,
  createdAt: new Date("2026-01-02T00:00:00Z"),
  ...over,
})

const MIGRATION_JOBS = [migrationRow(), migrationRow({ id: "mig-c2", targetConnectionId: "c2" })]

const fetchMock = vi.fn(async (url: string) => {
  if (url.includes("/rolling-updates")) return { ok: true, json: async () => ({ data: ROLLING_UPDATES }) }
  if (url.includes("/drs/migrations")) return { ok: true, json: async () => ({ data: DRS_MIGRATIONS }) }
  return { ok: true, json: async () => ({ data: [] }) }
})
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("/rolling-updates")) return { ok: true, json: async () => ({ data: ROLLING_UPDATES }) }
    if (url.includes("/drs/migrations")) return { ok: true, json: async () => ({ data: DRS_MIGRATIONS }) }
    return { ok: true, json: async () => ({ data: [] }) }
  })
  findManyMock.mockImplementation(async ({ where }: any) => {
    const ids: string[] = where?.id?.in ?? []
    return ALL_CONNS.filter(c => ids.includes(c.id))
  })
  // Honour the route's where clause the way Postgres would: no clause means
  // the whole fleet, a targetConnectionId filter narrows to the perimeter.
  migrationFindManyMock.mockImplementation(async ({ where }: any) => {
    const ids: string[] | undefined = where?.targetConnectionId?.in
    return ids ? MIGRATION_JOBS.filter(j => ids.includes(j.targetConnectionId)) : MIGRATION_JOBS
  })
})

describe("GET /api/v1/orchestrator/jobs — tenant scoping", () => {
  it("provider: sees the whole fleet, including a job with no connection linkage", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    getInfraMock.mockResolvedValue({ kind: "provider" })
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((j: any) => j.id)
    expect(ids).toContain("ru-c1")
    expect(ids).toContain("ru-c2")
    expect(ids).toContain("ru-none")
    expect(ids).toContain("dm-c1")
  })

  it("iaas: perimeter follows the narrowed vDC view context, not the wider tenant union; unlinked job denied", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    // Union spans c1+c2 (two vDCs on shared clusters), but the active vDC
    // view context only narrows to c1.
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))
    getInfraMock.mockResolvedValue({
      kind: "iaas",
      vdcScope: { connectionIds: new Set(["c1"]) },
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((j: any) => j.id)
    expect(ids).toContain("ru-c1")
    expect(ids).toContain("dm-c1")
    expect(ids).not.toContain("ru-c2")
    expect(ids).not.toContain("ru-none")
  })

  it("iaas: a multi-cluster job with one endpoint outside the perimeter is hidden entirely", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))
    getInfraMock.mockResolvedValue({
      kind: "iaas",
      vdcScope: { connectionIds: new Set(["c1"]) },
    })

    // Site Recovery plan replicating from the tenant's cluster (c1) to a
    // provider DR cluster outside their perimeter: with refs.some() the job
    // leaked the foreign cluster's name and per-VM results.
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/replication/plans") && url.includes("/history")) {
        return { ok: true, json: async () => ({ data: [{ id: "exec-1", type: "failover", status: "completed", started_at: "2026-01-01T00:00:00Z", vm_results: [] }] }) }
      }
      if (url.includes("/replication/plans")) {
        return { ok: true, json: async () => ({ data: [{ id: "plan-1", name: "dr-plan", source_cluster: "c1", target_cluster: "c-provider-dr", last_failover: "2026-01-01T00:00:00Z" }] }) }
      }
      return { ok: true, json: async () => ({ data: [] }) }
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.map((j: any) => j.id)).not.toContain("exec-1")
  })

  it("provider: the same multi-cluster job stays visible in the fleet view", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    getInfraMock.mockResolvedValue({ kind: "provider" })
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))

    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes("/replication/plans") && url.includes("/history")) {
        return { ok: true, json: async () => ({ data: [{ id: "exec-1", type: "failover", status: "completed", started_at: "2026-01-01T00:00:00Z", vm_results: [] }] }) }
      }
      if (url.includes("/replication/plans")) {
        return { ok: true, json: async () => ({ data: [{ id: "plan-1", name: "dr-plan", source_cluster: "c1", target_cluster: "c-provider-dr", last_failover: "2026-01-01T00:00:00Z" }] }) }
      }
      return { ok: true, json: async () => ({ data: [] }) }
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.map((j: any) => j.id)).toContain("exec-1")

    // A failover/failback/test is Site Recovery, not maintenance, and a
    // cluster id that resolves to no connection is named as deleted instead of
    // being printed as a bare cuid.
    const exec = body.data.find((j: any) => j.id === "exec-1")
    expect(exec.type).toBe("site_recovery")
    expect(exec.name).toBe("Failover - dr-plan")
    expect(exec.target).toBe("pve1.example.com")
    expect(exec.detail).toBe("pve1.example.com → Deleted connection (c-provid) (0 VMs)")
  })

  it("provider: external migrations are listed, with the fleet query unfiltered", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    getInfraMock.mockResolvedValue({ kind: "provider" })
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const mig = body.data.find((j: any) => j.id === "mig-c1")
    expect(mig).toBeDefined()
    expect(mig.type).toBe("migration")
    // A pipeline step is neither queued nor terminal: it must read as running.
    expect(mig.status).toBe("running")
    expect(mig.progress).toBe(42)
    expect(mig.name).toBe("Migration - srv-app")
    expect(mig.target).toBe("pve1.example.com")
    expect(mig.detail).toBe("vCenter → pve-node-01 (VMID 210) • disk 1/2")
    expect(mig.metadata.cancellable).toBe(true)
    expect(body.data.map((j: any) => j.id)).toContain("mig-c2")
    expect(migrationFindManyMock.mock.calls[0][0].where).toEqual({})
  })

  it("iaas: a migration landing outside the vDC perimeter is not listed", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-a")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))
    getInfraMock.mockResolvedValue({
      kind: "iaas",
      vdcScope: { connectionIds: new Set(["c1"]) },
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((j: any) => j.id)
    // Scoped on the target cluster only: the source is an external hypervisor
    // connection a vDC tenant never owns, so requiring it too would hide every
    // migration from them.
    expect(ids).toContain("mig-c1")
    expect(ids).not.toContain("mig-c2")
    expect(migrationFindManyMock.mock.calls[0][0].where).toEqual({ targetConnectionId: { in: ["c1"] } })
  })

  it("maps every terminal migration status and never offers cancel on one", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    getInfraMock.mockResolvedValue({ kind: "provider" })
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    migrationFindManyMock.mockResolvedValue([
      migrationRow({ id: "m-done", status: "completed", progress: 100, completedAt: new Date("2026-01-02T01:00:00Z") }),
      migrationRow({ id: "m-fail", status: "failed", error: "boom" }),
      migrationRow({ id: "m-cancel", status: "cancelled" }),
      migrationRow({ id: "m-queued", status: "pending", progress: 0 }),
      migrationRow({ id: "m-warm", status: "delta_sync" }),
    ])

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    const body = await res.json()
    const byId = new Map<string, any>(body.data.map((j: any) => [j.id, j] as [string, any]))

    expect(byId.get("m-done").status).toBe("success")
    expect(byId.get("m-fail").status).toBe("failed")
    expect(byId.get("m-fail").metadata.error).toBe("boom")
    expect(byId.get("m-cancel").status).toBe("cancelled")
    expect(byId.get("m-queued").status).toBe("pending")
    expect(byId.get("m-warm").status).toBe("running")

    for (const id of ["m-done", "m-fail", "m-cancel"]) {
      expect(byId.get(id).metadata.cancellable).toBe(false)
    }
    expect(byId.get("m-warm").metadata.cancellable).toBe(true)

    // currentStep repeats the status on a finished job: don't echo it.
    expect(byId.get("m-done").detail).toBe("vCenter → pve-node-01 (VMID 210)")
    expect(byId.get("m-warm").detail).toBe("vCenter → pve-node-01 (VMID 210) • disk 1/2")

    // Stats must count them like any other job.
    expect(body.stats.total).toBeGreaterThanOrEqual(5)
    expect(body.stats.failed).toBeGreaterThanOrEqual(2) // failed + cancelled
  })

  it("a database error on the migration query does not break the rest of the page", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    getInfraMock.mockResolvedValue({ kind: "provider" })
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))
    migrationFindManyMock.mockRejectedValue(new Error("relation does not exist"))

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data.map((j: any) => j.id)).toContain("ru-c1")
    expect(body.data.some((j: any) => j.type === "migration")).toBe(false)
  })

  it("msp: perimeter uses the owned-connection union (no vDC narrowing)", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-msp")
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)

    const body = await res.json()
    const ids = body.data.map((j: any) => j.id)
    expect(ids).toContain("ru-c1")
    expect(ids).not.toContain("ru-c2")
    expect(ids).not.toContain("ru-none")
  })
})
