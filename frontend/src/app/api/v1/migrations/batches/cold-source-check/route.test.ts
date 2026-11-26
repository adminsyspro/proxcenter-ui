import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const h = vi.hoisted(() => ({ denied: null as Response | null, infra: { kind: "provider" } as any, check: vi.fn(), prisma: { connection: {} } }))
vi.mock("@/lib/rbac", () => ({ getCurrentRbacInfraScope: vi.fn(async () => null), checkPermission: vi.fn(async () => h.denied), PERMISSIONS: { VM_MIGRATE: "vm.migrate", CONNECTION_VIEW: "connection.view" } }))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: vi.fn(async () => "default"), getTenantPrisma: vi.fn(() => h.prisma) }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: vi.fn(async () => h.infra),
}))
vi.mock("@/lib/migration/cold-source-reach", () => ({ checkColdBatchSourceReach: h.check }))

import { checkPermission } from "@/lib/rbac"
import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const body = { sourceConnectionId: "src", targetConnectionId: "tgt", nodes: ["pve1", "pve3"], vms: [{ sourceVmId: "vm-1", sourceVmName: "web" }, { sourceVmId: "vm-2" }] }
const verdict = { problems: [], unchecked: [], errors: [] }

beforeEach(() => {
  h.denied = null
  h.infra = { kind: "provider" }
  h.check.mockReset().mockResolvedValue(verdict)
  vi.mocked(checkPermission).mockImplementation(async () => h.denied as any)
})

describe("POST /api/v1/migrations/batches/cold-source-check", () => {
  it("checks the batch's download address from every target node", async () => {
    const res = await callRoute(POST, { method: "POST", body })
    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: verdict })
    expect(h.check).toHaveBeenCalledWith({
      prisma: h.prisma, sourceConnectionId: "src", targetConnectionId: "tgt",
      vms: [{ sourceVmId: "vm-1", name: "web" }, { sourceVmId: "vm-2", name: "vm-2" }],
      nodes: ["pve1", "pve3"],
    })
  })

  it.each([
    [{ ...body, sourceConnectionId: undefined }],
    [{ ...body, targetConnectionId: "" }],
    [{ ...body, nodes: [] }],
    [{ ...body, nodes: ["../etc"] }],
    [{ ...body, vms: [] }],
    [{ ...body, vms: [{ sourceVmId: "vm 1;" }] }],
  ])("refuses a malformed request %#", async (b) => {
    expect((await callRoute(POST, { method: "POST", body: b })).status).toBe(400)
    expect(h.check).not.toHaveBeenCalled()
  })

  it("answers 404 outside the tenant's clusters and 403 without vm.migrate", async () => {
    h.infra = { kind: "msp", connectionIds: new Set(["src"]) }
    expect((await callRoute(POST, { method: "POST", body })).status).toBe(404)
    h.infra = { kind: "provider" }
    h.denied = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    expect((await callRoute(POST, { method: "POST", body })).status).toBe(403)
    expect(h.check).not.toHaveBeenCalled()
  })

  it("needs the right to view both connections it reads with their stored credentials", async () => {
    vi.mocked(checkPermission).mockImplementation(async (perm: string, _t?: string, id?: string) =>
      perm === "connection.view" && id === "tgt" ? NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any : null)
    expect((await callRoute(POST, { method: "POST", body })).status).toBe(403)
    expect(checkPermission).toHaveBeenCalledWith("connection.view", "connection", "tgt")
    expect(h.check).not.toHaveBeenCalled()
  })

  it("answers 500 with the reason when the check throws", async () => {
    h.check.mockRejectedValue(new Error("boom"))
    const res = await callRoute(POST, { method: "POST", body })
    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: "boom" })
  })
})
