/** ui#1333: the network table saved per source/target pair and tenant. */
import { describe, it, expect, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({
  setting: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  scoped: { connection: { findUnique: vi.fn() } },
  denied: vi.fn(async (..._a: any[]) => null as Response | null),
  tenantId: "t1",
}))

vi.mock("@/lib/db/prisma", () => ({ prisma: { setting: h.setting } }))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: vi.fn(async () => h.tenantId), getSessionPrisma: vi.fn(async () => h.scoped) }))
vi.mock("@/lib/rbac", () => ({ checkPermission: (...a: any[]) => h.denied(...a), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))
vi.mock("@/lib/audit/withAudit", () => ({ withAudit: (_s: unknown, fn: unknown) => fn }))

import { GET, PUT } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const SRC = "cmtq8fq2u0007vujl2p4azy3q"
const TGT = "cmtq8f3s10006vujlmhmrszp5"
const key = `migration.networkMap:${SRC}:${TGT}`

beforeEach(() => {
  h.denied.mockReset().mockResolvedValue(null)
  h.setting.findUnique.mockReset().mockResolvedValue(null)
  h.setting.upsert.mockReset().mockResolvedValue({})
  h.setting.deleteMany.mockReset().mockResolvedValue({ count: 1 })
  h.scoped.connection.findUnique.mockReset().mockImplementation(async ({ where }: any) => ({ type: where.id === SRC ? "vmware" : "pve" }))
})

describe("GET /api/v1/migrations/network-maps", () => {
  it("reads the caller's tenant row only, dropping a row that no longer parses", async () => {
    h.setting.findUnique.mockResolvedValue({ value: [{ source: "DMZ", bridge: "vnetdmz", vlanTag: 30 }] })
    const res = await callRoute(GET, { searchParams: { sourceConnectionId: SRC, targetConnectionId: TGT } })
    expect((await readJson<any>(res)).data).toEqual({ networkMap: [{ source: "DMZ", bridge: "vnetdmz", vlanTag: 30 }] })
    expect(h.setting.findUnique).toHaveBeenCalledWith({ where: { key_tenantId: { key, tenantId: "t1" } } })
    h.setting.findUnique.mockResolvedValue({ value: [{ source: "", bridge: "x y" }] })
    const bad = await callRoute(GET, { searchParams: { sourceConnectionId: SRC, targetConnectionId: TGT } })
    expect((await readJson<any>(bad)).data).toEqual({ networkMap: [] })
  })

  it("needs vm.migrate on both ends of the pair", async () => {
    h.denied.mockImplementation(async (_p: string, _t?: string, id?: string) => (id === SRC ? new Response(null, { status: 403 }) : null))
    expect((await callRoute(GET, { searchParams: { sourceConnectionId: SRC, targetConnectionId: TGT } })).status).toBe(403)
    expect(h.setting.findUnique).not.toHaveBeenCalled()
  })

  it("needs both connection ids", async () => {
    expect((await callRoute(GET, { searchParams: { sourceConnectionId: SRC } })).status).toBe(400)
  })
})

describe("PUT /api/v1/migrations/network-maps", () => {
  const put = (body: Record<string, unknown>) => callRoute(PUT, { method: "PUT", body })

  it("saves a valid table for the pair in the caller's tenant", async () => {
    const res = await put({ sourceConnectionId: SRC, targetConnectionId: TGT, networkMap: [{ source: "DMZ", bridge: "vnetdmz", vlanTag: "30" }] })
    expect(res.status).toBe(200)
    expect(h.setting.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { key_tenantId: { key, tenantId: "t1" } },
      create: { key, tenantId: "t1", value: [{ source: "DMZ", bridge: "vnetdmz", vlanTag: 30 }] },
    }))
    expect(h.denied).toHaveBeenCalledWith("vm.migrate", "connection", SRC)
    expect(h.denied).toHaveBeenCalledWith("vm.migrate", "connection", TGT)
  })

  it("deletes the saved table when the new one is empty", async () => {
    await put({ sourceConnectionId: SRC, targetConnectionId: TGT, networkMap: [] })
    expect(h.setting.deleteMany).toHaveBeenCalledWith({ where: { key, tenantId: "t1" } })
    expect(h.setting.upsert).not.toHaveBeenCalled()
  })

  it("refuses a malformed table, an unknown pair and a caller without vm.migrate on an end", async () => {
    expect((await put({ sourceConnectionId: SRC, targetConnectionId: TGT, networkMap: [{ source: "A", bridge: "bad bridge" }] })).status).toBe(400)
    expect((await put({ sourceConnectionId: "x", targetConnectionId: TGT, networkMap: [] })).status).toBe(400)
    h.scoped.connection.findUnique.mockResolvedValue(null)
    expect((await put({ sourceConnectionId: SRC, targetConnectionId: TGT, networkMap: [] })).status).toBe(404)
    h.scoped.connection.findUnique.mockImplementation(async ({ where }: any) => ({ type: where.id === SRC ? "vmware" : "pve" }))
    h.denied.mockImplementation(async (_p: string, _t?: string, id?: string) => (id === TGT ? new Response(null, { status: 403 }) : null))
    expect((await put({ sourceConnectionId: SRC, targetConnectionId: TGT, networkMap: [] })).status).toBe(403)
    expect(h.setting.upsert).not.toHaveBeenCalled()
  })
})
