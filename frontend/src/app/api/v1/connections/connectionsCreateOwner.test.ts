import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

// Hoist mocks so they are available in vi.mock factories
const {
  checkPermissionMock,
  getInfraMock,
  tenantFindUniqueMock,
  connectionCreateMock,
  poolCreateMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getInfraMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
  connectionCreateMock: vi.fn(),
  poolCreateMock: vi.fn(),
}))

// Mutable variable: getCurrentTenantId returns this (the session tenant)
let currentTenantId = "default"

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({ connection: { create: connectionCreateMock } }),
  getCurrentTenantId: async () => currentTenantId,
  DEFAULT_TENANT_ID: "default",
}))

vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: getInfraMock,
  inventoryConnectionPlan: vi.fn(),
  maskingScope: () => null,
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findMany: vi.fn().mockResolvedValue([]) },
    tenant: { findUnique: tenantFindUniqueMock },
    $transaction: async (cb: any) =>
      cb({
        connection: { create: connectionCreateMock },
        providerConnection: { create: poolCreateMock },
      }),
  },
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", CONNECTION_MANAGE: "connection.manage" },
}))

vi.mock("@/lib/crypto/secret", () => ({ encryptSecret: (s: string) => `enc:${s}` }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn().mockResolvedValue({}) }))
vi.mock("@/lib/proxmox/pbs-client", () => ({ pbsFetch: vi.fn().mockResolvedValue({}) }))
vi.mock("@/lib/orchestrator/client", () => ({
  orchestratorFetch: vi.fn().mockResolvedValue({}),
}))
vi.mock("@/lib/proxmox/discoverNodeIps", () => ({
  discoverNodeIps: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/proxmox/pbsFingerprint", () => ({
  captureFingerprint: vi.fn().mockResolvedValue(null),
}))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

import { POST } from "./route"

const PVE_BODY = {
  name: "Client cluster",
  type: "pve",
  baseUrl: "https://10.0.0.1:8006",
  apiToken: "root@pam!t=secret",
}

beforeEach(() => {
  vi.clearAllMocks()
  currentTenantId = "default"
  checkPermissionMock.mockResolvedValue(null)
  getInfraMock.mockResolvedValue({ kind: "provider" })
  tenantFindUniqueMock.mockResolvedValue({ operatingModel: "msp", enabled: true })
  connectionCreateMock.mockImplementation(async ({ data }: any) => ({
    id: "c-new",
    type: data.type,
    name: data.name,
  }))
  poolCreateMock.mockResolvedValue({})
})

describe("POST /api/v1/connections (create-with-owner)", () => {
  it("provider creates a PVE connection owned by an MSP tenant, without a pool row", async () => {
    const res = await callRoute(POST, { body: { ...PVE_BODY, ownerTenantId: "msp-1" } })

    expect(res.status).toBe(201)
    expect(connectionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: "msp-1" }) })
    )
    expect(poolCreateMock).not.toHaveBeenCalled()
  })

  it("defaults to the session tenant and creates the pool row for provider PVE", async () => {
    const res = await callRoute(POST, { body: PVE_BODY })

    expect(res.status).toBe(201)
    expect(connectionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tenantId: "default" }) })
    )
    expect(poolCreateMock).toHaveBeenCalledWith({ data: { connectionId: "c-new" } })
  })

  it("rejects ownerTenantId from a non-provider caller", async () => {
    currentTenantId = "msp-2"
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set() })

    const res = await callRoute(POST, { body: { ...PVE_BODY, ownerTenantId: "msp-1" } })

    expect(res.status).toBe(403)
    expect(connectionCreateMock).not.toHaveBeenCalled()
  })

  it("rejects a non-MSP owner tenant", async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: "iaas" })

    const res = await callRoute(POST, { body: { ...PVE_BODY, ownerTenantId: "tenant-iaas" } })

    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/MSP tenant/)
  })

  it("rejects a disabled owner tenant", async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: "msp", enabled: false })

    const res = await callRoute(POST, { body: { ...PVE_BODY, ownerTenantId: "msp-off" } })

    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/disabled/)
  })

  it("rejects an unknown owner tenant", async () => {
    tenantFindUniqueMock.mockResolvedValue(null)

    const res = await callRoute(POST, { body: { ...PVE_BODY, ownerTenantId: "nope" } })

    expect(res.status).toBe(400)
  })

  it("rejects MSP ownership for migration-source connection types", async () => {
    const res = await callRoute(POST, {
      body: {
        ...PVE_BODY,
        type: "vmware",
        vmwareUser: "root",
        vmwarePassword: "pass",
        ownerTenantId: "msp-1",
      },
    })

    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/PVE and PBS/)
  })
})
