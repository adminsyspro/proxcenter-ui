import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

// A customer tenant may not point a new connection at this host (loopback, the
// metadata range, the unspecified address): the POST route asks the guard
// before anything is probed or written; the provider tenant is never routed
// through it.
const { connectionCreateMock, guardMock, tenant } = vi.hoisted(() => ({
  connectionCreateMock: vi.fn(),
  guardMock: vi.fn(),
  tenant: { id: "default" },
}))

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({ connection: { create: connectionCreateMock } }),
  getCurrentTenantId: async () => tenant.id,
  DEFAULT_TENANT_ID: "default",
}))
vi.mock("@/lib/net/base-url-guard", () => ({ tenantBaseUrlRefusal: (...a: unknown[]) => guardMock(...a) }))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: async () => ({ kind: "provider" }),
  inventoryConnectionPlan: vi.fn(),
  maskingScope: () => null,
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findMany: vi.fn().mockResolvedValue([]) },
    tenant: { findUnique: vi.fn() },
    $transaction: async (cb: any) => cb({ connection: { create: connectionCreateMock }, providerConnection: { create: vi.fn() } }),
  },
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: async () => null,
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", CONNECTION_MANAGE: "connection.manage" },
}))
vi.mock("@/lib/crypto/secret", () => ({ encryptSecret: (s: string) => `enc:${s}` }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn().mockResolvedValue({}) }))
vi.mock("@/lib/proxmox/pbs-client", () => ({ pbsFetch: vi.fn().mockResolvedValue({}) }))
vi.mock("@/lib/orchestrator/client", () => ({ orchestratorFetch: vi.fn().mockResolvedValue({}) }))
vi.mock("@/lib/proxmox/discoverNodeIps", () => ({ discoverNodeIps: vi.fn().mockResolvedValue(undefined) }))
vi.mock("@/lib/proxmox/pbsFingerprint", () => ({ captureFingerprint: vi.fn().mockResolvedValue(null) }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

import { POST } from "./route"

const PVE_BODY = { name: "Client cluster", type: "pve", baseUrl: "https://127.0.0.1:8006", apiToken: "root@pam!t=secret" }

beforeEach(() => {
  tenant.id = "default"
  guardMock.mockReset().mockResolvedValue(null)
  connectionCreateMock.mockReset().mockImplementation(async ({ data }: any) => ({ id: "c-new", type: data.type, name: data.name }))
})

describe("POST /api/v1/connections base URL guard", () => {
  it("refuses a customer tenant whose baseUrl the guard rejects, before anything is created", async () => {
    tenant.id = "msp-1"
    guardMock.mockResolvedValue('Connection address "127.0.0.1" is not allowed: loopback address')

    const res = await callRoute(POST, { method: "POST", body: PVE_BODY })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/loopback/)
    expect(guardMock).toHaveBeenCalledWith("https://127.0.0.1:8006")
    expect(connectionCreateMock).not.toHaveBeenCalled()
  })

  it("creates the connection when the guard accepts the address", async () => {
    tenant.id = "msp-1"

    const res = await callRoute(POST, { method: "POST", body: { ...PVE_BODY, baseUrl: "https://10.0.0.1:8006" } })

    expect(res.status).toBeLessThan(300)
    expect(guardMock).toHaveBeenCalledWith("https://10.0.0.1:8006")
    expect(connectionCreateMock).toHaveBeenCalled()
  })

  it("never consults the guard for the provider tenant", async () => {
    const res = await callRoute(POST, { method: "POST", body: PVE_BODY })

    expect(res.status).toBeLessThan(300)
    expect(guardMock).not.toHaveBeenCalled()
  })
})
