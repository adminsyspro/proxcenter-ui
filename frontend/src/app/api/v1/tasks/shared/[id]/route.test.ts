import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null as any),
  getCurrentTenantId: vi.fn(async () => "default"),
  getTenantConnectionIds: vi.fn(async () => new Set<string>(["pve-a"])),
  session: { user: { id: "u1" } } as any,
  global: {
    migrationJob: { findUnique: vi.fn(async () => null as any) },
    user: { findUnique: vi.fn(async () => null as any) },
  },
  sessionClient: {
    migrationJob: { findUnique: vi.fn(async () => null as any) },
    user: { findUnique: vi.fn(async () => null as any) },
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

const recent = () => new Date(Date.now() - 60 * 1000)
const job = (over: any = {}) => ({
  id: "job-1", config: { sourceType: "esxi-direct" }, sourceVmName: "db01", sourceVmId: "vm-1",
  targetConnectionId: "pve-a", targetNode: "pve1", targetVmid: 200, status: "failed",
  currentStep: null, progress: 30, totalDisks: 1, currentDisk: 1, bytesTransferred: null,
  totalBytes: null, transferSpeed: null, error: "boom", createdBy: "u1",
  createdAt: recent(), startedAt: null, completedAt: null, updatedAt: recent(),
  logs: [{ t: 1, m: "started" }], ...over,
})

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.getCurrentTenantId.mockReset().mockResolvedValue("default")
  h.getTenantConnectionIds.mockReset().mockResolvedValue(new Set(["pve-a"]))
  h.session = { user: { id: "u1" } }
  h.global.migrationJob.findUnique.mockReset().mockResolvedValue(null)
  h.global.user.findUnique.mockReset().mockResolvedValue(null)
  h.sessionClient.migrationJob.findUnique.mockReset().mockResolvedValue(null)
  h.sessionClient.user.findUnique.mockReset().mockResolvedValue(null)
})

describe("GET /api/v1/tasks/shared/[id]", () => {
  it("403 when denied", async () => {
    h.checkPermission.mockResolvedValue(new Response("no", { status: 403 }) as any)
    const res = await callRoute(GET, { method: "GET", params: { id: "job-1" } })
    expect(res.status).toBe(403)
  })

  it("404 when not found", async () => {
    h.global.migrationJob.findUnique.mockResolvedValue(null)
    const res = await callRoute(GET, { method: "GET", params: { id: "nope" } })
    expect(res.status).toBe(404)
  })

  it("404 when the recent job is outside the 30-min window", async () => {
    h.global.migrationJob.findUnique.mockResolvedValue(job({ status: "failed", updatedAt: new Date(Date.now() - 60 * 60 * 1000) }))
    const res = await callRoute(GET, { method: "GET", params: { id: "job-1" } })
    expect(res.status).toBe(404)
  })

  it("returns the job with logs for an in-scope recent job", async () => {
    h.global.migrationJob.findUnique.mockResolvedValue(job())
    h.global.user.findUnique.mockResolvedValue({ name: "Alice", email: "a@x" })
    const res = await callRoute(GET, { method: "GET", params: { id: "job-1" } })
    const body = await readJson(res)
    expect(res.status).toBe(200)
    expect(body.data.id).toBe("job-1")
    expect(body.data.createdByName).toBe("Alice")
    expect(body.data.logs).toEqual([{ t: 1, m: "started" }])
    expect(body.data.createdBy).toBeUndefined()
  })
})
