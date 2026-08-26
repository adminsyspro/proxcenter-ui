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
}))

import { GET } from "./route"

function fakeSource(overrides: Record<string, any> = {}) {
  return {
    kind: "xo",
    displayUrl: "https://xo.test",
    listHosts: vi.fn(async () => []),
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
    name: "XCP-ng Lab",
    type: "xcpng",
  })
  h.openXcpngSource.mockReset().mockResolvedValue(fakeSource())
})

describe("GET /api/v1/xcpng/[id]/vms", () => {
  it("returns the normalized XO VM list and closes the source", async () => {
    const source = fakeSource({
      listVms: vi.fn(async () => [{
        uuid: "vm-xo",
        name_label: "XO Web",
        power_state: "Running",
        CPUs: { number: 4, max: 8 },
        memory: { size: 2 * 1024 * 1024 * 1024 },
        os_version: { name: "Ubuntu 24.04" },
      }]),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1" } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: {
        vms: [{
          vmid: "vm-xo",
          name: "XO Web",
          status: "running",
          cpu: 4,
          memory_size_MiB: 2048,
          power_state: "Running",
          guest_OS: "Ubuntu 24.04",
        }],
        connectionName: "XCP-ng Lab",
      },
    })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("returns the normalized XAPI VM list and tolerates a close failure", async () => {
    const source = fakeSource({
      kind: "xapi",
      displayUrl: "https://pool.test",
      listVms: vi.fn(async () => [{
        uuid: "vm-xapi",
        name_label: "XAPI DB",
        power_state: "Suspended",
        CPUs: { number: 0, max: 2 },
        memory: { size: 512 * 1024 * 1024 },
        os_version: { distro: "debian" },
      }]),
      close: vi.fn(async () => { throw new Error("logout failed") }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1" } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: {
        vms: [{
          vmid: "vm-xapi",
          name: "XAPI DB",
          status: "suspended",
          cpu: 2,
          memory_size_MiB: 512,
          power_state: "Suspended",
          guest_OS: "debian",
        }],
        connectionName: "XCP-ng Lab",
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

  it("returns the current 500 auth response and closes the source", async () => {
    const source = fakeSource({
      listVms: vi.fn(async () => { throw new Error("XO API error: 401 Unauthorized") }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1" } })

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: "XO API error: 401 Unauthorized" })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("returns a generic upstream error and closes the source", async () => {
    const source = fakeSource({
      kind: "xapi",
      displayUrl: "https://pool.test",
      listVms: vi.fn(async () => { throw new Error("XAPI HTTP 503") }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1" } })

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: "XAPI HTTP 503" })
    expect(source.close).toHaveBeenCalledTimes(1)
  })
})
