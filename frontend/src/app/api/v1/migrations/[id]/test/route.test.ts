import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  job: null as any,
  denied: null as any,
  tenant: "default",
  checks: [] as any[],
  deniedFor: null as string | null,
  pve: vi.fn(),
  requestTest: vi.fn(),
  requestStop: vi.fn(),
  prisma: { migrationJob: { findFirst: vi.fn(), update: vi.fn(async () => ({})) } },
}))

vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma), getCurrentTenantId: vi.fn(async () => h.tenant) }))
vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn(async (permission: string, ...rest: unknown[]) => {
    h.checks.push([permission, ...rest])
    if (permission === h.deniedFor) return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
    return h.denied
  }),
  PERMISSIONS: { VM_MIGRATE: "vm.migrate" },
}))
vi.mock("@/lib/migration/authorize", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/migration/authorize")>()),
  migrateScope: vi.fn(async () => null), scopedJobWhere: (where: object) => where,
}))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: vi.fn(async () => ({ id: "tc", baseUrl: "https://pve1:8006" })) }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: h.pve }))
vi.mock("@/lib/migration/warm/job-control", () => ({ requestWarmTest: h.requestTest, requestWarmTestStop: h.requestStop }))

import { DELETE, GET, POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const GiB = 1024 ** 3
const read = () => callRoute(GET, { method: "GET", params: { id: "j1" } })
const start = (body?: any) => callRoute(POST, { method: "POST", params: { id: "j1" }, body })
const stop = () => callRoute(DELETE, { method: "DELETE", params: { id: "j1" } })

beforeEach(() => {
  h.denied = null
  h.tenant = "default"
  h.checks = []
  h.deniedFor = null
  h.job = {
    id: "j1", status: "delta_sync", targetConnectionId: "tc", targetNode: "pve1", cutoverRequestedAt: null,
    testRequest: null, testStopRequestedAt: null, testState: null,
    config: { migrationType: "warm", cutoverMode: "manual" },
  }
  h.prisma.migrationJob.findFirst.mockReset().mockImplementation(async () => h.job)
  h.prisma.migrationJob.update.mockReset().mockResolvedValue({})
  h.requestTest.mockReset(); h.requestStop.mockReset()
  h.pve.mockReset().mockImplementation(async (_c: unknown, path: string) => {
    if (path === "/nodes/pve1/storage?content=images&enabled=1") return [
      { storage: "Dir-Images", type: "dir", avail: 27 * GiB },
      { storage: "R177-Thin", type: "lvmthin", avail: 180 * GiB },
      { storage: "nfs-test", type: "nfs", avail: 900 * GiB },
    ]
    if (path === "/nodes/pve1/network?type=any_bridge") return [{ iface: "vmbr1" }, { iface: "vmbr0" }]
    if (path === "/nodes/pve1/status") return { memory: { available: 12 * GiB } }
    return null
  })
})

describe("GET /api/v1/migrations/[id]/test", () => {
  it("offers the file storages of the target node, its bridges and its free RAM, with the test state", async () => {
    h.job.testState = { phase: "ended", reason: "stopped by the operator" }
    expect(await readJson<any>(await read())).toEqual({
      data: {
        state: { phase: "ended", reason: "stopped by the operator" },
        storages: [{ id: "Dir-Images", type: "dir", availBytes: 27 * GiB }, { id: "nfs-test", type: "nfs", availBytes: 900 * GiB }],
        bridges: ["vmbr0", "vmbr1"],
        nodeAvailableMemoryMB: 12288,
        maxSecChoices: [3600, 7200, 14400, 28800, 86400],
        maxSecDefault: 14400,
      },
    })
  })

  it("still answers when the node cannot be read", async () => {
    h.pve.mockRejectedValue(new Error("595 no route to host"))
    expect((await readJson<any>(await read())).data).toMatchObject({ storages: [], bridges: [], nodeAvailableMemoryMB: null })
  })

  it("answers 404 for a migration the caller cannot see, 403 without the right to migrate", async () => {
    h.job = null
    expect((await read()).status).toBe(404)
    h.denied = new Response(null, { status: 403 })
    expect((await read()).status).toBe(403)
  })
})

describe("POST /api/v1/migrations/[id]/test", () => {
  const body = { storage: "Dir-Images", bridge: null, vlanTag: null, maxSec: 14400 }

  it("records the request on the row, then signals the engine", async () => {
    const res = await start(body)
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { status: "test_requested" } })
    expect(h.prisma.migrationJob.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: { testRequest: body, testStopRequestedAt: null, testState: { phase: "requested", storage: "Dir-Images" } },
    })
    expect(h.requestTest).toHaveBeenCalledWith("j1")
    expect(h.prisma.migrationJob.update.mock.invocationCallOrder[0]).toBeLessThan(h.requestTest.mock.invocationCallOrder[0])
  })

  it("refuses an invalid request", async () => {
    const res = await start({ ...body, maxSec: 5 })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe("maxSec must be one of 3600, 7200, 14400, 28800, 86400")
    expect(h.requestTest).not.toHaveBeenCalled()
  })

  it("refuses a storage the target node does not offer for test disks", async () => {
    const res = await start({ ...body, storage: "R177-Thin" })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe('"R177-Thin" is not a file storage holding VM disks on pve1')
  })

  it("refuses a bridge the target node does not have", async () => {
    const res = await start({ ...body, bridge: "vmbr7" })
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe('Bridge "vmbr7" does not exist on pve1')
  })

  it("asks a tenant user for the VLAN right before putting the test VM on a VLAN, as a migration does", async () => {
    h.tenant = "msp-1"
    h.deniedFor = "vm.config.nic.vlan"
    const res = await start({ ...body, bridge: "vmbr0", vlanTag: 100 })
    expect(res.status).toBe(403)
    expect(h.checks).toContainEqual(["vm.config.nic.vlan", "connection", "tc"])
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
    expect(h.requestTest).not.toHaveBeenCalled()
  })

  it("asks nothing more of the provider, nor of a test without network", async () => {
    h.deniedFor = "vm.config.nic.vlan"
    expect((await start({ ...body, bridge: "vmbr0", vlanTag: 100 })).status).toBe(200)
    h.tenant = "msp-1"
    expect((await start(body)).status).toBe(200)
  })

  it("refuses a migration that does not wait for its manual cutover", async () => {
    h.job.cutoverRequestedAt = new Date()
    const res = await start(body)
    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe("A test can only start while a manual cutover migration waits")
  })

  it("refuses a second test while one runs", async () => {
    h.job.testState = { phase: "running", testVmid: 9001 }
    const res = await start(body)
    expect(res.status).toBe(409)
    expect((await readJson<any>(res)).error).toBe("A test is already running for this migration")
  })
})

describe("DELETE /api/v1/migrations/[id]/test", () => {
  it("records the stop request on the row, then signals the engine", async () => {
    h.job.testState = { phase: "running", testVmid: 9001 }
    const res = await stop()
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { status: "test_stop_requested" } })
    expect(h.prisma.migrationJob.update).toHaveBeenCalledWith({ where: { id: "j1" }, data: { testStopRequestedAt: expect.any(Date) } })
    expect(h.requestStop).toHaveBeenCalledWith("j1")
  })

  it("answers 409 when no test runs", async () => {
    expect((await stop()).status).toBe(409)
    expect(h.requestStop).not.toHaveBeenCalled()
  })
})
