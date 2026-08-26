import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const h = vi.hoisted(() => ({
  migrationJobFindUnique: vi.fn(),
  migrationJobUpdate: vi.fn(),
  checkPermission: vi.fn(),
  cancelMigrationJob: vi.fn(),
  cancelWarmMigrationJob: vi.fn(),
  cancelV2vMigrationJob: vi.fn(),
  cancelXcpngMigrationJob: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: vi.fn(async () => ({
    migrationJob: {
      findUnique: h.migrationJobFindUnique,
      update: h.migrationJobUpdate,
    },
  })),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: h.checkPermission,
  PERMISSIONS: { VM_MIGRATE: "vm.migrate" },
}))

vi.mock("@/lib/migration/pipeline", () => ({
  cancelMigrationJob: h.cancelMigrationJob,
}))

vi.mock("@/lib/migration/warm/warm-pipeline", () => ({
  cancelWarmMigrationJob: h.cancelWarmMigrationJob,
}))

vi.mock("@/lib/migration/v2v-pipeline", () => ({
  cancelV2vMigrationJob: h.cancelV2vMigrationJob,
}))

vi.mock("@/lib/migration/xcpng-pipeline", () => ({
  cancelXcpngMigrationJob: h.cancelXcpngMigrationJob,
}))

import { POST } from "./route"

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.migrationJobFindUnique.mockReset().mockResolvedValue({ id: "job-1", status: "transferring" })
  h.migrationJobUpdate.mockReset().mockResolvedValue({ id: "job-1", status: "cancelled" })
  h.cancelMigrationJob.mockReset()
  h.cancelWarmMigrationJob.mockReset()
  h.cancelV2vMigrationJob.mockReset()
  h.cancelXcpngMigrationJob.mockReset()
})

describe("POST /api/v1/migrations/[id]/cancel", () => {
  it("signals every pipeline, updates the job, and returns cancelled", async () => {
    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { status: "cancelled" } })
    expect(h.cancelMigrationJob).toHaveBeenCalledWith("job-1")
    expect(h.cancelWarmMigrationJob).toHaveBeenCalledWith("job-1")
    expect(h.cancelV2vMigrationJob).toHaveBeenCalledWith("job-1")
    expect(h.cancelXcpngMigrationJob).toHaveBeenCalledWith("job-1")
    expect(h.migrationJobUpdate).toHaveBeenCalledWith({
      where: { id: "job-1" },
      data: {
        status: "cancelled",
        currentStep: "cancelled",
        completedAt: expect.any(Date),
      },
    })
  })

  it("returns the RBAC response when cancellation is forbidden", async () => {
    h.checkPermission.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    )

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })

    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({ error: "forbidden" })
    expect(h.migrationJobFindUnique).not.toHaveBeenCalled()
    expect(h.cancelXcpngMigrationJob).not.toHaveBeenCalled()
    expect(h.migrationJobUpdate).not.toHaveBeenCalled()
  })

  it("returns 404 when the migration job does not exist", async () => {
    h.migrationJobFindUnique.mockResolvedValueOnce(null)

    const res = await callRoute(POST, { params: { id: "missing" }, method: "POST" })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: "Migration job not found" })
    expect(h.cancelXcpngMigrationJob).not.toHaveBeenCalled()
    expect(h.migrationJobUpdate).not.toHaveBeenCalled()
  })

  it.each(["completed", "failed", "cancelled"])("refuses to cancel a %s job", async (status) => {
    h.migrationJobFindUnique.mockResolvedValueOnce({ id: "job-1", status })

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: `Cannot cancel a ${status} job` })
    expect(h.cancelXcpngMigrationJob).not.toHaveBeenCalled()
    expect(h.migrationJobUpdate).not.toHaveBeenCalled()
  })

  it("returns 500 with the update error after signalling cancellation", async () => {
    h.migrationJobUpdate.mockRejectedValueOnce(new Error("database unavailable"))

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: "database unavailable" })
    expect(h.cancelXcpngMigrationJob).toHaveBeenCalledWith("job-1")
  })
})
