import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

const h = vi.hoisted(() => ({ denied: null as Response | null, infra: { kind: "provider" } as any, check: vi.fn() }))
vi.mock("@/lib/rbac", () => ({ getCurrentRbacInfraScope: vi.fn(async () => null), checkPermission: vi.fn(async () => h.denied), PERMISSIONS: { VM_MIGRATE: "vm.migrate", CONNECTION_VIEW: "connection.view" } }))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: vi.fn(async () => "default") }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: vi.fn(async () => h.infra),
}))
vi.mock("@/lib/migration/batch-space", async (orig) => ({ ...(await orig<typeof import("@/lib/migration/batch-space")>()), checkBatchSpaceForRequest: h.check }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const body = { sourceConnectionId: "src", targetConnectionId: "tgt", targetStorage: "ZFS-Pool", vms: [{ sourceVmId: "vm-1", targetNode: "pve1", diskBytes: 3e9 }, { sourceVmId: "vm-2", targetNode: "pve2" }] }

beforeEach(() => {
  h.denied = null
  h.infra = { kind: "provider" }
  h.check.mockReset().mockResolvedValue({ ok: true, problems: [], warnings: [] })
})

describe("POST /api/v1/migrations/batches/space-check", () => {
  it("returns the verdict for the VMs and their nodes", async () => {
    const res = await callRoute(POST, { method: "POST", body })
    expect(await readJson<any>(res)).toEqual({ data: { ok: true, problems: [], warnings: [] } })
    expect(h.check).toHaveBeenCalledWith({
      tenantId: "default", sourceConnectionId: "src", targetConnectionId: "tgt", storage: "ZFS-Pool",
      vms: [{ sourceVmId: "vm-1", targetNode: "pve1", estimatedBytes: 3e9 }, { sourceVmId: "vm-2", targetNode: "pve2", estimatedBytes: 0 }],
    })
  })

  it.each([
    [{ ...body, vms: [] }, 400],
    [{ ...body, targetStorage: "bad;rm" }, 400],
    [{ ...body, vms: [{ sourceVmId: "vm-1", targetNode: "../etc" }] }, 400],
    [{ ...body, vms: [{ targetNode: "pve1" }] }, 400],
    [{ ...body, sourceConnectionId: undefined }, 400],
  ])("refuses a malformed request %#", async (b, status) => {
    expect((await callRoute(POST, { method: "POST", body: b })).status).toBe(status)
    expect(h.check).not.toHaveBeenCalled()
  })

  it("answers 404 outside the tenant's clusters and 403 without vm.migrate", async () => {
    h.infra = { kind: "iaas", vdcScope: {} }
    expect((await callRoute(POST, { method: "POST", body })).status).toBe(404)
    h.denied = NextResponse.json({ error: "Forbidden" }, { status: 403 })
    expect((await callRoute(POST, { method: "POST", body })).status).toBe(403)
    expect(h.check).not.toHaveBeenCalled()
  })

  it("needs the right to view both connections it reads with their stored credentials", async () => {
    const { checkPermission } = await import("@/lib/rbac")
    vi.mocked(checkPermission).mockImplementation(async (perm: string, _t?: string, id?: string) =>
      perm === "connection.view" && id === "tgt" ? NextResponse.json({ error: "Forbidden" }, { status: 403 }) as any : null)
    try {
      expect((await callRoute(POST, { method: "POST", body })).status).toBe(403)
      expect(checkPermission).toHaveBeenCalledWith("connection.view", "connection", "src")
      expect(checkPermission).toHaveBeenCalledWith("connection.view", "connection", "tgt")
      expect(h.check).not.toHaveBeenCalled()
    } finally {
      vi.mocked(checkPermission).mockImplementation(async () => h.denied as any)
    }
  })
})
