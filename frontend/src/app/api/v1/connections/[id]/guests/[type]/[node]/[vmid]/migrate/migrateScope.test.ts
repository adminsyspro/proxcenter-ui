import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../../../../../../../__tests__/setup/route-test"

// Hoist mocks so they are available in vi.mock factories
const { getInfraMock, checkPermissionMock, getConnectionByIdMock, pveFetchMock } = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => "test-tenant",
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...args: any[]) => checkPermissionMock(...args),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}/${node}/${type}/${vmid}`,
  PERMISSIONS: { VM_MIGRATE: "vm.migrate" },
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...args: any[]) => getConnectionByIdMock(...args),
}))

vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...args: any[]) => pveFetchMock(...args),
}))

vi.mock("@/lib/schemas", () => ({
  migrateVmSchema: {
    safeParse: (b: any) => ({
      success: true,
      data: { target: b?.target ?? "pve2", online: true, targetstorage: null, withLocalDisks: false },
    }),
  },
}))

vi.mock("@/lib/cache/inventoryCache", () => ({ invalidateInventoryCache: vi.fn() }))
vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

const STUB_CONN = { id: "conn-1", baseUrl: "https://pve:8006", apiToken: "tok" }

const PARAMS = { id: "conn-1", type: "qemu", node: "pve1", vmid: "100" }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue(STUB_CONN)
  pveFetchMock.mockReset().mockResolvedValue("UPID:pve1:0:0:migrate:100:root@pam:")
  getInfraMock.mockReset()
})

describe("POST .../migrate — MSP ownership gate", () => {
  it("provider tenant passes the gate (reaches body execution, no 403)", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: { target: "pve2", online: true },
    })

    expect(res.status).not.toBe(403)
  })

  it("msp tenant that owns the connection passes the gate", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-1"]) })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: { target: "pve2", online: true },
    })

    expect(res.status).not.toBe(403)
  })

  it("msp tenant that does NOT own the connection gets 403", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-other"]) })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: { target: "pve2", online: true },
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/migration is restricted/i)
  })

  it("iaas tenant gets 403 regardless of connection ids", async () => {
    const vdcScope: any = { connectionIds: new Set(["conn-1"]), pbsConnectionIds: new Set() }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: { target: "pve2", online: true },
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/migration is restricted/i)
  })
})
