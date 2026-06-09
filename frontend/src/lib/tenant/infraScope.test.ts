import { beforeEach, describe, expect, it, vi } from "vitest"

const { tenantFindUniqueMock, connFindManyMock, getVdcScopeMock } = vi.hoisted(() => ({
  tenantFindUniqueMock: vi.fn(),
  connFindManyMock: vi.fn(),
  getVdcScopeMock: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: { tenant: { findUnique: tenantFindUniqueMock }, connection: { findMany: connFindManyMock } },
}))
vi.mock("@/lib/vdc/scope", () => ({ getVdcScope: getVdcScopeMock }))

import { getTenantInfrastructureScope, pveConnectionFilter, maskingScope, inventoryConnectionPlan, canMigrateConnections } from "./infraScope"

beforeEach(() => {
  tenantFindUniqueMock.mockReset()
  connFindManyMock.mockReset()
  getVdcScopeMock.mockReset()
})

describe("getTenantInfrastructureScope", () => {
  it("returns provider for the default tenant without a DB lookup", async () => {
    const infra = await getTenantInfrastructureScope("default")
    expect(infra).toEqual({ kind: "provider" })
    expect(pveConnectionFilter(infra)).toBeNull()
    expect(maskingScope(infra)).toBeNull()
    expect(tenantFindUniqueMock).not.toHaveBeenCalled()
  })

  it("returns msp with the directly-owned connection ids", async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: "msp" })
    connFindManyMock.mockResolvedValue([{ id: "c1" }, { id: "c2" }])
    const infra = await getTenantInfrastructureScope("t-msp")
    expect(infra.kind).toBe("msp")
    expect(pveConnectionFilter(infra)).toEqual(new Set(["c1", "c2"]))
    expect(maskingScope(infra)).toBeNull()
    expect(connFindManyMock).toHaveBeenCalledWith({ where: { tenantId: "t-msp" }, select: { id: true } })
  })

  it("returns iaas falling back to getVdcScope for a vDC tenant", async () => {
    tenantFindUniqueMock.mockResolvedValue({ operatingModel: "iaas" })
    const vdcScope = { connectionIds: new Set(["p1"]), pbsConnectionIds: new Set(["pbs1"]) }
    getVdcScopeMock.mockResolvedValue(vdcScope)
    const infra = await getTenantInfrastructureScope("t-iaas")
    expect(infra.kind).toBe("iaas")
    expect(pveConnectionFilter(infra)).toEqual(new Set(["p1"]))
    expect(maskingScope(infra)).toBe(vdcScope)
    expect(getVdcScopeMock).toHaveBeenCalledWith("t-iaas")
  })
})

describe("canMigrateConnections", () => {
  it("provider always returns true regardless of connection ids", () => {
    expect(canMigrateConnections({ kind: "provider" }, "any-id", "other-id")).toBe(true)
    expect(canMigrateConnections({ kind: "provider" })).toBe(true)
  })

  it("msp returns true when it owns ALL given connection ids", () => {
    const infra = { kind: "msp" as const, connectionIds: new Set(["c1", "c2"]) }
    expect(canMigrateConnections(infra, "c1")).toBe(true)
    expect(canMigrateConnections(infra, "c1", "c2")).toBe(true)
  })

  it("msp returns false when at least one connection id is not owned", () => {
    const infra = { kind: "msp" as const, connectionIds: new Set(["c1"]) }
    expect(canMigrateConnections(infra, "c1", "c2")).toBe(false)
    expect(canMigrateConnections(infra, "c3")).toBe(false)
  })

  it("iaas always returns false regardless of connection ids", () => {
    const vdcScope: any = { connectionIds: new Set(["c1"]), pbsConnectionIds: new Set() }
    const infra = { kind: "iaas" as const, vdcScope }
    expect(canMigrateConnections(infra, "c1")).toBe(false)
    expect(canMigrateConnections(infra)).toBe(false)
  })
})

describe("inventoryConnectionPlan", () => {
  it("provider: global client, no PVE id filter, global PBS/ext", () => {
    expect(inventoryConnectionPlan({ kind: "provider" })).toEqual({
      pveClient: "global", pveConnectionIds: null, pbsExtClient: "global",
    })
  })
  it("msp: session client throughout, no PVE id filter", () => {
    expect(inventoryConnectionPlan({ kind: "msp", connectionIds: new Set(["c1"]) })).toEqual({
      pveClient: "session", pveConnectionIds: null, pbsExtClient: "session",
    })
  })
  it("iaas: global PVE filtered by vDC ids, session PBS/ext", () => {
    const vdcScope: any = { connectionIds: new Set(["p1", "p2"]), pbsConnectionIds: new Set() }
    const plan = inventoryConnectionPlan({ kind: "iaas", vdcScope })
    expect(plan.pveClient).toBe("global")
    expect(new Set(plan.pveConnectionIds)).toEqual(new Set(["p1", "p2"]))
    expect(plan.pbsExtClient).toBe("session")
  })
})
