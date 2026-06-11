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
vi.mock("@/lib/vdc/pbsOrchestrator", () => ({ unbindFromVdc: unbindMock }))

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

describe("DELETE /api/v1/connections/[id] (PBS binding cleanup)", () => {
  it("unbinds every vDC PBS binding before deleting a PBS connection", async () => {
    bindingsFindManyMock.mockResolvedValue([{ id: "bind-1" }, { id: "bind-2" }])

    const res = await callRoute(DELETE, { params: { id: "pbs-1" }, method: "DELETE" })

    expect(res.status).toBe(200)
    expect(bindingsFindManyMock).toHaveBeenCalledWith({
      where: { pbsConnectionId: "pbs-1" },
      select: { id: true },
    })
    expect(unbindMock).toHaveBeenCalledTimes(2)
    expect(unbindMock).toHaveBeenCalledWith("bind-1")
    expect(unbindMock).toHaveBeenCalledWith("bind-2")
    // The unbinds ran BEFORE the row deletion
    expect(Math.max(...unbindMock.mock.invocationCallOrder)).toBeLessThan(
      sessionDeleteMock.mock.invocationCallOrder[0]
    )
  })

  it("does not query bindings when deleting a PVE connection", async () => {
    sessionFindUniqueMock.mockResolvedValue({
      name: "PVE prod",
      type: "pve",
      baseUrl: "https://pve:8006",
    })

    const res = await callRoute(DELETE, { params: { id: "pve-1" }, method: "DELETE" })

    expect(res.status).toBe(200)
    expect(bindingsFindManyMock).not.toHaveBeenCalled()
    expect(unbindMock).not.toHaveBeenCalled()
  })

  it("a failed unbind never blocks the deletion (best-effort)", async () => {
    bindingsFindManyMock.mockResolvedValue([{ id: "bind-1" }])
    unbindMock.mockRejectedValue(new Error("PBS unreachable"))

    const res = await callRoute(DELETE, { params: { id: "pbs-1" }, method: "DELETE" })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.ok).toBe(true)
    expect(sessionDeleteMock).toHaveBeenCalled()
  })
})
