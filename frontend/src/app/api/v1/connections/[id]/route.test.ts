import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const h = vi.hoisted(() => ({
  row: {} as Record<string, any>,
  connectionFindUnique: vi.fn(),
  connectionUpdate: vi.fn(),
  checkPermission: vi.fn(),
  xcpngSubTypeOf: vi.fn(),
  normalizeXapiBaseUrl: vi.fn(),
  orchestratorFetch: vi.fn(),
  invalidateConnectionCache: vi.fn(),
  invalidateInventoryCache: vi.fn(),
  audit: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: vi.fn(async () => ({
    connection: {
      findUnique: h.connectionFindUnique,
      update: h.connectionUpdate,
    },
  })),
  getCurrentTenantId: vi.fn(async () => "default"),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: { connection: { findUnique: vi.fn() } },
}))

vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: vi.fn(),
  maskingScope: vi.fn(),
}))

vi.mock("@/lib/crypto/secret", () => ({
  encryptSecret: vi.fn((value: string) => `enc:${value}`),
  decryptSecret: vi.fn((value: string) => value),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: h.checkPermission,
  PERMISSIONS: {
    CONNECTION_VIEW: "connection.view",
    CONNECTION_MANAGE: "connection.manage",
  },
}))

vi.mock("@/lib/connections/getConnection", () => ({
  invalidateConnectionCache: h.invalidateConnectionCache,
}))

vi.mock("@/lib/cache/inventoryCache", () => ({
  invalidateInventoryCache: h.invalidateInventoryCache,
}))

vi.mock("@/lib/schemas", () => ({
  updateConnectionSchema: {
    safeParse: (body: any) => ({ success: true, data: body }),
  },
}))

vi.mock("@/lib/orchestrator/client", () => ({
  orchestratorFetch: h.orchestratorFetch,
}))

vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: vi.fn(),
}))

vi.mock("@/lib/proxmox/discoverNodeIps", () => ({
  discoverNodeIps: vi.fn(),
}))

vi.mock("@/lib/xcpng/source", () => ({
  xcpngSubTypeOf: h.xcpngSubTypeOf,
}))

vi.mock("@/lib/xcpng/xapi-client", () => ({
  normalizeXapiBaseUrl: h.normalizeXapiBaseUrl,
}))

vi.mock("@/lib/audit", () => ({
  audit: h.audit,
}))

import { PATCH } from "./route"

function setRow(overrides: Record<string, any> = {}) {
  h.row = {
    id: "conn-1",
    name: "Lab connection",
    type: "xcpng",
    subType: "xo",
    baseUrl: "https://xo.test",
    ...overrides,
  }
}

function expectedBody() {
  return {
    data: {
      ...h.row,
      sshKeyConfigured: false,
      sshPassConfigured: false,
      sshConfigured: false,
    },
  }
}

beforeEach(() => {
  setRow()
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.connectionFindUnique.mockReset().mockImplementation(async () => h.row)
  h.connectionUpdate.mockReset().mockImplementation(async ({ data }: { data: Record<string, any> }) => {
    h.row = { ...h.row, ...data }
    return h.row
  })
  h.xcpngSubTypeOf.mockReset().mockImplementation(
    (conn: { subType?: string | null }) => conn.subType === "xapi" ? "xapi" : "xo",
  )
  h.normalizeXapiBaseUrl.mockReset().mockImplementation((input: string) => {
    const value = input.trim().replace(/\/+$/, "")
    return /^https?:\/\//i.test(value)
      ? value.replace(/^http:\/\//i, "https://")
      : `https://${value}`
  })
  h.orchestratorFetch.mockReset().mockResolvedValue(undefined)
  h.invalidateConnectionCache.mockReset()
  h.invalidateInventoryCache.mockReset()
  h.audit.mockReset().mockResolvedValue(undefined)
})

describe("PATCH /api/v1/connections/[id] XCP-ng mode", () => {
  it("persists an explicit XAPI mode and normalizes the pool URL", async () => {
    const res = await callRoute(PATCH, {
      method: "PATCH",
      params: { id: "conn-1" },
      body: { subType: "xapi", baseUrl: "10.0.0.9" },
    })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(expectedBody())
    expect(h.row).toMatchObject({ subType: "xapi", baseUrl: "https://10.0.0.9" })
    expect(h.connectionUpdate).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { subType: "xapi", baseUrl: "https://10.0.0.9" },
    })
  })

  it("keeps XAPI mode when subType is omitted", async () => {
    setRow({ subType: "xapi", baseUrl: "https://10.0.0.8" })

    const res = await callRoute(PATCH, {
      method: "PATCH",
      params: { id: "conn-1" },
      body: { baseUrl: "10.0.0.10" },
    })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(expectedBody())
    expect(h.row).toMatchObject({ subType: "xapi", baseUrl: "https://10.0.0.10" })
    expect(h.connectionUpdate).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { baseUrl: "https://10.0.0.10" },
    })
  })

  it("persists xo when a null subType is sent for an XCP-ng row", async () => {
    setRow({ subType: null, baseUrl: "https://xo.test" })

    const res = await callRoute(PATCH, {
      method: "PATCH",
      params: { id: "conn-1" },
      body: { subType: null },
    })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(expectedBody())
    expect(h.row).toMatchObject({ subType: "xo", baseUrl: "https://xo.test" })
    expect(h.connectionUpdate).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { subType: "xo" },
    })
  })

  it("does not apply XCP-ng normalization to a VMware row", async () => {
    setRow({
      type: "vmware",
      subType: "vcenter",
      baseUrl: "https://vcenter.test",
    })

    const res = await callRoute(PATCH, {
      method: "PATCH",
      params: { id: "conn-1" },
      body: { subType: null, baseUrl: "10.0.0.9" },
    })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(expectedBody())
    expect(h.row).toMatchObject({ type: "vmware", subType: null, baseUrl: "10.0.0.9" })
    expect(h.xcpngSubTypeOf).not.toHaveBeenCalled()
    expect(h.normalizeXapiBaseUrl).not.toHaveBeenCalled()
    expect(h.connectionUpdate).toHaveBeenCalledWith({
      where: { id: "conn-1" },
      data: { subType: null, baseUrl: "10.0.0.9" },
    })
  })
})
