import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const h = vi.hoisted(() => ({
  access: null as any,
  jobs: [] as any[],
  prisma: { migrationJob: { findMany: vi.fn(), update: vi.fn(async () => ({})) } },
}))

vi.mock("@/lib/migration/batch-access", () => ({ loadBatchForCaller: vi.fn(async () => h.access) }))
vi.mock("@/lib/migration/warm/warm-pipeline", () => ({ requestWarmCutover: vi.fn() }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => "audit-1") }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { requestWarmCutover } from "@/lib/migration/warm/warm-pipeline"
import { audit } from "@/lib/audit"

const signal = requestWarmCutover as unknown as ReturnType<typeof vi.fn>
const cutover = (body?: any) => callRoute(POST, body === undefined ? { method: "POST", params: { id: "b1" } } : { method: "POST", params: { id: "b1" }, body })

beforeEach(() => {
  h.jobs = [
    { id: "j-queued", sourceVmName: "web-1", status: "queued" },
    { id: "j-copy", sourceVmName: "web-2", status: "full_copy" },
    { id: "j-hold", sourceVmName: "web-3", status: "delta_sync" },
    { id: "j-gate", sourceVmName: "web-4", status: "awaiting_cutover" },
    { id: "j-done", sourceVmName: "web-5", status: "completed" },
  ]
  h.prisma.migrationJob.findMany.mockReset().mockImplementation(async () => h.jobs)
  h.prisma.migrationJob.update.mockReset().mockResolvedValue({})
  h.access = { ok: true, batch: { id: "b1", status: "running" }, prisma: h.prisma, tenantId: "default" }
  signal.mockReset()
})

describe("POST /api/v1/migrations/batches/[id]/cutover", () => {
  it("cuts over every migration of the batch that waits, and names the others with their state", async () => {
    const res = await cutover()

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({
      data: {
        requested: ["j-hold", "j-gate"],
        skipped: [
          { jobId: "j-queued", sourceVmName: "web-1", status: "queued" },
          { jobId: "j-copy", sourceVmName: "web-2", status: "full_copy" },
          { jobId: "j-done", sourceVmName: "web-5", status: "completed" },
        ],
      },
    })
    expect(h.prisma.migrationJob.findMany.mock.calls[0][0].where).toEqual({ batchId: "b1" })
    expect(signal.mock.calls.map(c => c[0])).toEqual(["j-hold", "j-gate"])
  })

  it("records each request on its row before the in-process signal", async () => {
    await cutover()

    expect(h.prisma.migrationJob.update).toHaveBeenCalledWith({ where: { id: "j-hold" }, data: { cutoverRequestedAt: expect.any(Date) } })
    expect(h.prisma.migrationJob.update.mock.invocationCallOrder[0]).toBeLessThan(signal.mock.invocationCallOrder[0])
  })

  it("names in the audit log the VMs cut over and the ones left alone", async () => {
    vi.mocked(audit).mockClear()
    await cutover({ jobIds: ["j-gate", "j-copy"] })

    expect(audit).toHaveBeenCalledWith({
      category: "migration", action: "run", resourceType: "batch", resourceId: "b1", status: "success",
      details: {
        operation: "cutover",
        requested: [{ jobId: "j-gate", sourceVmName: "web-4" }],
        skipped: [{ jobId: "j-copy", sourceVmName: "web-2", status: "full_copy" }],
      },
    })
  })

  it("leaves a migration whose copy is under test, and says why", async () => {
    h.jobs = [
      { id: "j-hold", sourceVmName: "web-3", status: "delta_sync" },
      { id: "j-test", sourceVmName: "web-6", status: "delta_sync", testRequest: null, testState: { phase: "running", testVmid: 9001 } },
    ]
    const data = (await readJson<any>(await cutover())).data
    expect(data.requested).toEqual(["j-hold"])
    expect(data.skipped).toEqual([{ jobId: "j-test", sourceVmName: "web-6", status: "delta_sync", error: "Stop the running test before the cutover" }])
    expect(signal).not.toHaveBeenCalledWith("j-test")
  })

  it("limits the cutover to the selected migrations", async () => {
    const res = await cutover({ jobIds: ["j-gate", "j-copy"] })

    expect(await readJson<any>(res)).toEqual({
      data: { requested: ["j-gate"], skipped: [{ jobId: "j-copy", sourceVmName: "web-2", status: "full_copy" }] },
    })
    expect(signal).toHaveBeenCalledTimes(1)
  })

  it("refuses a selection naming a migration that is not in the batch, and cuts nothing over", async () => {
    const res = await cutover({ jobIds: ["j-hold", "j-elsewhere"] })

    expect(res.status).toBe(400)
    expect((await readJson<any>(res)).error).toBe("jobIds must list migrations of this batch")
    expect(signal).not.toHaveBeenCalled()
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
  })

  it("refuses a selection that is not a list of ids", async () => {
    for (const jobIds of ["j-hold", [], [1], Array.from({ length: 501 }, (_, i) => `j${i}`)]) {
      const res = await cutover({ jobIds })
      expect(res.status, JSON.stringify(jobIds).slice(0, 30)).toBe(400)
    }
    expect(signal).not.toHaveBeenCalled()
  })

  it("answers what the batch access check answers: 404 for another tenant's batch, 403 without vm.migrate", async () => {
    for (const status of [404, 403]) {
      h.access = { ok: false, response: NextResponse.json({ error: "x" }, { status }) }
      expect((await cutover()).status).toBe(status)
    }
    expect(h.prisma.migrationJob.findMany).not.toHaveBeenCalled()
  })

  it("goes on with the others when one row cannot be written, and reports it as skipped", async () => {
    h.prisma.migrationJob.update.mockRejectedValueOnce(new Error("db down"))
    const res = await cutover()

    const body = await readJson<any>(res)
    expect(body.data.requested).toEqual(["j-gate"])
    expect(body.data.skipped).toContainEqual({ jobId: "j-hold", sourceVmName: "web-3", status: "delta_sync", error: "db down" })
    expect(signal.mock.calls.map(c => c[0])).toEqual(["j-gate"])
  })
})
