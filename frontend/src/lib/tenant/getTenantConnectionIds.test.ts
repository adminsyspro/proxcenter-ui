import { beforeEach, describe, expect, it, vi } from "vitest"

// getTenantConnectionIds, getCurrentTenantId and getSessionPrisma all live in
// the same module under test, so we mock their EXTERNAL dependencies rather
// than the module itself.
//  - getServerSession (next-auth) feeds getCurrentTenantId the tenant id.
//  - prisma (@/lib/db/prisma) provides the GLOBAL connection.findMany used by
//    the provider branch AND a $extends stub returning the SESSION client used
//    by the non-provider branch. tenant.findUnique answers the enabled-tenant
//    guard inside getCurrentTenantId.
//  - getVdcScope (@/lib/vdc/scope) is dynamically imported and unioned in for
//    non-provider tenants.
const {
  getServerSessionMock,
  findManyGlobalMock,
  findManySessionMock,
  tenantFindUniqueMock,
  getVdcScopeMock,
} = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  findManyGlobalMock: vi.fn(),
  findManySessionMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
  getVdcScopeMock: vi.fn(),
}))

vi.mock("next-auth", () => ({ getServerSession: getServerSessionMock }))
vi.mock("@/lib/auth/config", () => ({ authOptions: {} }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findMany: findManyGlobalMock },
    tenant: { findUnique: tenantFindUniqueMock },
    $extends: () => ({ connection: { findMany: findManySessionMock } }),
  },
}))
vi.mock("@/lib/vdc/scope", () => ({ getVdcScope: getVdcScopeMock }))

import { getTenantConnectionIds } from "./index"

beforeEach(() => {
  getServerSessionMock.mockReset()
  findManyGlobalMock.mockReset().mockResolvedValue([])
  findManySessionMock.mockReset().mockResolvedValue([])
  tenantFindUniqueMock.mockReset()
  getVdcScopeMock.mockReset().mockResolvedValue(null)
})

describe("getTenantConnectionIds", () => {
  it("provider (default): returns the WHOLE fleet from the GLOBAL client; session client untouched", async () => {
    // No user.id in the session, so getCurrentTenantId skips the membership guard.
    getServerSessionMock.mockResolvedValue({ user: { tenantId: "default" } })
    tenantFindUniqueMock.mockResolvedValue({ id: "default", enabled: true })
    findManyGlobalMock.mockResolvedValue([
      { id: "pve-pool" },
      { id: "pve-msp-owned" },
      { id: "pbs1" },
    ])

    const ids = await getTenantConnectionIds()

    expect(ids).toEqual(new Set(["pve-pool", "pve-msp-owned", "pbs1"]))
    expect(findManyGlobalMock).toHaveBeenCalled()
    expect(findManySessionMock).not.toHaveBeenCalled()
  })

  it("msp: returns only session-owned ids; GLOBAL client untouched; empty vDC scope adds nothing", async () => {
    getServerSessionMock.mockResolvedValue({ user: { tenantId: "msp-1" } })
    tenantFindUniqueMock.mockResolvedValue({ id: "msp-1", enabled: true })
    findManySessionMock.mockResolvedValue([{ id: "c1" }, { id: "c2" }])
    getVdcScopeMock.mockResolvedValue(null)

    const ids = await getTenantConnectionIds()

    expect(ids).toEqual(new Set(["c1", "c2"]))
    expect(findManySessionMock).toHaveBeenCalled()
    expect(findManyGlobalMock).not.toHaveBeenCalled()
  })

  it("iaas: unions session-owned (empty) with vDC connectionIds + pbsConnectionIds", async () => {
    getServerSessionMock.mockResolvedValue({ user: { tenantId: "iaas-1" } })
    tenantFindUniqueMock.mockResolvedValue({ id: "iaas-1", enabled: true })
    findManySessionMock.mockResolvedValue([])
    getVdcScopeMock.mockResolvedValue({
      connectionIds: new Set(["p1", "p2"]),
      pbsConnectionIds: new Set(["pbs1"]),
    })

    const ids = await getTenantConnectionIds()

    expect(ids).toEqual(new Set(["p1", "p2", "pbs1"]))
    expect(findManySessionMock).toHaveBeenCalled()
    expect(findManyGlobalMock).not.toHaveBeenCalled()
    expect(getVdcScopeMock).toHaveBeenCalledWith("iaas-1")
  })
})
