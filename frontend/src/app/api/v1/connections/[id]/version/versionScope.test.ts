import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

// Hoist mocks so they are available in vi.mock factories
const { getConnectionByIdMock, pveFetchMock, checkPermissionMock } = vi.hoisted(() => ({
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: pveFetchMock,
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))

import { GET } from "./route"

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({
    id: "c1",
    baseUrl: "https://10.0.0.1:8006",
    apiToken: "tok",
    tenantId: "msp-1",
  })
  pveFetchMock.mockReset().mockResolvedValue({ version: "8.4.1", release: "8.4" })
})

describe("GET /api/v1/connections/[id]/version", () => {
  it("returns the PVE version for a resolvable connection (incl. MSP-owned via provider)", async () => {
    const res = await callRoute(GET, { params: { id: "c1" } })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.version).toBe("8.4.1")
    expect(getConnectionByIdMock).toHaveBeenCalledWith("c1")
  })

  it("returns 500 when the connection lookup rejects (unowned row)", async () => {
    getConnectionByIdMock.mockRejectedValue(new Error("Connection not found: c1"))

    const res = await callRoute(GET, { params: { id: "c1" } })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toMatch(/Connection not found/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("returns the RBAC denial untouched when connection.view is denied", async () => {
    checkPermissionMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "forbidden" }), { status: 403 })
    )

    const res = await callRoute(GET, { params: { id: "c1" } })

    expect(res.status).toBe(403)
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })
})
