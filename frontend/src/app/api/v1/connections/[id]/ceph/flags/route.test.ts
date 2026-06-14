import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn(async () => null),
  PERMISSIONS: { NODE_VIEW: "node.view", NODE_MANAGE: "node.manage" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn(async () => ({ id: "c1", baseUrl: "https://h", apiToken: "t" })),
}))
const pveFetch = vi.fn()
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...args: unknown[]) => pveFetch(...args),
}))

import { GET, PUT, DELETE } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

beforeEach(() => {
  vi.clearAllMocks()
  pveFetch.mockResolvedValue(null)
})

describe("GET /api/v1/connections/[id]/ceph/flags", () => {
  it("returns only the active flags (value true or 1)", async () => {
    pveFetch.mockResolvedValueOnce([
      { name: "noout", value: true },
      { name: "norebalance", value: false },
      { name: "noscrub", value: 1 },
    ])
    const res = await callRoute(GET, { params: { id: "c1" } })
    expect(res.status).toBe(200)
    const json = await readJson<{ data: { flags: string[] } }>(res)
    expect(json?.data.flags).toEqual(["noout", "noscrub"])
  })
})

describe("Ceph flag set/unset", () => {
  it("PUT sets the flag via PVE PUT with the required value=1 (form-encoded)", async () => {
    const res = await callRoute(PUT, { params: { id: "c1" }, method: "PUT", body: { flag: "noout" } })
    expect(res.status).toBe(200)
    const [, path, init] = pveFetch.mock.calls[0] as [unknown, string, { method: string; body: URLSearchParams }]
    expect(path).toBe("/cluster/ceph/flags/noout")
    expect(init.method).toBe("PUT")
    expect(init.body.toString()).toBe("value=1")
  })

  it("DELETE unsets the flag via PVE PUT with value=0 (the single-flag endpoint has no DELETE)", async () => {
    const res = await callRoute(DELETE, { params: { id: "c1" }, method: "DELETE", body: { flag: "noout" } })
    expect(res.status).toBe(200)
    const [, path, init] = pveFetch.mock.calls[0] as [unknown, string, { method: string; body: URLSearchParams }]
    expect(path).toBe("/cluster/ceph/flags/noout")
    expect(init.method).toBe("PUT")
    expect(init.body.toString()).toBe("value=0")
  })

  it("400s without ever calling PVE when the flag is missing", async () => {
    const res = await callRoute(PUT, { params: { id: "c1" }, method: "PUT", body: {} })
    expect(res.status).toBe(400)
    expect(pveFetch).not.toHaveBeenCalled()
  })
})
