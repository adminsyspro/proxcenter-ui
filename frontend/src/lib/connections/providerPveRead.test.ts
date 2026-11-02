import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

// The shared GET of the provider-only Proxmox reads: the IaaS gate first, then
// the permission on the connection or the node, then the read.
const h = vi.hoisted(() => ({
  gate: vi.fn(),
  checkPermission: vi.fn(),
  getConnectionById: vi.fn(),
  pveFetch: vi.fn(),
}))

vi.mock("@/lib/tenant/iaasGuard", () => ({ denyIaasTenant: () => h.gate() }))
vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => h.checkPermission(...a),
  buildNodeResourceId: (c: string, n: string) => `${c}:${n}`,
}))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: (...a: any[]) => h.getConnectionById(...a) }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => h.pveFetch(...a) }))

import { providerPveRead } from "./providerPveRead"

const onNode = providerPveRead({ permission: "node.view", on: "node", path: ({ node }) => `/nodes/${node}/hardware/pci`, shape: "list" })
const onConnection = providerPveRead({ permission: "node.view", on: "connection", path: () => "/cluster/firewall/options", shape: "object" })

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockResolvedValue(null)
  h.checkPermission.mockResolvedValue(null)
  h.getConnectionById.mockResolvedValue({ id: "c1" })
})

describe("providerPveRead", () => {
  it("answers the gate's refusal before any permission or Proxmox call", async () => {
    h.gate.mockResolvedValue(new Response(JSON.stringify({ error: "Not found" }), { status: 404 }))
    const res = await callRoute(onNode, { method: "GET", params: { id: "c1", node: "pve1" } })
    expect(res.status).toBe(404)
    expect(h.checkPermission).not.toHaveBeenCalled()
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it("checks the permission on the node, reads the path and keeps a list", async () => {
    h.pveFetch.mockResolvedValue([{ id: "0000:01:00.0" }])
    const res = await callRoute(onNode, { method: "GET", params: { id: "c1", node: "pve1" } })
    expect(h.checkPermission).toHaveBeenCalledWith("node.view", "node", "c1:pve1")
    expect(h.pveFetch).toHaveBeenCalledWith({ id: "c1" }, "/nodes/pve1/hardware/pci")
    expect(await res.json()).toEqual({ data: [{ id: "0000:01:00.0" }] })
  })

  it("answers [] for a list Proxmox does not return, {} for an empty object", async () => {
    h.pveFetch.mockResolvedValue(null)
    expect(await (await callRoute(onNode, { method: "GET", params: { id: "c1", node: "pve1" } })).json()).toEqual({ data: [] })
    expect(await (await callRoute(onConnection, { method: "GET", params: { id: "c1" } })).json()).toEqual({ data: {} })
    expect(h.checkPermission).toHaveBeenLastCalledWith("node.view", "connection", "c1")
  })

  it("returns the permission refusal, 400 without an id, 500 with the Proxmox error", async () => {
    h.checkPermission.mockResolvedValueOnce(new Response("{}", { status: 403 }))
    expect((await callRoute(onConnection, { method: "GET", params: { id: "c1" } })).status).toBe(403)

    expect((await callRoute(onConnection, { method: "GET", params: {} })).status).toBe(400)

    h.pveFetch.mockRejectedValue(new Error("pve down"))
    const res = await callRoute(onConnection, { method: "GET", params: { id: "c1" } })
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: "pve down" })
  })
})
