/**
 * #248: reading one host drain. It names every guest of the node, so only a
 * tenant that owns the cluster, with the right to view the node, reads it.
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
  PERMISSIONS: { TASKS_VIEW: "tasks.view", NODE_VIEW: "node.view" },
}))
vi.mock("@/lib/orchestrator/headers", () => ({ orchestratorHeaders: (extra: Record<string, string> = {}) => extra }))

const DRAIN = { id: "d-1", connection_id: "c1", node: "pve3", guests: [{ vmid: 100, name: "other-tenant-vm" }] }
const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

import { GET } from "./route"

const params = { id: "d-1" }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  infraMock.mockResolvedValue({ kind: "provider" })
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => DRAIN })
})

describe("GET /api/v1/orchestrator/host-drains/[id]", () => {
  it("returns the drain to the cluster owner, checked on the drained node", async () => {
    const res = await callRoute(GET, { method: "GET", params })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual(DRAIN)
    expect(checkPermissionMock).toHaveBeenCalledWith("node.view", "node", "c1:pve3")
  })

  it("hides it from a tenant that does not own the cluster, a vDC sharing it included", async () => {
    for (const infra of [{ kind: "iaas", vdcScope: { connectionIds: new Set(["c1"]) } }, { kind: "msp", connectionIds: new Set(["c2"]) }]) {
      infraMock.mockResolvedValueOnce(infra)
      expect((await callRoute(GET, { method: "GET", params })).status).toBe(404)
    }
  })

  it("keeps the node permission refusal and the orchestrator's 404", async () => {
    checkPermissionMock.mockResolvedValueOnce(null).mockResolvedValueOnce(new Response(null, { status: 403 }))
    expect((await callRoute(GET, { method: "GET", params })).status).toBe(403)

    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: "not found" }) })
    expect((await callRoute(GET, { method: "GET", params })).status).toBe(404)
  })
})
