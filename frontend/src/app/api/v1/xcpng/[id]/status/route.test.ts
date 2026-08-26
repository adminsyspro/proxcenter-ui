import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const h = vi.hoisted(() => ({
  connectionFindUnique: vi.fn(),
  checkPermission: vi.fn(),
  openXcpngSource: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: vi.fn(async () => ({
    connection: { findUnique: h.connectionFindUnique },
  })),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: h.checkPermission,
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))

vi.mock("@/lib/xcpng/source", () => ({
  openXcpngSource: h.openXcpngSource,
  xcpngSubTypeOf: (conn: { subType?: string | null }) => conn.subType === "xapi" ? "xapi" : "xo",
  isXcpngAuthError: (message: string) => /SESSION_AUTHENTICATION_FAILED|XO API error: 401\b|XAPI HTTP 401\b/.test(message),
}))

import { GET } from "./route"

function fakeSource(overrides: Record<string, any> = {}) {
  return {
    kind: "xo",
    displayUrl: "https://xo.test",
    listHosts: vi.fn(async () => [{ name_label: "host-1", address: "10.0.0.1", version: "8.3" }]),
    listVms: vi.fn(async () => []),
    getVm: vi.fn(async () => ({})),
    close: vi.fn(async () => {}),
    ...overrides,
  }
}

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.connectionFindUnique.mockReset().mockResolvedValue({
    id: "conn-1",
    baseUrl: "https://xo.test/",
    type: "xcpng",
    subType: "xo",
  })
  h.openXcpngSource.mockReset().mockResolvedValue(fakeSource())
})

describe("GET /api/v1/xcpng/[id]/status", () => {
  it("returns the XO status response and closes the source", async () => {
    const source = fakeSource()
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1" } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: {
        status: "online",
        host: "https://xo.test",
        mode: "xo",
        hostCount: 1,
        version: "XO/XOA",
      },
    })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("returns the XAPI status response and closes the source", async () => {
    h.connectionFindUnique.mockResolvedValueOnce({
      id: "conn-1",
      baseUrl: "https://pool.test",
      type: "xcpng",
      subType: "xapi",
    })
    const source = fakeSource({
      kind: "xapi",
      displayUrl: "https://pool.test",
      listHosts: vi.fn(async () => [
        { name_label: "pool-1", address: "10.0.0.9", version: "8.3" },
        { name_label: "pool-2", address: "10.0.0.10", version: "8.3" },
      ]),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1" } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: {
        status: "online",
        host: "https://pool.test",
        mode: "xapi",
        hostCount: 2,
        version: "XCP-ng 8.3",
      },
    })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("returns 404 when the connection does not exist", async () => {
    h.connectionFindUnique.mockResolvedValueOnce(null)

    const res = await callRoute(GET, { params: { id: "missing" } })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: "XCP-ng connection not found" })
    expect(h.openXcpngSource).not.toHaveBeenCalled()
  })

  it.each([
    ["XO API error: 401 Unauthorized", "xo", "https://xo.test/"],
    ["XAPI SESSION_AUTHENTICATION_FAILED for root", "xapi", "https://pool.test/"],
  ])("maps %s to auth_error and closes the source", async (message, subType, baseUrl) => {
    h.connectionFindUnique.mockResolvedValueOnce({ id: "conn-1", baseUrl, type: "xcpng", subType })
    const source = fakeSource({
      kind: subType,
      displayUrl: baseUrl.replace(/\/$/, ""),
      listHosts: vi.fn(async () => { throw new Error(message) }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1" } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: {
        status: "auth_error",
        host: baseUrl.replace(/\/$/, ""),
        mode: subType,
        warning: "Invalid credentials",
      },
    })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("maps an XO HTTP error and closes the source", async () => {
    const source = fakeSource({
      listHosts: vi.fn(async () => { throw new Error("XO API error: 503 Service Unavailable") }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1" } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: {
        status: "error",
        host: "https://xo.test",
        mode: "xo",
        warning: "XO returned HTTP 503",
      },
    })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("maps an XAPI upstream error and closes the source", async () => {
    h.connectionFindUnique.mockResolvedValueOnce({
      id: "conn-1",
      baseUrl: "https://pool.test",
      type: "xcpng",
      subType: "xapi",
    })
    const error = new Error("HOST_IS_SLAVE")
    error.name = "XapiError"
    const source = fakeSource({
      kind: "xapi",
      displayUrl: "https://pool.test",
      listHosts: vi.fn(async () => { throw error }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1" } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: {
        status: "error",
        host: "https://pool.test",
        mode: "xapi",
        warning: "HOST_IS_SLAVE",
      },
    })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("returns 502 for a generic transport failure and closes the source", async () => {
    const source = fakeSource({
      listHosts: vi.fn(async () => { throw new Error("connect ECONNREFUSED") }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1" } })

    expect(res.status).toBe(502)
    expect(await readJson(res)).toEqual({ error: "XO server unreachable" })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("returns 504 on timeout and closes the source", async () => {
    const error = new Error("timed out")
    error.name = "TimeoutError"
    const source = fakeSource({
      listHosts: vi.fn(async () => { throw error }),
      close: vi.fn(async () => { throw new Error("close failed") }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1" } })

    expect(res.status).toBe(504)
    expect(await readJson(res)).toEqual({ error: "Connection timeout" })
    expect(source.close).toHaveBeenCalledTimes(1)
  })
})
