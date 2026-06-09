import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../../../__tests__/setup/route-test"

// Hoist mocks
const { findManyGlobalMock, findManySessionMock, getInfraMock, checkPermissionMock } = vi.hoisted(() => ({
  findManyGlobalMock: vi.fn(),
  findManySessionMock: vi.fn(),
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))

// Keep REAL inventoryConnectionPlan; only mock getTenantInfrastructureScope
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({ connection: { findMany: findManySessionMock } }),
  getCurrentTenantId: async () => "tenant-x",
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: { connection: { findMany: findManyGlobalMock } },
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: () => checkPermissionMock(),
  PERMISSIONS: { BACKUP_VIEW: "backup.view" },
}))

vi.mock("@/lib/proxmox/pbs-client", () => ({
  pbsFetch: vi.fn().mockResolvedValue([]),
}))

vi.mock("@/lib/crypto/secret", () => ({
  decryptSecret: (s: string) => s,
}))

vi.mock("@/utils/format", () => ({
  formatBytes: (n: number) => `${n}B`,
}))

vi.mock("@/lib/i18n/date", () => ({
  getDateLocale: () => "en",
}))

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}))

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  findManyGlobalMock.mockReset().mockResolvedValue([])
  findManySessionMock.mockReset().mockResolvedValue([])
  getInfraMock.mockReset()
})

describe("GET /api/v1/guests/[vmid]/backups PBS connection scope", () => {
  it("provider: uses the GLOBAL prisma client with no id filter", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { method: "GET", params: { vmid: "100" } })

    expect(res.status).toBe(200)
    expect(findManyGlobalMock).toHaveBeenCalled()
    expect(findManySessionMock).not.toHaveBeenCalled()
    // No id filter -- provider sees all PBS
    expect(findManyGlobalMock.mock.calls[0][0].where?.id).toBeUndefined()
  })

  it("msp: uses the SESSION (tenant-scoped) client with no id filter", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["pbs-msp-1"]) })

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { method: "GET", params: { vmid: "100" } })

    expect(res.status).toBe(200)
    expect(findManySessionMock).toHaveBeenCalled()
    expect(findManyGlobalMock).not.toHaveBeenCalled()
    // No explicit id filter -- session prisma is already tenant-scoped
    expect(findManySessionMock.mock.calls[0][0].where?.id).toBeUndefined()
  })

  it("iaas: uses the GLOBAL client filtered to vdcScope.pbsConnectionIds", async () => {
    // iaas tenants reference provider-owned PBS connections (tenant_id='default').
    // The session client is scoped to the iaas tenant and would filter them all out.
    // The correct behaviour mirrors inventory/stream: GLOBAL client + vDC id whitelist.
    const vdcScope = {
      connectionIds: new Set(["pve-1"]),
      pbsConnectionIds: new Set(["pbs-1", "pbs-2"]),
      nodesByConnection: new Map<string, Set<string>>(),
      poolsByConnection: new Map<string, Set<string>>(),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { method: "GET", params: { vmid: "100" } })

    expect(res.status).toBe(200)
    expect(findManyGlobalMock).toHaveBeenCalled()
    expect(findManySessionMock).not.toHaveBeenCalled()
    // Id filter must be the pbsConnectionIds from vdcScope
    const filter = findManyGlobalMock.mock.calls[0][0].where?.id?.in
    expect(new Set(filter)).toEqual(new Set(["pbs-1", "pbs-2"]))
  })
})
