import { beforeEach, describe, expect, it, vi } from "vitest"

// getTenantPrisma hands a query extension to prisma.$extends. The mock
// captures that extension so each hook can be driven with a fake `query`.
const { extendsMock, findUniqueBase } = vi.hoisted(() => ({
  extendsMock: vi.fn((ext: any) => ext),
  findUniqueBase: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: { $extends: extendsMock, connection: { findUnique: findUniqueBase } },
}))
vi.mock("@/lib/auth/principal", () => ({ getPrincipal: vi.fn() }))

import { getTenantPrisma } from "./index"

function hooks(tenantId = "t-acme") {
  getTenantPrisma(tenantId)
  return extendsMock.mock.calls.at(-1)![0].query.$allModels
}

beforeEach(() => {
  extendsMock.mockClear()
  findUniqueBase.mockReset()
})

describe("getTenantPrisma query extension", () => {
  it.each(["findMany", "findFirst", "updateMany", "deleteMany", "count", "aggregate", "groupBy"])(
    "%s adds the tenant filter to where and returns the query result",
    async (op) => {
      const result = { op }
      const query = vi.fn(async () => result)
      const args: any = { where: { name: "pve-prod" } }
      await expect(hooks()[op]({ model: "Connection", args, query })).resolves.toBe(result)
      expect(query).toHaveBeenCalledWith({ where: { name: "pve-prod", tenantId: "t-acme" } })
    },
  )

  it("overrides a caller-supplied tenantId in where", async () => {
    const query = vi.fn(async () => 3)
    await expect(hooks().count({ model: "Connection", args: { where: { tenantId: "t-other" } }, query })).resolves.toBe(3)
    expect(query).toHaveBeenCalledWith({ where: { tenantId: "t-acme" } })
  })

  it("create stamps tenantId on data", async () => {
    const query = vi.fn(async (a: any) => ({ id: "c1", ...a.data }))
    await expect(hooks().create({ model: "Connection", args: { data: { name: "pbs", tenantId: "t-evil" } }, query }))
      .resolves.toEqual({ id: "c1", name: "pbs", tenantId: "t-acme" })
    expect(query).toHaveBeenCalledWith({ data: { name: "pbs", tenantId: "t-acme" } })
  })

  it("createMany stamps tenantId on array and single data", async () => {
    const query = vi.fn(async () => ({ count: 2 }))
    const h = hooks()
    await expect(h.createMany({ model: "Connection", args: { data: [{ name: "a" }, { name: "b" }] }, query })).resolves.toEqual({ count: 2 })
    expect(query).toHaveBeenLastCalledWith({ data: [{ name: "a", tenantId: "t-acme" }, { name: "b", tenantId: "t-acme" }] })
    await h.createMany({ model: "Connection", args: { data: { name: "c" } }, query })
    expect(query).toHaveBeenLastCalledWith({ data: { name: "c", tenantId: "t-acme" } })
  })
})
