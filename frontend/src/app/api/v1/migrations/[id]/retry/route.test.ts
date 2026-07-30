import { describe, it, expect, vi, beforeEach } from "vitest"

// Capture the after() callbacks so the test can run the background dispatch.
const h = vi.hoisted(() => ({
  afterCbs: [] as Array<() => Promise<void>>,
  prisma: {
    migrationJob: { findUnique: vi.fn(), create: vi.fn(async () => ({ id: "job-2" })) },
  },
}))

vi.mock("next/server", async (io) => {
  const actual = await io<typeof import("next/server")>()
  return { ...actual, after: (fn: () => Promise<void>) => { h.afterCbs.push(fn) } }
})
vi.mock("next-auth", () => ({ getServerSession: vi.fn(async () => ({ user: { id: "u1" } })) }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: vi.fn(async () => h.prisma),
  getCurrentTenantId: vi.fn(async () => "default"),
}))
vi.mock("@/lib/migration/pipeline", () => ({ runMigrationPipeline: vi.fn() }))
vi.mock("@/lib/migration/warm/warm-pipeline", () => ({ runWarmMigration: vi.fn() }))
vi.mock("@/lib/migration/orphan-sweep", () => ({ resolveInstanceId: vi.fn(() => "inst-1") }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { runMigrationPipeline } from "@/lib/migration/pipeline"

const cold = runMigrationPipeline as unknown as ReturnType<typeof vi.fn>

const failedJob = {
  id: "job-1", status: "failed",
  sourceConnectionId: "src", sourceVmId: "vm-1", sourceVmName: null, sourceHost: null,
  targetConnectionId: "tgt", targetNode: "pve1", targetStorage: "local-lvm",
  config: { sourceConnectionId: "src", sourceVmId: "vm-1", migrationType: "cold" },
}

async function runAfters() { for (const cb of h.afterCbs) await cb() }

beforeEach(() => {
  h.afterCbs.length = 0
  cold.mockReset()
  h.prisma.migrationJob.findUnique.mockReset()
  h.prisma.migrationJob.create.mockReset().mockResolvedValue({ id: "job-2" })
})

describe("POST /api/v1/migrations/[id]/retry", () => {
  it("creates the retry job tagged with this server's instance id and dispatches it", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValueOnce(failedJob)

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
    expect(res.status).toBe(200)
    expect((await readJson<any>(res))?.data?.jobId).toBe("job-2")
    // #608 orphan detection: the retried pipeline runs in this process too
    expect(h.prisma.migrationJob.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ ownerInstanceId: "inst-1", status: "pending" }) }),
    )

    await runAfters()
    expect(cold).toHaveBeenCalledTimes(1)
    expect(cold.mock.calls[0][0]).toBe("job-2")
  })

  it("refuses to retry a job that is still running", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValueOnce({ ...failedJob, status: "transferring" })

    const res = await callRoute(POST, { params: { id: "job-1" }, method: "POST" })
    expect(res.status).toBe(400)
    expect(h.prisma.migrationJob.create).not.toHaveBeenCalled()
  })
})
