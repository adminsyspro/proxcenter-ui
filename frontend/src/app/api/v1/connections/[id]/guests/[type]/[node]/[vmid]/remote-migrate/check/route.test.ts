import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, getConnectionByIdMock, pveFetchMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}/${node}/${type}/${vmid}`,
  PERMISSIONS: { VM_MIGRATE: "vm.migrate" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnectionByIdMock(...a),
}))
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...a: any[]) => pveFetchMock(...a),
}))

const PARAMS = { id: "conn-src", type: "qemu", node: "pve1", vmid: "100" }
const BODY = { targetConnectionId: "conn-tgt", targetNode: "pve2", targetStorage: "local-lvm", targetBridge: "vmbr0" }

// Route pveFetch responses by path substring. `snapshotResult` is per-test.
function wirePveFetch(snapshotResult: any) {
  pveFetchMock.mockImplementation((_conn: any, path: string) => {
    if (path.includes("/snapshot")) {
      if (snapshotResult instanceof Error) return Promise.reject(snapshotResult)
      return Promise.resolve(snapshotResult)
    }
    if (path.endsWith("/config")) return Promise.resolve({})
    if (path.includes("/cluster/ha/resources")) return Promise.resolve([])
    // target-side checks: return benign empties so they don't crash
    return Promise.resolve([])
  })
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "c", baseUrl: "https://x:8006", apiToken: "t" })
  pveFetchMock.mockReset()
})

describe("POST .../remote-migrate/check — snapshot pre-flight", () => {
  it("flags a blocking SNAPSHOTS_PRESENT error when the VM has snapshots", async () => {
    wirePveFetch([{ name: "current" }, { name: "snap1" }, { name: "snap2" }])
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    const issue = json.issues.find((i: any) => i.code === "SNAPSHOTS_PRESENT")
    expect(issue).toBeDefined()
    expect(issue.type).toBe("error")
    expect(issue.message).toMatch(/2/) // count surfaced
    expect(json.valid).toBe(false)
  })

  it("does NOT flag when the VM has only the 'current' pseudo-snapshot", async () => {
    wirePveFetch([{ name: "current" }])
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.some((i: any) => i.code === "SNAPSHOTS_PRESENT")).toBe(false)
  })

  it("degrades to a SNAPSHOTS_CHECK_FAILED warning (not a block) when the snapshot fetch throws", async () => {
    wirePveFetch(new Error("boom"))
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    const issue = json.issues.find((i: any) => i.code === "SNAPSHOTS_CHECK_FAILED")
    expect(issue).toBeDefined()
    expect(issue.type).toBe("warning")
    expect(json.issues.some((i: any) => i.code === "SNAPSHOTS_PRESENT")).toBe(false)
  })
})
