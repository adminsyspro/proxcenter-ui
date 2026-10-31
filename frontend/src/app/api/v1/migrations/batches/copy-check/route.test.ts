import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const h = vi.hoisted(() => ({ denied: null as Response | null, infra: { kind: "provider" } as any, check: vi.fn() }))
vi.mock("@/lib/rbac", () => ({ getCurrentRbacInfraScope: vi.fn(async () => null), checkPermission: vi.fn(async () => h.denied), PERMISSIONS: { VM_MIGRATE: "vm.migrate", CONNECTION_VIEW: "connection.view" } }))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: vi.fn(async () => "default") }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: vi.fn(async () => h.infra),
}))
vi.mock("@/lib/migration/batch-copy-reach", () => ({ checkBatchCopyNetwork: h.check }))

import { checkPermission } from "@/lib/rbac"
import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const body = { sourceConnectionId: "src", targetConnectionId: "tgt", nodes: ["pve1", "pve3"], auto: true, vms: [{ sourceVmId: "vm-1", sourceVmName: "web" }, { sourceVmId: "vm-2" }] }

beforeEach(() => {
  h.denied = null
  h.infra = { kind: "provider" }
  h.check.mockReset().mockResolvedValue({ ok: true, placements: [], problems: [] })
  vi.mocked(checkPermission).mockImplementation(async () => h.denied as any)
})

describe("POST /api/v1/migrations/batches/copy-check (roadmap#53)", () => {
  it("plans the batch across the candidate nodes", async () => {
    const res = await callRoute(POST, { method: "POST", body: { ...body, copyVmk: "vmk2" } })
    expect(await readJson<any>(res)).toEqual({ data: { ok: true, placements: [], problems: [] } })
    expect(h.check).toHaveBeenCalledWith({
      tenantId: "default", sourceConnectionId: "src", targetConnectionId: "tgt", pinnedDevice: "vmk2",
      vms: [{ sourceVmId: "vm-1", name: "web" }, { sourceVmId: "vm-2", name: "vm-2" }],
      candidates: ["pve1", "pve3"], auto: true,
    })
  })

  it.each([
    [{ ...body, sourceConnectionId: undefined }],
    [{ ...body, nodes: [] }],
    [{ ...body, nodes: ["../etc"] }],
    [{ ...body, vms: [] }],
    [{ ...body, vms: [{ sourceVmId: "vm 1;" }] }],
    [{ ...body, copyVmk: "vmk0; reboot" }],
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
      perm === "connection.view" && id === "src" ? NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any : null)
    expect((await callRoute(POST, { method: "POST", body })).status).toBe(403)
    expect(checkPermission).toHaveBeenCalledWith("connection.view", "connection", "src")
    expect(h.check).not.toHaveBeenCalled()
  })
})
