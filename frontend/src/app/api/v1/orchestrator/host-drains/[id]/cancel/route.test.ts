/**
 * #248: cancelling a host drain. The permission is checked on the drained
 * node, and only a tenant that owns its cluster may cancel it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, infraMock } = vi.hoisted(() => ({ checkPermissionMock: vi.fn(), infraMock: vi.fn() }))

vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: vi.fn(async () => "t1") }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => infraMock(...a),
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  buildNodeResourceId: (connId: string, node: string) => `${connId}:${node}`,
  PERMISSIONS: { NODE_MANAGE: "node.manage" },
}))
vi.mock("@/lib/orchestrator/headers", () => ({ orchestratorHeaders: (extra: Record<string, string> = {}) => extra }))

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

import { POST } from "./route"

const params = { id: "d-1" }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  infraMock.mockResolvedValue({ kind: "provider" })
  fetchMock.mockImplementation(async (url: string) => url.endsWith("/cancel")
    ? { ok: true, status: 200, json: async () => ({ id: "d-1", status: "cancelled" }) }
    : { ok: true, status: 200, json: async () => ({ id: "d-1", connection_id: "c1", node: "pve3" }) })
})

describe("POST /api/v1/orchestrator/host-drains/[id]/cancel", () => {
  it("cancels a drain of a cluster the caller owns, checked on the drained node", async () => {
    const res = await callRoute(POST, { params })
    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith("node.manage", "node", "c1:pve3")
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith("/host-drains/d-1/cancel"))).toBe(true)
  })

  it("hides the drain of a cluster the caller does not own, a vDC's shared one included", async () => {
    for (const infra of [{ kind: "iaas", vdcScope: { connectionIds: new Set(["c1"]) } }, { kind: "msp", connectionIds: new Set(["c2"]) }]) {
      infraMock.mockResolvedValueOnce(infra)
      const res = await callRoute(POST, { params })
      expect(res.status).toBe(404)
    }
    expect(fetchMock.mock.calls.some(c => String(c[0]).endsWith("/cancel"))).toBe(false)
  })

  it("answers 404 for an unknown drain, and keeps the permission refusal", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: "not found" }) })
    expect((await callRoute(POST, { params })).status).toBe(404)

    checkPermissionMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    expect((await callRoute(POST, { params })).status).toBe(403)
  })
})

describe("POST /api/v1/orchestrator/host-drains/[id]/cancel, a selection of guests (#1218)", () => {
  it("needs the right to manage every node the selection moves guests from", async () => {
    fetchMock.mockImplementation(async (url: string) => url.endsWith("/cancel")
      ? { ok: true, status: 200, json: async () => ({ id: "d-2", status: "cancelled" }) }
      : { ok: true, status: 200, json: async () => ({ id: "d-2", connection_id: "c1", node: "", guests: [{ source_node: "pve1" }, { source_node: "pve2" }] }) })

    expect((await callRoute(POST, { params })).status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith("node.manage", "node", "c1:pve2")

    checkPermissionMock.mockImplementation(async (_p: string, _t?: string, id?: string) => (id === "c1:pve2" ? new Response(null, { status: 403 }) : null))
    expect((await callRoute(POST, { params })).status).toBe(403)
  })
})
