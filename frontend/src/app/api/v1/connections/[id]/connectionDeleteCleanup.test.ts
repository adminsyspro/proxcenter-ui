import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

// Hoist mocks so they are available in vi.mock factories
const {
  sessionFindUniqueMock,
  sessionDeleteMock,
  managedHostDeleteManyMock,
  bindingsFindManyMock,
  unbindMock,
  checkPermissionMock,
} = vi.hoisted(() => ({
  sessionFindUniqueMock: vi.fn(),
  sessionDeleteMock: vi.fn(),
  managedHostDeleteManyMock: vi.fn(),
  bindingsFindManyMock: vi.fn(),
  unbindMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({
    connection: { findUnique: sessionFindUniqueMock, delete: sessionDeleteMock },
    managedHost: { deleteMany: managedHostDeleteManyMock },
  }),
  getCurrentTenantId: async () => "default",
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findUnique: vi.fn() },
    vdcPbsNamespace: { findMany: bindingsFindManyMock },
  },
}))

vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: vi.fn(async () => ({ kind: "provider" })),
  maskingScope: () => null,
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: {
    CONNECTION_VIEW: "connection.view",
    CONNECTION_MANAGE: "connection.manage",
  },
}))

vi.mock("@/lib/crypto/secret", () => ({
  encryptSecret: (s: string) => `enc:${s}`,
  decryptSecret: (s: string) => s,
}))
vi.mock("@/lib/schemas", () => ({
  updateConnectionSchema: { safeParse: (b: any) => ({ success: true, data: b }) },
}))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: vi.fn() }))
vi.mock("@/lib/proxmox/discoverNodeIps", () => ({ discoverNodeIps: vi.fn() }))
vi.mock("@/lib/orchestrator/client", () => ({
  orchestratorFetch: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))
vi.mock("@/lib/connections/getConnection", () => ({ invalidateConnectionCache: vi.fn() }))
vi.mock("@/lib/cache/inventoryCache", () => ({ invalidateInventoryCache: vi.fn() }))
vi.mock("@/lib/connections/connectionUsage", () => ({
  connectionUsage: vi.fn(async () => ({ blocking: {}, apiTokens: [] })),
  isBlocked: () => false,
}))
const { evictGuestCoverageMock } = vi.hoisted(() => ({ evictGuestCoverageMock: vi.fn() }))
vi.mock("@/lib/firewall/guestCoverage", () => ({ evictGuestCoverage: evictGuestCoverageMock }))
const { evictGroupUsageMock } = vi.hoisted(() => ({ evictGroupUsageMock: vi.fn() }))
vi.mock("@/lib/firewall/groupUsage", () => ({ evictGroupUsage: evictGroupUsageMock }))

import { DELETE as deleteRoute } from "./route"

const DELETE = deleteRoute as Parameters<typeof callRoute>[0]

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  sessionFindUniqueMock.mockResolvedValue({
    name: "PBS prod",
    type: "pbs",
    baseUrl: "https://pbs:8007",
  })
  sessionDeleteMock.mockResolvedValue({})
  managedHostDeleteManyMock.mockResolvedValue({ count: 0 })
  bindingsFindManyMock.mockResolvedValue([])
  unbindMock.mockResolvedValue(undefined)
})

describe("DELETE /api/v1/connections/[id] (cleanup)", () => {
  it("no longer unbinds a PBS behind the tenant's back: one in use is refused by the usage check (ui#1394)", async () => {
    const res = await callRoute(DELETE, { params: { id: "pbs-1" }, method: "DELETE" })

    expect(res.status).toBe(200)
    expect(bindingsFindManyMock).not.toHaveBeenCalled()
    expect(unbindMock).not.toHaveBeenCalled()
    expect(sessionDeleteMock).toHaveBeenCalled()
  })

  it("evicts the firewall coverage held for the deleted connection (UA44)", async () => {
    sessionFindUniqueMock.mockResolvedValue({ name: "PVE prod", type: "pve", baseUrl: "https://pve:8006" })

    const res = await callRoute(DELETE, { params: { id: "pve-1" }, method: "DELETE" })

    expect(res.status).toBe(200)
    expect(evictGuestCoverageMock).toHaveBeenCalledWith("pve-1")
    expect(evictGroupUsageMock).toHaveBeenCalledWith("pve-1")
  })
})
