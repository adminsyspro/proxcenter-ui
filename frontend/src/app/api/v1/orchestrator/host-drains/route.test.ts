/**
 * #248: starting a host drain. The maintenance path carries the decrypted SSH
 * credentials of the connection to the orchestrator (ha-manager runs there),
 * "Migrate all VMs" carries none, and whatever the browser put in the config
 * under those keys is dropped.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { connFindUniqueMock, hostFindManyMock, checkPermissionMock, tenantConnectionIdsMock, infraMock } = vi.hoisted(() => ({
  connFindUniqueMock: vi.fn(),
  hostFindManyMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
  infraMock: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: vi.fn(async () => "default"),
  getTenantConnectionIds: (...a: any[]) => tenantConnectionIdsMock(...a),
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
  buildVmResourceId: (connId: string, node: string, type: string, vmid: string) => `${connId}:${node}:${type}:${vmid}`,
  PERMISSIONS: { TASKS_VIEW: "tasks.view", NODE_MANAGE: "node.manage", NODE_VIEW: "node.view", VM_MIGRATE: "vm.migrate" },
}))

vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: (s: string) => `plain:${s}` }))

const { pveFetchMock, getConnectionMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn(), getConnectionMock: vi.fn() }))

vi.mock("@/lib/connections/getConnection", async (orig) => ({
  ...(await orig<typeof import("@/lib/connections/getConnection")>()),
  getConnectionById: (...a: any[]) => getConnectionMock(...a),
}))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

vi.mock("@/lib/orchestrator/headers", () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => extra,
}))

const fetchMock = vi.fn(async (..._args: any[]) => ({ ok: true, status: 201, json: async () => ({ id: "d-1", node: "pve3" }) }))
vi.stubGlobal("fetch", fetchMock)

import { GET, POST } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  getConnectionMock.mockResolvedValue({ id: "c1" })
  pveFetchMock.mockResolvedValue([{ type: "node", node: "pve1" }, { type: "node", node: "pve2" }, { type: "node", node: "pve3" }, { type: "qemu", node: "pve3", vmid: 105, status: "running" }])
  checkPermissionMock.mockResolvedValue(null)
  connFindUniqueMock.mockResolvedValue({
    id: "c1", sshEnabled: true, sshPort: 2222, sshUser: "root", sshAuthMethod: "password", sshKeyEnc: null, sshPassEnc: "pw",
  })
  hostFindManyMock.mockResolvedValue([{ node: "pve3", sshAddress: "10.42.0.103", sshPort: null }])
  tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))
  infraMock.mockResolvedValue({ kind: "provider" })
})

function sent() {
  const init = fetchMock.mock.calls[0][1] as RequestInit
  return JSON.parse(init.body as string)
}

describe("POST /api/v1/orchestrator/host-drains", () => {
  it("forwards the SSH credentials and overrides for the maintenance path", async () => {
    const res = await callRoute(POST, {
      body: { connection_id: "c1", node: "pve3", config: { enter_maintenance: true, max_concurrent_migrations: 3, ssh_credentials: { sshPassword: "forged" } } },
    })
    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith("node.manage", "node", "c1:pve3")
    const body = sent()
    expect(body.node).toBe("pve3")
    expect(body.config.max_concurrent_migrations).toBe(3)
    expect(body.config.ssh_credentials).toEqual({ sshEnabled: true, sshPort: 2222, sshUser: "root", sshAuthMethod: "password", sshPassword: "plain:pw" })
    expect(body.config.ssh_overrides).toEqual({ pve3: { address: "10.42.0.103" } })
  })

  it("refuses a forced target the caller does not manage, and excludes the others from automatic placement", async () => {
    checkPermissionMock.mockImplementation(async (_p: string, _t: string, id: string) => (id === "c1:pve2" ? new Response(null, { status: 403 }) : null))

    const forced = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: { target_node: "pve2" } } })
    expect(forced.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()

    const auto = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: {} } })
    expect(auto.status).toBe(200)
    expect(sent().config.exclude_nodes).toEqual(["pve2"])
  })

  it("refuses a malformed setting before reaching the orchestrator", async () => {
    const res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: { target_node: "pve2;reboot" } } })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/target_node/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses a drain on a cluster the caller does not own, a vDC's shared one included", async () => {
    infraMock.mockResolvedValue({ kind: "iaas", vdcScope: { connectionIds: new Set(["c1"]) } })
    const res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: {} } })
    expect(res.status).toBe(404)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("sends no credentials for Migrate all VMs", async () => {
    const res = await callRoute(POST, {
      body: { connection_id: "c1", node: "pve3", config: { enter_maintenance: false, target_node: "pve1", ssh_credentials: { sshPassword: "forged" } } },
    })
    expect(res.status).toBe(200)
    expect(sent().config).toEqual({ enter_maintenance: false, target_node: "pve1" })
  })

  it("refuses the maintenance path when SSH is not configured", async () => {
    connFindUniqueMock.mockResolvedValue({ id: "c1", sshEnabled: false })
    const res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: { enter_maintenance: true } } })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("validates the node name before it reaches the orchestrator", async () => {
    const res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3; rm -rf /", config: {} } })
    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("answers 404 for an unknown connection and relays the orchestrator refusal", async () => {
    connFindUniqueMock.mockResolvedValue(null)
    expect((await callRoute(POST, { body: { connection_id: "nope", node: "pve3", config: {} } })).status).toBe(404)

    connFindUniqueMock.mockResolvedValue({ id: "c1" })
    fetchMock.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: "a host drain is already running on this cluster" }) } as any)
    const res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: {} } })
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "a host drain is already running on this cluster" })
  })

  it("honours the permission verdict", async () => {
    checkPermissionMock.mockResolvedValue(new Response(null, { status: 403 }))
    const res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: {} } })
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/orchestrator/host-drains", () => {
  it("keeps only the drains of the caller's connections", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => [{ id: "a", connection_id: "c1" }, { id: "b", connection_id: "c2" }, { id: "c" }],
    } as any)
    infraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)
    expect((await res.json()).data.map((d: any) => d.id)).toEqual(["a"])
  })

  it("shows a vDC tenant no drain, not even on the cluster its vDC shares", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: "a", connection_id: "c1" }] } as any)
    infraMock.mockResolvedValue({ kind: "iaas", vdcScope: { connectionIds: new Set(["c1"]) } })
    const res = await callRoute(GET, { method: "GET" })
    expect((await res.json()).data).toEqual([])
  })

  it("lets the provider see a row with no connection", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, status: 200, json: async () => [{ id: "c" }] } as any)
    const res = await callRoute(GET, { method: "GET" })
    expect((await res.json()).data.map((d: any) => d.id)).toEqual(["c"])
  })

  it("answers 404 for a connection outside the perimeter", async () => {
    infraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })
    const res = await callRoute(GET, { method: "GET", searchParams: { connection_id: "c9" } })
    expect(res.status).toBe(404)
  })
})

describe("host drains, orchestrator failures", () => {
  it("relays a listing refusal and reports an unreachable orchestrator", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) } as any)
    let res = await callRoute(GET, { url: "http://localhost/api/v1/orchestrator/host-drains" })
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe("Failed to list host drains")

    fetchMock.mockRejectedValueOnce(Object.assign(new Error("Orchestrator unavailable"), { code: "ORCHESTRATOR_UNAVAILABLE" }))
    res = await callRoute(GET, { url: "http://localhost/api/v1/orchestrator/host-drains" })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe("Orchestrator unavailable")
  })

  it("requires the connection and the node, and reports an unreachable orchestrator on start", async () => {
    let res = await callRoute(POST, { body: { connection_id: "c1" } })
    expect(res.status).toBe(400)

    fetchMock.mockRejectedValueOnce(Object.assign(new Error("Orchestrator unavailable"), { code: "ORCHESTRATOR_UNAVAILABLE" }))
    res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: {} } })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe("Orchestrator unavailable")
  })

  it("never starts a maintenance drain when the SSH secret cannot be read or the connection is gone", async () => {
    connFindUniqueMock.mockResolvedValueOnce(null)
    let res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: { enter_maintenance: true } } })
    expect(res.status).toBe(404)

    connFindUniqueMock.mockRejectedValueOnce(new Error("bad key"))
    res = await callRoute(POST, { body: { connection_id: "c1", node: "pve3", config: { enter_maintenance: true } } })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe("Failed to decrypt SSH credentials")
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
