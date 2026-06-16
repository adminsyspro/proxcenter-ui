import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null as any),
  getCurrentTenantId: vi.fn(async () => "default"),
  getTenantConnectionIds: vi.fn(async () => new Set<string>()),
  session: { user: { id: "u1" } } as any,
  global: {
    migrationJob: { findMany: vi.fn(async () => [] as any[]) },
    user: { findMany: vi.fn(async () => [] as any[]) },
  },
  sessionClient: {
    migrationJob: { findMany: vi.fn(async () => [] as any[]) },
    user: { findMany: vi.fn(async () => [] as any[]) },
  },
}))

vi.mock("@/lib/rbac", () => ({ checkPermission: h.checkPermission, PERMISSIONS: { TASKS_VIEW: "tasks.view" } }))
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => h.session) }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/db/prisma", () => ({ prisma: h.global }))
vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: h.getCurrentTenantId,
  getSessionPrisma: vi.fn(async () => h.sessionClient),
  getTenantConnectionIds: h.getTenantConnectionIds,
  DEFAULT_TENANT_ID: "default",
}))

import { GET } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const job = (over: any = {}) => ({
  id: "job-1", config: { sourceType: "vcenter" }, sourceVmName: "web01", sourceVmId: "vm-1",
  targetConnectionId: "pve-a", targetNode: "pve1", targetVmid: 123, status: "transferring",
  currentStep: "x", progress: 10, totalDisks: 1, currentDisk: 1, bytesTransferred: null,
  totalBytes: null, transferSpeed: null, error: null, createdBy: "u1",
  createdAt: new Date("2026-06-16T10:00:00Z"), startedAt: null, completedAt: null,
  updatedAt: new Date("2026-06-16T10:00:00Z"), ...over,
})

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.getCurrentTenantId.mockReset().mockResolvedValue("default")
  h.getTenantConnectionIds.mockReset().mockResolvedValue(new Set<string>())
  h.session = { user: { id: "u1" } }
  h.global.migrationJob.findMany.mockReset().mockResolvedValue([])
  h.global.user.findMany.mockReset().mockResolvedValue([])
  h.sessionClient.migrationJob.findMany.mockReset().mockResolvedValue([])
  h.sessionClient.user.findMany.mockReset().mockResolvedValue([])
})

describe("GET /api/v1/tasks/shared", () => {
  it("returns 403 when tasks.view is denied", async () => {
    const denied = new Response("no", { status: 403 })
    h.checkPermission.mockResolvedValue(denied as any)
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(403)
  })

  it("DEFAULT uses the global client and returns all jobs with isMine + resolved name", async () => {
    h.global.migrationJob.findMany.mockResolvedValue([job({ createdBy: "u1" }), job({ id: "job-2", createdBy: "u2" })])
    h.global.user.findMany.mockResolvedValue([{ id: "u1", name: "Alice", email: "a@x" }, { id: "u2", name: null, email: "b@x" }])
    const res = await callRoute(GET, { method: "GET" })
    const body = await readJson(res)
    expect(h.global.migrationJob.findMany).toHaveBeenCalled()
    expect(h.sessionClient.migrationJob.findMany).not.toHaveBeenCalled()
    expect(body.data).toHaveLength(2)
    expect(body.data[0]).toMatchObject({ id: "job-1", isMine: true, createdByName: "Alice" })
    expect(body.data[1]).toMatchObject({ id: "job-2", isMine: false, createdByName: "b@x" })
    expect(body.data[0].createdBy).toBeUndefined()
  })

  it("non-DEFAULT with an empty reachable set short-circuits to [] without querying", async () => {
    h.getCurrentTenantId.mockResolvedValue("iaas-1")
    h.getTenantConnectionIds.mockResolvedValue(new Set<string>())
    const res = await callRoute(GET, { method: "GET" })
    const body = await readJson(res)
    expect(body.data).toEqual([])
    expect(h.sessionClient.migrationJob.findMany).not.toHaveBeenCalled()
  })

  it("non-DEFAULT scopes the query to reachable target connections via the session client", async () => {
    h.getCurrentTenantId.mockResolvedValue("msp-1")
    h.getTenantConnectionIds.mockResolvedValue(new Set(["pve-a"]))
    h.sessionClient.migrationJob.findMany.mockResolvedValue([job({ createdBy: "u1" })])
    h.sessionClient.user.findMany.mockResolvedValue([{ id: "u1", name: "Bob", email: null }])
    const res = await callRoute(GET, { method: "GET" })
    const body = await readJson(res)
    expect(h.global.migrationJob.findMany).not.toHaveBeenCalled()
    const arg = h.sessionClient.migrationJob.findMany.mock.calls[0][0]
    expect(arg.where.targetConnectionId).toEqual({ in: ["pve-a"] })
    expect(body.data[0].createdByName).toBe("Bob")
  })
})
