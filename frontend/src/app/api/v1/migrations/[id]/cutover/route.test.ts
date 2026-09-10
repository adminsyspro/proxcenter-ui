import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  prisma: { migrationJob: { findUnique: vi.fn(), update: vi.fn(async () => ({})) } },
}))

vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))
vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock("@/lib/migration/warm/warm-pipeline", () => ({ requestWarmCutover: vi.fn() }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { requestWarmCutover } from "@/lib/migration/warm/warm-pipeline"
import { checkPermission } from "@/lib/rbac"

const signal = requestWarmCutover as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  h.prisma.migrationJob.findUnique.mockReset()
  h.prisma.migrationJob.update.mockReset()
  h.prisma.migrationJob.update.mockResolvedValue({})
  signal.mockReset()
})

describe("POST /api/v1/migrations/[id]/cutover", () => {
  it("404s when the job is missing", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue(null)
    const res = await callRoute(POST, { params: { id: "nope" } })
    expect(res.status).toBe(404)
    expect(signal).not.toHaveBeenCalled()
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
  })

  it("400s when the job is not in a cutover-eligible state", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue({ id: "j1", status: "full_copy" })
    const res = await callRoute(POST, { params: { id: "j1" } })
    expect(res.status).toBe(400)
    expect(signal).not.toHaveBeenCalled()
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
  })

  it("signals cutover for a delta_sync job", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue({ id: "j1", status: "delta_sync" })
    const res = await callRoute(POST, { params: { id: "j1" } })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { status: "cutover_requested" } })
    expect(signal).toHaveBeenCalledWith("j1")
  })

  it("records the request on the row, and does so before the in-process signal", async () => {
    // The row is what a pipeline running in another module instance (or in
    // another replica) reads. The in-process set is only the fast path, so it
    // must never be the only place the click landed.
    h.prisma.migrationJob.findUnique.mockResolvedValue({ id: "j1", status: "delta_sync" })
    await callRoute(POST, { params: { id: "j1" } })
    expect(h.prisma.migrationJob.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: { cutoverRequestedAt: expect.any(Date) },
    })
    expect(h.prisma.migrationJob.update.mock.invocationCallOrder[0])
      .toBeLessThan(signal.mock.invocationCallOrder[0])
  })

  it("500s and leaves nothing signalled when the row cannot be written", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue({ id: "j1", status: "delta_sync" })
    h.prisma.migrationJob.update.mockRejectedValue(new Error("db down"))
    const res = await callRoute(POST, { params: { id: "j1" } })
    expect(res.status).toBe(500)
    expect(signal).not.toHaveBeenCalled()
  })

  it("signals cutover for an awaiting_cutover job", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue({ id: "j2", status: "awaiting_cutover" })
    const res = await callRoute(POST, { params: { id: "j2" } })
    expect(res.status).toBe(200)
    expect(signal).toHaveBeenCalledWith("j2")
  })

  it("returns 500 when an unexpected error is thrown", async () => {
    h.prisma.migrationJob.findUnique.mockRejectedValue(new Error("db down"))
    const res = await callRoute(POST, { params: { id: "j1" } })
    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: "db down" })
    expect(signal).not.toHaveBeenCalled()
  })

  it("propagates a permission denial", async () => {
    ;(checkPermission as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      new Response("forbidden", { status: 403 }) as any
    )
    const res = await callRoute(POST, { params: { id: "j1" } })
    expect(res.status).toBe(403)
    expect(h.prisma.migrationJob.findUnique).not.toHaveBeenCalled()
  })
})
