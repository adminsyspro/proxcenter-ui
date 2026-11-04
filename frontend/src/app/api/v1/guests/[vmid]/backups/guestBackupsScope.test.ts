import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../../../__tests__/setup/route-test"

// Hoist mocks
const {
  findManyGlobalMock,
  findManySessionMock,
  getInfraMock,
  checkPermissionMock,
  pveFetchMock,
  getConnectionByIdMock,
  listVzdumpMock,
  pbsFetchMock,
} = vi.hoisted(() => ({
  findManyGlobalMock: vi.fn(),
  findManySessionMock: vi.fn(),
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  pveFetchMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  listVzdumpMock: vi.fn(),
  pbsFetchMock: vi.fn(),
}))

// Keep REAL inventoryConnectionPlan; only mock getTenantInfrastructureScope
// The vDC guest guard (lib/vdc/guestGuard.ts) has its own tests: pass-through
// here, as for a provider session.
vi.mock("@/lib/vdc/guestGuard", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/vdc/guestGuard")>()),
  guardSessionGuest: async () => null,
}))
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
  pbsFetch: (...a: any[]) => pbsFetchMock(...a),
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

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: pveFetchMock }))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock("@/lib/backups/pveVzdump", () => ({ listGuestVzdumpBackups: listVzdumpMock }))

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  findManyGlobalMock.mockReset().mockResolvedValue([])
  findManySessionMock.mockReset().mockResolvedValue([])
  getInfraMock.mockReset()
  pveFetchMock.mockReset().mockResolvedValue([{ storage: 'local', type: 'dir', content: 'backup' }])
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'pve-1', apiToken: 't' })
  listVzdumpMock.mockReset().mockResolvedValue({ data: [], warnings: [] })
  pbsFetchMock.mockReset().mockResolvedValue([])
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

  it("resolves the union regardless of the vDC view context (object surface: this VM's own backups)", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const GET = (await import("./route")).GET as Parameters<typeof callRoute>[0]
    const res = await callRoute(GET, { method: "GET", params: { vmid: "100" } })

    expect(res.status).toBe(200)
    expect(getInfraMock).toHaveBeenCalledWith("tenant-x", { ignoreVdcContext: true })
  })
})

describe("GET /api/v1/guests/[vmid]/backups vzdump tenant isolation", () => {
  it("never scans PVE storages for a vDC tenant", async () => {
    getInfraMock.mockResolvedValue({
      kind: "iaas",
      vdcScope: { pbsConnectionIds: new Set(["pbs-1"]), storagesByConnection: new Map() },
    })

    const { GET } = await import("./route")
    // Le balayage est explicitement demandé : c'est bien le masquage tenant qui
    // doit le refuser, pas l'absence du paramètre.
    const res = await callRoute(GET as any, {
      params: { vmid: "1105" },
      searchParams: { connectionId: "pve-1", scanVzdump: "1" },
    })

    // Sans ce contrôle, une exception levée avant la porte de masquage ferait
    // passer le test pour la mauvaise raison : le mock ne serait pas appelé.
    expect(res.status).toBe(200)
    expect(listVzdumpMock).not.toHaveBeenCalled()
  })

  it("scans PVE storages for a provider", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, {
      params: { vmid: "1105" },
      searchParams: { connectionId: "pve-1", scanVzdump: "1" },
    })

    expect(res.status).toBe(200)
    expect(listVzdumpMock).toHaveBeenCalledTimes(1)
  })
})

describe("GET /api/v1/guests/[vmid]/backups PBS namespace scope", () => {
  const PBS_ROW = { id: "pbs-1", name: "PBS", baseUrl: "https://10.0.0.1:8007", insecureTLS: false, apiTokenEnc: "enc" }
  const snapshotOf = (vmid: string, comment?: string) => ({ "backup-type": "vm", "backup-id": vmid, "backup-time": 1786100000, comment })
  const calledPaths = () => pbsFetchMock.mock.calls.map(([, path]) => String(path))

  const iaasWith = (pairs: Array<{ datastore: string; namespace: string }> | undefined) => ({
    kind: "iaas",
    vdcScope: {
      pbsConnectionIds: new Set(["pbs-1"]),
      pbsNamespacesByConnection: new Map(pairs ? [["pbs-1", pairs]] : []),
    },
  })

  it("iaas: reads only the (datastore, namespace) pairs bound to its vDCs, never another tenant's namespace", async () => {
    getInfraMock.mockResolvedValue(iaasWith([{ datastore: "store1", namespace: "tenant-a/vdc-1" }]))
    findManyGlobalMock.mockResolvedValue([PBS_ROW])
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === "/admin/datastore/store1/snapshots?ns=tenant-a%2Fvdc-1") return [snapshotOf("100", "mine")]
      if (path.includes("/snapshots")) return [snapshotOf("100", "other tenant")]
      return [{ store: "store1" }, { store: "store2" }]
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { params: { vmid: "100" } })
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.data.backups.map((b: any) => [b.datastore, b.namespace, b.vmName])).toEqual([
      ["store1", "tenant-a/vdc-1", "mine"],
    ])
    expect(calledPaths()).toEqual(["/admin/datastore/store1/snapshots?ns=tenant-a%2Fvdc-1"])
  })

  it("iaas: a root-namespace binding queries the datastore root only", async () => {
    getInfraMock.mockResolvedValue(iaasWith([{ datastore: "store1", namespace: "" }]))
    findManyGlobalMock.mockResolvedValue([PBS_ROW])
    pbsFetchMock.mockResolvedValue([snapshotOf("100", "root")])

    const { GET } = await import("./route")
    const body = await (await callRoute(GET as any, { params: { vmid: "100" } })).json()

    expect(body.data.backups.map((b: any) => b.namespace)).toEqual([""])
    expect(calledPaths()).toEqual(["/admin/datastore/store1/snapshots"])
  })

  it("iaas: a PBS connection without any binding for this tenant is not queried at all", async () => {
    getInfraMock.mockResolvedValue(iaasWith(undefined))
    findManyGlobalMock.mockResolvedValue([PBS_ROW])
    pbsFetchMock.mockResolvedValue([snapshotOf("100", "other tenant")])

    const { GET } = await import("./route")
    const body = await (await callRoute(GET as any, { params: { vmid: "100" } })).json()

    expect(body.data.backups).toEqual([])
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it("provider: still walks every datastore and namespace", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    findManyGlobalMock.mockResolvedValue([PBS_ROW])
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === "/admin/datastore") return [{ store: "store1" }]
      if (path === "/admin/datastore/store1/namespace") return [{ ns: "tenant-a/vdc-1" }, { ns: "tenant-b/vdc-2" }]
      if (path.includes("/snapshots")) return [snapshotOf("100", path)]
      return []
    })

    const { GET } = await import("./route")
    const body = await (await callRoute(GET as any, { params: { vmid: "100" } })).json()

    expect(body.data.backups.map((b: any) => b.namespace).sort()).toEqual(["", "tenant-a/vdc-1", "tenant-b/vdc-2"])
  })
})
