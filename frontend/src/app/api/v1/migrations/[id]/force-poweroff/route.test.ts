import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  prisma: { migrationJob: { findUnique: vi.fn(), update: vi.fn(async () => ({})) } },
}))

vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => null), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))
vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock("@/lib/migration/warm/warm-pipeline", () => ({ requestWarmForcePowerOff: vi.fn() }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { requestWarmForcePowerOff } from "@/lib/migration/warm/warm-pipeline"

const signal = requestWarmForcePowerOff as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  h.prisma.migrationJob.findUnique.mockReset()
  h.prisma.migrationJob.update.mockReset()
  h.prisma.migrationJob.update.mockResolvedValue({})
  signal.mockReset()
})

describe("POST /api/v1/migrations/[id]/force-poweroff", () => {
  it("404s when the job is missing", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue(null)
    const res = await callRoute(POST, { params: { id: "nope" } })
    expect(res.status).toBe(404)
    expect(signal).not.toHaveBeenCalled()
  })

  it("400s when the job is not waiting on a power off", async () => {
    // Nothing polls the request outside that wait, so accepting it would leave a
    // flag set for a later wait the operator never asked about.
    h.prisma.migrationJob.findUnique.mockResolvedValue({ id: "j1", status: "cutover", currentStep: "cutover" })
    const res = await callRoute(POST, { params: { id: "j1" } })
    expect(res.status).toBe(400)
    expect(signal).not.toHaveBeenCalled()
    expect(h.prisma.migrationJob.update).not.toHaveBeenCalled()
  })

  it("signals the hard power off during a cutover wait", async () => {
    h.prisma.migrationJob.findUnique.mockResolvedValue({ id: "j1", status: "cutover", currentStep: "awaiting_power_off" })
    const res = await callRoute(POST, { params: { id: "j1" } })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { status: "force_power_off_requested" } })
    expect(signal).toHaveBeenCalledWith("j1")
    // Recorded on the row, which is what the run actually polls when the route
    // handler does not share its module instance.
    expect(h.prisma.migrationJob.update).toHaveBeenCalledWith({
      where: { id: "j1" },
      data: { forcePowerOffRequestedAt: expect.any(Date) },
    })
  })

  it("signals it during the checksum fallback wait too, which runs under full_copy", async () => {
    // That path shuts the source down BEFORE copying, so it is the one where a
    // refused shutdown costs the most time.
    h.prisma.migrationJob.findUnique.mockResolvedValue({ id: "j2", status: "full_copy", currentStep: "awaiting_power_off" })
    const res = await callRoute(POST, { params: { id: "j2" } })
    expect(res.status).toBe(200)
    expect(signal).toHaveBeenCalledWith("j2")
  })
})
