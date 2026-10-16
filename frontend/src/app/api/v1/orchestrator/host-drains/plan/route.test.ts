/**
 * #248: the drain plan. A dry run, but it names every guest of the node: the
 * cluster owner only, with the right to view the node; the config is
 * validated and the targets restricted before it reaches the orchestrator.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { connFindUniqueMock, hostFindManyMock, checkPermissionMock, infraMock, fetchMock } = vi.hoisted(() => ({
  connFindUniqueMock: vi.fn(),
  hostFindManyMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  infraMock: vi.fn(),
  fetchMock: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: vi.fn(async () => "default"),
  getSessionPrisma: async () => ({
    connection: { findUnique: connFindUniqueMock },
    managedHost: { findMany: hostFindManyMock },
  }),
}))

vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => infraMock(...a),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  buildNodeResourceId: (connId: string, node: string) => `${connId}:${node}`,
  PERMISSIONS: { NODE_MANAGE: "node.manage", NODE_VIEW: "node.view" },
}))

vi.mock("@/lib/orchestrator/headers", () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => extra,
}))

vi.stubGlobal("fetch", fetchMock)

import { POST } from "./route"

const PLAN = { node: "pve3", guests: [], candidates: ["pve1", "pve2"], movable: 0, skipped: 0, projection: [] }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  connFindUniqueMock.mockResolvedValue({ id: "c1" })
  hostFindManyMock.mockResolvedValue([{ node: "pve1" }, { node: "pve2" }, { node: "pve3" }])
  infraMock.mockResolvedValue({ kind: "provider" })
  fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => PLAN })
})

const sent = () => JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)

describe("POST /api/v1/orchestrator/host-drains/plan", () => {
  it("forwards the validated plan request, per-guest targets included", async () => {
    const res = await callRoute(POST, {
      body: { connection_id: "c1", node: "pve3", config: { guest_targets: { 105: "pve2" }, keep_vmids: [92481], ssh_credentials: { forged: true } } },
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: PLAN })
    expect(checkPermissionMock).toHaveBeenCalledWith("node.view", "node", "c1:pve3")
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/\/api\/v1\/host-drains\/plan$/)
    const body = sent()
    expect(body).toMatchObject({ connection_id: "c1", node: "pve3" })
    expect(body.config.guest_targets).toEqual({ 105: "pve2" })
    expect(body.config.keep_vmids).toEqual([92481])
    expect(body.config.ssh_credentials).toBeUndefined()
  })

  it.each([
    [{ node: "pve3" }, 400],
    [{ connection_id: "c1", node: "pve3; reboot" }, 400],
  ])("refuses a malformed request %j", async (body, status) => {
    const res = await callRoute(POST, { body })
    expect(res.status).toBe(status)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("needs the right to view the node", async () => {
    checkPermissionMock.mockResolvedValueOnce(new Response(null, { status: 403 }))
    const res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3" } })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("hides the cluster from a tenant that does not own it, and an unknown connection", async () => {
    infraMock.mockResolvedValueOnce({ kind: "iaas", vdcScope: { connectionIds: new Set(["c1"]) } })
    expect((await callRoute(POST, { body: { connection_id: "c1", node: "pve3" } })).status).toBe(404)

    connFindUniqueMock.mockResolvedValueOnce(null)
    expect((await callRoute(POST, { body: { connection_id: "c1", node: "pve3" } })).status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses an invalid config and a target the caller cannot manage", async () => {
    let res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: { enter_maintenance: true, keep_vmids: [105] } } })
    expect(res.status).toBe(400)

    checkPermissionMock.mockImplementation(async (perm: string, _t?: string, id?: string) => (perm === "node.manage" && id === "c1:pve2" ? new Response(null, { status: 403 }) : null))
    res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: { guest_targets: { 105: "pve2" } } } })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("relays the orchestrator's refusal and reports it when it is down", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ error: 'node "pve9" is not part of this cluster' }) })
    let res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3" } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("not part of this cluster")

    fetchMock.mockResolvedValueOnce({ ok: false, status: 502, json: async () => ({}) })
    res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3" } })
    expect((await res.json()).error).toBe("Failed to plan the host drain")

    fetchMock.mockRejectedValueOnce(Object.assign(new Error("Orchestrator unavailable"), { code: "ORCHESTRATOR_UNAVAILABLE" }))
    res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3" } })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe("Orchestrator unavailable")
  })
})
