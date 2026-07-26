import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  prisma: { migrationJob: { findUnique: vi.fn() } },
}))

vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))
vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock("@/lib/migration/warm/warm-pipeline", () => ({ requestWarmCutover: vi.fn() }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { requestWarmCutover } from "@/lib/migration/warm/warm-pipeline"
import { checkPermission } from "@/lib/rbac"

const signal = requestWarmCutover as unknown as ReturnType<typeof vi.fn>

beforeEach(() => { h.prisma.migrationJob.findUnique.mockReset(); signal.mockReset() })

describe("POST /api/v1/migrations/[id]/cutover", () => {
  it("404s when the job is missing", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue(null)
    const res = await callRoute(POST, { params: { id: "nope" } })
    expect(res.status).toBe(404)
    expect(signal).not.toHaveBeenCalled()
  })

  it("400s when the job is not in a cutover-eligible state", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue({ id: "j1", status: "full_copy" })
    const res = await callRoute(POST, { params: { id: "j1" } })
    expect(res.status).toBe(400)
    expect(signal).not.toHaveBeenCalled()
  })

  it("signals cutover for a delta_sync job", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue({ id: "j1", status: "delta_sync" })
    const res = await callRoute(POST, { params: { id: "j1" } })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { status: "cutover_requested" } })
    expect(signal).toHaveBeenCalledWith("j1")
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
