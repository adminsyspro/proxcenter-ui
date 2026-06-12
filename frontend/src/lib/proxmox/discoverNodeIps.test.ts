import { beforeEach, describe, expect, it, vi } from "vitest"

// Hoist mocks so they are available in vi.mock factories
const { pveFetchMock, upsertMock, deleteManyMock, connFindUniqueMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  upsertMock: vi.fn().mockResolvedValue({}),
  deleteManyMock: vi.fn().mockResolvedValue({ count: 0 }),
  connFindUniqueMock: vi.fn(),
}))

vi.mock("./client", () => ({ pveFetch: pveFetchMock }))
vi.mock("./resolveManagementIp", () => ({ resolveManagementIp: () => "10.0.0.5" }))
vi.mock("../cache/nodeIpCache", () => ({ setNodeIps: vi.fn() }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: { findUnique: connFindUniqueMock },
    managedHost: { upsert: upsertMock, deleteMany: deleteManyMock },
  },
}))

import { discoverNodeIps } from "./discoverNodeIps"

const CONN_OPTS = { baseUrl: "https://10.0.0.1:8006", apiToken: "t", insecureDev: false }

beforeEach(() => {
  vi.clearAllMocks()
  upsertMock.mockResolvedValue({})
  deleteManyMock.mockResolvedValue({ count: 0 })
  connFindUniqueMock.mockResolvedValue({ tenantId: "msp-1" })
  pveFetchMock
    // /nodes
    .mockResolvedValueOnce([{ node: "pve1" }])
    // /nodes/pve1/network
    .mockResolvedValueOnce([{ iface: "vmbr0", type: "bridge" }])
})

describe("discoverNodeIps", () => {
  it("persists ManagedHost rows under the connection owner's tenant", async () => {
    const ips = await discoverNodeIps(CONN_OPTS as any, "c-msp")

    expect(ips).toEqual(["10.0.0.5"])
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ connectionId: "c-msp", tenantId: "msp-1" }),
      })
    )
  })

  it("falls back to the default tenant when the connection row is missing", async () => {
    connFindUniqueMock.mockResolvedValue(null)

    await discoverNodeIps(CONN_OPTS as any, "c-gone")

    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ tenantId: "default" }),
      })
    )
  })
})
