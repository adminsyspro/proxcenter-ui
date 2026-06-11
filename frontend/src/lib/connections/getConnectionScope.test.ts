import { beforeEach, describe, expect, it, vi } from "vitest"

// Hoist mocks so they are available in vi.mock factories
const { findUniqueMock, vdcFindFirstMock, getVdcScopeMock, checkPermissionMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  vdcFindFirstMock: vi.fn(),
  getVdcScopeMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: "connection.view", BACKUP_VIEW: "backup.view" },
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findUnique: findUniqueMock },
    vdc: { findFirst: vdcFindFirstMock },
  },
}))

// Mutable variable: getCurrentTenantId returns this (the session tenant)
let currentTenantId = "default"

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => currentTenantId,
}))

vi.mock("@/lib/vdc/scope", () => ({
  getVdcScope: getVdcScopeMock,
}))

vi.mock("@/lib/crypto/secret", () => ({
  decryptSecret: (s: string) => `dec:${s}`,
}))

import {
  getConnectionById,
  getPbsConnectionById,
  invalidateConnectionCache,
} from "./getConnection"

function connRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "c1",
    name: "MSP cluster",
    type: "pve",
    baseUrl: "https://10.0.0.1:8006",
    behindProxy: false,
    insecureTLS: false,
    apiTokenEnc: "enc-token",
    tenantId: "msp-1",
    ...overrides,
  }
}

beforeEach(() => {
  findUniqueMock.mockReset()
  vdcFindFirstMock.mockReset().mockResolvedValue(null)
  getVdcScopeMock.mockReset().mockResolvedValue(null)
  checkPermissionMock.mockReset().mockResolvedValue(null)
  currentTenantId = "default"
  // The module keeps a 60s in-memory cache keyed by tenantId:id
  invalidateConnectionCache()
})

const DENIED = () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })

describe("getConnectionById tenant isolation", () => {
  it("provider (default tenant) with connection.view resolves an MSP-owned connection", async () => {
    findUniqueMock.mockResolvedValue(connRow())

    const conn = await getConnectionById("c1")

    expect(conn.id).toBe("c1")
    expect(conn.apiToken).toBe("dec:enc-token")
    expect(conn.tenantId).toBe("msp-1")
    // The fleet guard ran with the connection-scoped permission
    expect(checkPermissionMock).toHaveBeenCalledWith("connection.view", "connection", "c1")
    // The vDC fallback must never run for the provider
    expect(vdcFindFirstMock).not.toHaveBeenCalled()
  })

  it("scoped default-tenant caller without connection.view is rejected on MSP-owned rows", async () => {
    findUniqueMock.mockResolvedValue(connRow())
    checkPermissionMock.mockResolvedValue(DENIED())

    await expect(getConnectionById("c1")).rejects.toThrow(/Connection not found/)
  })

  it("background callers without a session (401) pass the fleet guard", async () => {
    findUniqueMock.mockResolvedValue(connRow())
    checkPermissionMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "Not authenticated" }), { status: 401 })
    )

    const conn = await getConnectionById("c1")

    expect(conn.id).toBe("c1")
  })

  it("internal callers passing an explicit tenantId skip the session RBAC guard", async () => {
    findUniqueMock.mockResolvedValue(connRow({ tenantId: "msp-1" }))

    const conn = await getConnectionById("c1", "msp-1")

    expect(conn.id).toBe("c1")
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it("a cached cross-tenant entry re-asserts the fleet guard for session callers", async () => {
    findUniqueMock.mockResolvedValue(connRow())

    // Authorized caller populates the per-tenant cache
    await getConnectionById("c1")

    // A scoped caller on the same tenant must not be served from cache
    checkPermissionMock.mockResolvedValue(DENIED())
    await expect(getConnectionById("c1")).rejects.toThrow(/Connection not found/)
  })

  it("default-tenant access to default-owned (pool) rows never hits the guard", async () => {
    findUniqueMock.mockResolvedValue(connRow({ tenantId: "default" }))

    const conn = await getConnectionById("c1")

    expect(conn.id).toBe("c1")
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it("non-provider tenant cannot load a row owned by another tenant", async () => {
    currentTenantId = "msp-2"
    findUniqueMock.mockResolvedValue(connRow({ tenantId: "msp-1" }))

    await expect(getConnectionById("c1")).rejects.toThrow(/Connection not found/)
  })

  it("non-provider tenant resolves its own row", async () => {
    currentTenantId = "msp-1"
    findUniqueMock.mockResolvedValue(connRow({ tenantId: "msp-1" }))

    const conn = await getConnectionById("c1")

    expect(conn.id).toBe("c1")
  })

  it("iaas tenant resolves a provider-owned row through its vDC assignment", async () => {
    currentTenantId = "tenant-iaas"
    findUniqueMock.mockResolvedValue(connRow({ tenantId: "default" }))
    vdcFindFirstMock.mockResolvedValue({ id: "vdc-1" })

    const conn = await getConnectionById("c1")

    expect(conn.id).toBe("c1")
    expect(vdcFindFirstMock).toHaveBeenCalled()
  })

  it("missing row still throws for the provider", async () => {
    findUniqueMock.mockResolvedValue(null)

    await expect(getConnectionById("nope")).rejects.toThrow(/Connection not found/)
  })
})

describe("getPbsConnectionById tenant isolation", () => {
  it("provider (default tenant) with backup.view resolves an MSP-owned PBS connection", async () => {
    findUniqueMock.mockResolvedValue(connRow({ id: "pbs1", type: "pbs", tenantId: "msp-1" }))

    const conn = await getPbsConnectionById("pbs1")

    expect(conn.id).toBe("pbs1")
    expect(checkPermissionMock).toHaveBeenCalledWith("backup.view", "pbs", "pbs1")
    expect(getVdcScopeMock).not.toHaveBeenCalled()
  })

  it("scoped default-tenant caller without backup.view is rejected on MSP-owned PBS rows", async () => {
    findUniqueMock.mockResolvedValue(connRow({ id: "pbs1", type: "pbs", tenantId: "msp-1" }))
    checkPermissionMock.mockResolvedValue(DENIED())

    await expect(getPbsConnectionById("pbs1")).rejects.toThrow(/PBS Connection not found/)
  })

  it("non-provider tenant without a vDC PBS binding is rejected", async () => {
    currentTenantId = "msp-2"
    findUniqueMock.mockResolvedValue(connRow({ id: "pbs1", type: "pbs", tenantId: "msp-1" }))
    getVdcScopeMock.mockResolvedValue(null)

    await expect(getPbsConnectionById("pbs1")).rejects.toThrow(/Connection not found/)
  })
})
