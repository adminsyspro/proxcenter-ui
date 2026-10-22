import { describe, it, expect, vi, beforeEach } from "vitest"

const checkPermission = vi.fn<(...args: unknown[]) => Promise<Response | null>>(async () => null)
vi.mock("@/lib/rbac", () => ({
  checkPermission: (...args: unknown[]) => checkPermission(...args),
  PERMISSIONS: { NODE_VIEW: "node.view", NODE_MANAGE: "node.manage", STORAGE_ADMIN: "storage.admin" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn(async () => ({ id: "c1", baseUrl: "https://h", apiToken: "t" })),
}))
const pveFetch = vi.fn()
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...args: unknown[]) => pveFetch(...args),
}))
// The per-host flags (ui#1164) run `ceph osd set-group` over SSH on an online node.
const executeSSH = vi.fn()
vi.mock("@/lib/ssh/exec", () => ({
  executeSSH: (...args: unknown[]) => executeSSH(...args),
}))
vi.mock("@/lib/ssh/node-endpoint", async () => ({
  ...(await import("@/lib/ssh/node-endpoint-core")),
  resolveNodeSshEndpoint: async (_conn: unknown, node: string) => ({ host: `ip-of-${node}`, port: 22, source: "proxmox" }),
}))

import { GET, PUT, DELETE } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { PveLicenseExcludedError } from "@/lib/license/exclusions"

const CLUSTER_STATUS = [
  { type: "cluster", name: "lab" },
  { type: "node", name: "pve1", online: 1 },
  { type: "node", name: "pve3", online: 0 },
]
const HEALTH_FLAGGED = {
  health: {
    status: "HEALTH_WARN",
    checks: { OSD_FLAGS: { detail: [{ message: "host pve3 has flags noout" }, { message: "osd.4 has flags nodown" }], severity: "HEALTH_WARN", summary: { count: 2, message: "flags set" } } },
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermission.mockResolvedValue(null)
  pveFetch.mockResolvedValue(null)
  executeSSH.mockResolvedValue({ success: true, output: "" })
})

describe("GET /api/v1/connections/[id]/ceph/flags", () => {
  it("returns only the active flags (value true or 1), and the per-host and per-OSD flags from the health detail", async () => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => {
      if (path === "/cluster/ceph/flags") return [
        { name: "noout", value: true },
        { name: "norebalance", value: false },
        { name: "noscrub", value: 1 },
      ]
      if (path === "/cluster/ceph/status") return HEALTH_FLAGGED
      throw new Error(`unexpected ${path}`)
    })
    const res = await callRoute(GET, { params: { id: "c1" } })
    expect(res.status).toBe(200)
    const json = await readJson<{ data: { flags: string[]; hostFlags: Record<string, string[]>; osdFlags: Record<string, string[]> } }>(res)
    expect(json?.data.flags).toEqual(["noout", "noscrub"])
    expect(json?.data.hostFlags).toEqual({ pve3: ["noout"] })
    expect(json?.data.osdFlags).toEqual({ "osd.4": ["nodown"] })
  })

  it("answers empty lists when PVE cannot be read", async () => {
    pveFetch.mockRejectedValue(new Error("down"))
    const json = await readJson<any>(await callRoute(GET, { params: { id: "c1" } }))
    expect(json.data).toEqual({ flags: [], hostFlags: {}, osdFlags: {} })
  })
})

describe("Per-host flag set/unset (ui#1164)", () => {
  beforeEach(() => {
    pveFetch.mockImplementation(async (_conn: unknown, path: string) => (path === "/cluster/status" ? CLUSTER_STATUS : null))
  })

  it("DELETE with a host runs unset-group over SSH on an online node, never the PVE flag endpoint", async () => {
    const res = await callRoute(DELETE, { params: { id: "c1" }, method: "DELETE", body: { flag: "noout", host: "pve3" } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ success: true, flag: "noout", host: "pve3", value: false })
    // pve3 is offline in the cluster status: the command goes through pve1.
    expect(executeSSH).toHaveBeenCalledWith("c1", expect.objectContaining({ host: "ip-of-pve1" }), "ceph osd unset-group noout pve3")
    expect(pveFetch.mock.calls.map(c => c[1])).toEqual(["/cluster/status"])
  })

  it("PUT with a host runs set-group", async () => {
    const res = await callRoute(PUT, { params: { id: "c1" }, method: "PUT", body: { flag: "noin", host: "pve1" } })
    expect(res.status).toBe(200)
    expect(executeSSH).toHaveBeenCalledWith("c1", expect.objectContaining({ host: "ip-of-pve1" }), "ceph osd set-group noin pve1")
  })

  it("400 for a flag set-group does not know, or a host outside the hostname grammar, without SSH", async () => {
    let res = await callRoute(DELETE, { params: { id: "c1" }, method: "DELETE", body: { flag: "noscrub", host: "pve3" } })
    expect(res.status).toBe(400)
    res = await callRoute(DELETE, { params: { id: "c1" }, method: "DELETE", body: { flag: "noout", host: "pve3; reboot" } })
    expect(res.status).toBe(400)
    expect(executeSSH).not.toHaveBeenCalled()
  })

  it("500 with a manual hint when the command fails, 403 with its code outside the license", async () => {
    executeSSH.mockResolvedValueOnce({ success: false, error: "Error EINVAL: unable to parse osd id or crush node" })
    let res = await callRoute(DELETE, { params: { id: "c1" }, method: "DELETE", body: { flag: "noout", host: "nosuchhost" } })
    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toMatchObject({ error: expect.stringMatching(/EINVAL/), hint: "Run manually on a PVE node: ceph osd unset-group noout nosuchhost" })

    executeSSH.mockRejectedValueOnce(new PveLicenseExcludedError("c1"))
    res = await callRoute(DELETE, { params: { id: "c1" }, method: "DELETE", body: { flag: "noout", host: "pve3" } })
    expect(res.status).toBe(403)
    expect(await readJson<any>(res)).toMatchObject({ code: "CONNECTION_LICENSE_EXCLUDED" })
  })

  it("still checks storage.admin on the connection", async () => {
    checkPermission.mockResolvedValue(new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }))
    const res = await callRoute(DELETE, { params: { id: "c1" }, method: "DELETE", body: { flag: "noout", host: "pve3" } })
    expect(res.status).toBe(403)
    expect(executeSSH).not.toHaveBeenCalled()
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

  // Issue #920: setting an OSD flag is a storage.admin action.
  it.each([["PUT", PUT], ["DELETE", DELETE]] as const)("%s checks storage.admin on the connection", async (method, handler) => {
    const res = await callRoute(handler, { params: { id: "c1" }, method, body: { flag: "noout" } })
    expect(res.status).toBe(200)
    expect(checkPermission).toHaveBeenCalledWith("storage.admin", "connection", "c1")
  })

  it.each([["PUT", PUT], ["DELETE", DELETE]] as const)("%s 403s without storage.admin and never calls PVE", async (method, handler) => {
    checkPermission.mockResolvedValue(new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }))
    const res = await callRoute(handler, { params: { id: "c1" }, method, body: { flag: "noout" } })
    expect(res.status).toBe(403)
    expect(pveFetch).not.toHaveBeenCalled()
  })
})
