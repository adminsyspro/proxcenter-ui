import { beforeEach, describe, expect, it, vi } from "vitest"

// Hoist mocks so they are available in vi.mock factories
const { getPbsUnscopedMock, listSnapshotsMock } = vi.hoisted(() => ({
  getPbsUnscopedMock: vi.fn(),
  listSnapshotsMock: vi.fn(),
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getPbsConnectionByIdUnscoped: getPbsUnscopedMock,
}))

vi.mock("@/lib/proxmox/pbsNamespace", () => ({
  listSnapshotsInNamespace: listSnapshotsMock,
}))

import { scopePbsDataForTenant, type PbsServerData } from "./scopePbs"

function pbsData(): PbsServerData {
  return {
    id: "pbs-1",
    name: "PBS prod",
    type: "pbs",
    status: "online",
    datastores: [
      {
        name: "store1",
        total: 1000, used: 400, available: 600, usagePercent: 40,
        backupCount: 50, vmCount: 30, ctCount: 15, hostCount: 5,
      },
      {
        name: "store2",
        total: 2000, used: 100, available: 1900, usagePercent: 5,
        backupCount: 10, vmCount: 10, ctCount: 0, hostCount: 0,
      },
    ],
    stats: { totalSize: 3000, totalUsed: 500, datastoreCount: 2, backupCount: 60 },
  }
}

function iaasScope(): any {
  return {
    pbsNamespacesByConnection: new Map([
      ["pbs-1", [{ datastore: "store1", namespace: "tenant-acme/vdc-prod" }]],
    ]),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getPbsUnscopedMock.mockResolvedValue({ id: "pbs-1", baseUrl: "https://pbs", apiToken: "t" })
  listSnapshotsMock.mockResolvedValue([
    { "backup-type": "vm" },
    { "backup-type": "vm" },
    { "backup-type": "ct" },
  ])
})

describe("scopePbsDataForTenant", () => {
  it("returns the payload unchanged (capacity included) when no scope applies", async () => {
    const result = await scopePbsDataForTenant(pbsData(), null)

    expect(result?.datastores[0].total).toBe(1000)
    expect(result?.stats.totalSize).toBe(3000)
    expect(listSnapshotsMock).not.toHaveBeenCalled()
  })

  it("recomputes counts from allowed namespaces and zeroes datastore-wide capacity for vDC tenants", async () => {
    const result = await scopePbsDataForTenant(pbsData(), iaasScope())

    expect(result).not.toBeNull()
    // Only the bound datastore remains
    expect(result!.datastores).toHaveLength(1)
    expect(result!.datastores[0].name).toBe("store1")
    // Counts come from the namespace-scoped snapshot listing
    expect(result!.datastores[0].backupCount).toBe(3)
    expect(result!.datastores[0].vmCount).toBe(2)
    expect(result!.datastores[0].ctCount).toBe(1)
    // PBS has no per-namespace capacity: datastore-wide figures are hidden
    expect(result!.datastores[0].total).toBe(0)
    expect(result!.datastores[0].used).toBe(0)
    expect(result!.datastores[0].available).toBe(0)
    expect(result!.datastores[0].usagePercent).toBe(0)
    expect(result!.stats.totalSize).toBe(0)
    expect(result!.stats.totalUsed).toBe(0)
    expect(result!.stats.backupCount).toBe(3)
  })

  it("returns null when the tenant has no namespace on this PBS", async () => {
    const scope: any = { pbsNamespacesByConnection: new Map() }

    expect(await scopePbsDataForTenant(pbsData(), scope)).toBeNull()
  })

  it("returns null when the PBS connection cannot be loaded", async () => {
    getPbsUnscopedMock.mockRejectedValue(new Error("gone"))

    expect(await scopePbsDataForTenant(pbsData(), iaasScope())).toBeNull()
  })
})
