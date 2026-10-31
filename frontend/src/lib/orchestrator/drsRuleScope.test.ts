import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  getCurrentTenantId: vi.fn(),
  getTenantConnectionIds: vi.fn(),
  requireProviderTenant: vi.fn(),
  ownedFindMany: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: h.getCurrentTenantId,
  getTenantConnectionIds: h.getTenantConnectionIds,
  getSessionPrisma: async () => ({ connection: { findMany: h.ownedFindMany } }),
  requireProviderTenant: h.requireProviderTenant,
}))

import { drsConnectionIds, isTenantRuleConnection, mayActOnDrsRule } from "./drsRuleScope"

const FORBIDDEN = new Response(null, { status: 403 })
const client = (rules: unknown) => ({ getRules: async () => ({ data: rules }) })

beforeEach(() => {
  h.getCurrentTenantId.mockReset().mockResolvedValue("default")
  h.getTenantConnectionIds.mockReset().mockResolvedValue(new Set(["prod", "dr", "msp-own"]))
  h.requireProviderTenant.mockReset().mockResolvedValue(null)
  h.ownedFindMany.mockReset().mockResolvedValue([{ id: "msp-own" }])
})

describe("drsConnectionIds", () => {
  it("is the whole fleet for the provider", async () => {
    expect(await drsConnectionIds()).toEqual(new Set(["prod", "dr", "msp-own"]))
    expect(h.ownedFindMany).not.toHaveBeenCalled()
  })

  it("is the owned connections only for another tenant, never its vDC bindings", async () => {
    h.getCurrentTenantId.mockResolvedValue("msp-1")

    expect(await drsConnectionIds()).toEqual(new Set(["msp-own"]))
    expect(h.getTenantConnectionIds).not.toHaveBeenCalled()
  })
})

describe("isTenantRuleConnection", () => {
  it("refuses an empty or non-string connection", async () => {
    expect(await isTenantRuleConnection("")).toBe(false)
    expect(await isTenantRuleConnection(undefined)).toBe(false)
    expect(await isTenantRuleConnection(42)).toBe(false)
  })

  it("accepts an owned connection and refuses a vDC-bound provider one", async () => {
    h.getCurrentTenantId.mockResolvedValue("msp-1")

    expect(await isTenantRuleConnection("msp-own")).toBe(true)
    expect(await isTenantRuleConnection("prod")).toBe(false)
  })
})

describe("mayActOnDrsRule", () => {
  it("lets an unknown id through for the orchestrator to answer", async () => {
    expect(await mayActOnDrsRule(client([]), "nope")).toBe(true)
    expect(await mayActOnDrsRule(client(null), "nope")).toBe(true)
  })

  it("follows the rule's connection", async () => {
    h.getCurrentTenantId.mockResolvedValue("msp-1")
    const rules = [{ id: "r1", connection_id: "prod" }, { id: "r2", connection_id: "msp-own" }]

    expect(await mayActOnDrsRule(client(rules), "r1")).toBe(false)
    expect(await mayActOnDrsRule(client(rules), "r2")).toBe(true)
  })

  it("leaves a connection-less rule to the provider tenant", async () => {
    const rules = [{ id: "r0", connection_id: "" }]

    expect(await mayActOnDrsRule(client(rules), "r0")).toBe(true)
    h.requireProviderTenant.mockResolvedValue(FORBIDDEN)
    expect(await mayActOnDrsRule(client(rules), "r0")).toBe(false)
  })
})
