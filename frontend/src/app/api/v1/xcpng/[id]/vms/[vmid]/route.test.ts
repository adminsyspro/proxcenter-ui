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

describe("GET /api/v1/xcpng/[id]/vms/[vmid]", () => {
  it("returns the expected XO VM detail and closes the source", async () => {
    const source = fakeSource({
      getVm: vi.fn(async () => ({
        uuid: "vm-xo",
        name_label: "XO Web",
        name_description: "Public web server",
        power_state: "Running",
        CPUs: { number: 4, max: 8 },
        memory: { size: 4 * 1024 * 1024 * 1024 },
        os_version: { name: "Ubuntu 24.04" },
        boot: { firmware: "uefi" },
        mainIpAddress: "192.0.2.10",
        VIFs: ["OpaqueRef:vif-1"],
        VBDs: ["OpaqueRef:vbd-1", { ignored: true }],
        snapshots: ["snap-1"],
        tags: ["prod", "web"],
      })),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1", vmid: "vm-xo" } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: {
        vmid: "vm-xo",
        name: "XO Web",
        guestOS: "Ubuntu 24.04",
        numCPU: 4,
        numCoresPerSocket: 1,
        sockets: 4,
        memoryMB: 4096,
        firmware: "uefi",
        annotation: "Public web server",
        powerState: "Running",
        status: "running",
        uuid: "vm-xo",
        ipAddress: "192.0.2.10",
        hostName: "XO Web",
        committed: 0,
        uncommitted: 0,
        provisioned: 0,
        disks: [{
          label: "VBD 0",
          capacityBytes: 0,
          fileName: "OpaqueRef:vbd-1",
          thinProvisioned: false,
        }],
        networks: [{
          label: "VIF 0",
          macAddress: "",
          network: "OpaqueRef:vif-1",
          connected: true,
        }],
        snapshotCount: 1,
        connectionId: "conn-1",
        connectionName: "XCP-ng Lab",
        tags: ["prod", "web"],
      },
    })
    expect(source.getVm).toHaveBeenCalledWith("vm-xo")
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("returns the expected XAPI VM detail and tolerates a close failure", async () => {
    const source = fakeSource({
      kind: "xapi",
      displayUrl: "https://pool.test",
      getVm: vi.fn(async () => ({
        uuid: "vm-xapi",
        name_label: "XAPI DB",
        name_description: "Database server",
        power_state: "Suspended",
        VCPUs_at_startup: "2",
        VCPUs_max: "4",
        memory_static_max: String(8 * 1024 * 1024 * 1024),
        HVM_boot_params: { firmware: "uefi" },
        addresses: { "0/ipv4/0": "198.51.100.20" },
        _guest: {
          os_version: { distro: "debian" },
          networks: { "0/ipv4/0": "198.51.100.21" },
        },
        VIFs: ["OpaqueRef:xapi-vif"],
        VBDs: ["OpaqueRef:xapi-vbd"],
        snapshots: [],
        tags: ["database"],
      })),
      close: vi.fn(async () => { throw new Error("logout failed") }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1", vmid: "vm-xapi" } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({
      data: {
        vmid: "vm-xapi",
        name: "XAPI DB",
        guestOS: "debian",
        numCPU: 2,
        numCoresPerSocket: 1,
        sockets: 2,
        memoryMB: 8192,
        firmware: "uefi",
        annotation: "Database server",
        powerState: "Suspended",
        status: "suspended",
        uuid: "vm-xapi",
        ipAddress: "198.51.100.20",
        hostName: "XAPI DB",
        committed: 0,
        uncommitted: 0,
        provisioned: 0,
        disks: [{
          label: "VBD 0",
          capacityBytes: 0,
          fileName: "OpaqueRef:xapi-vbd",
          thinProvisioned: false,
        }],
        networks: [{
          label: "VIF 0",
          macAddress: "",
          network: "OpaqueRef:xapi-vif",
          connected: true,
        }],
        snapshotCount: 0,
        connectionId: "conn-1",
        connectionName: "XCP-ng Lab",
        tags: ["database"],
      },
    })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("returns 404 when the connection does not exist", async () => {
    h.connectionFindUnique.mockResolvedValueOnce(null)

    const res = await callRoute(GET, { params: { id: "missing", vmid: "vm-1" } })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: "XCP-ng connection not found" })
    expect(h.openXcpngSource).not.toHaveBeenCalled()
  })

  it("maps an XO missing VM to 404 and closes the source", async () => {
    const source = fakeSource({
      getVm: vi.fn(async () => { throw new Error("XO API error: 404 Not Found") }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1", vmid: "missing" } })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: "VM not found" })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("maps an XAPI missing VM to 404 and closes the source", async () => {
    const error = new Error("UUID_INVALID vm-missing")
    error.name = "XapiError"
    const source = fakeSource({
      kind: "xapi",
      displayUrl: "https://pool.test",
      getVm: vi.fn(async () => { throw error }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1", vmid: "vm-missing" } })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: "VM not found" })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("returns the current 500 auth response and closes the source", async () => {
    const source = fakeSource({
      kind: "xapi",
      displayUrl: "https://pool.test",
      getVm: vi.fn(async () => { throw new Error("XAPI SESSION_AUTHENTICATION_FAILED for root") }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1", vmid: "vm-1" } })

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: "XAPI SESSION_AUTHENTICATION_FAILED for root" })
    expect(source.close).toHaveBeenCalledTimes(1)
  })

  it("returns a generic upstream error and closes the source", async () => {
    const source = fakeSource({
      getVm: vi.fn(async () => { throw new Error("upstream unavailable") }),
    })
    h.openXcpngSource.mockResolvedValueOnce(source)

    const res = await callRoute(GET, { params: { id: "conn-1", vmid: "vm-1" } })

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: "upstream unavailable" })
    expect(source.close).toHaveBeenCalledTimes(1)
  })
})
