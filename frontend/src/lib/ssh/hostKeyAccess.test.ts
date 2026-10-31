import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(),
  getRBACContext: vi.fn(),
  holdsBroadPermission: vi.fn(),
  requireProviderTenant: vi.fn(),
  findMany: vi.fn(),
  allFindMany: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: h.checkPermission,
  getRBACContext: h.getRBACContext,
  holdsBroadPermission: h.holdsBroadPermission,
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: { connection: { findMany: h.allFindMany } } }))
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({ connection: { findMany: h.findMany } }),
  requireProviderTenant: h.requireProviderTenant,
}))

import { hostKeyInScope, hostKeyScope } from "./hostKeyAccess"

const FORBIDDEN = new Response(null, { status: 403 })

const CONNECTIONS = [
  {
    id: "prod",
    baseUrl: "https://pve-prod.lab:8006",
    sshPort: 22,
    hosts: [
      { ip: "10.42.0.101", sshAddress: null, sshPort: null },
      { ip: "10.42.0.102", sshAddress: "PVE2-MGMT.lab", sshPort: 2222 },
    ],
  },
  { id: "dr", baseUrl: "https://[fd00::111]:8006", sshPort: 22, hosts: [{ ip: "10.42.0.111", sshAddress: null, sshPort: null }] },
]

beforeEach(() => {
  h.getRBACContext.mockReset().mockResolvedValue({ userId: "u1", tenantId: "default" })
  h.requireProviderTenant.mockReset().mockResolvedValue(null)
  h.holdsBroadPermission.mockReset().mockResolvedValue(false)
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.findMany.mockReset().mockResolvedValue(CONNECTIONS.map(c => ({ id: c.id })))
  h.allFindMany.mockReset().mockResolvedValue(CONNECTIONS)
})

describe("hostKeyScope", () => {
  it("reaches every pin for a provider caller holding the permission across the tenant", async () => {
    h.holdsBroadPermission.mockResolvedValue(true)

    const scope = await hostKeyScope("connection.manage")

    expect(scope.all).toBe(true)
    expect(hostKeyInScope(scope, "198.51.100.4")).toBe(true)
    expect(h.holdsBroadPermission).toHaveBeenCalledWith("u1", "default", "connection.manage", null)
    expect(h.findMany).not.toHaveBeenCalled()
  })

  it("keeps a scoped provider user to the hosts of its granted connections", async () => {
    h.checkPermission.mockImplementation(async (_p: string, _t: string, id: string) => (id === "dr" ? null : FORBIDDEN))

    const scope = await hostKeyScope("connection.manage")

    expect(scope.all).toBe(false)
    expect([...scope.hosts].sort()).toEqual(["10.42.0.111", "fd00::111"])
    expect(hostKeyInScope(scope, "10.42.0.101")).toBe(false)
  })

  it("covers node addresses, SSH overrides and the API host, case-insensitively", async () => {
    const scope = await hostKeyScope("connection.view")

    for (const host of ["10.42.0.101", "10.42.0.102", "pve2-mgmt.lab", "PVE-PROD.lab", "[fd00::111]"]) {
      expect(hostKeyInScope(scope, host)).toBe(true)
    }
  })

  it("never grants everything outside the provider tenant", async () => {
    h.requireProviderTenant.mockResolvedValue(FORBIDDEN)
    h.holdsBroadPermission.mockResolvedValue(true)
    h.findMany.mockResolvedValue([])

    const scope = await hostKeyScope("connection.manage")

    expect(scope).toEqual({ all: false, hosts: new Set() })
    expect(hostKeyInScope(scope, "10.42.0.101")).toBe(false)
    expect(h.holdsBroadPermission).not.toHaveBeenCalled()
  })

  it("treats an API token (no user) by its connections only", async () => {
    h.getRBACContext.mockResolvedValue({ tenantId: "default" })

    const scope = await hostKeyScope("connection.view")

    expect(scope.all).toBe(false)
    expect(h.requireProviderTenant).not.toHaveBeenCalled()
  })

  it("ignores an unparsable API URL", async () => {
    h.findMany.mockResolvedValue([{ id: "x" }])
    h.allFindMany.mockResolvedValue([{ id: "x", baseUrl: "not a url", sshPort: 22, hosts: [] }])

    expect((await hostKeyScope("connection.view")).hosts.size).toBe(0)
  })

  // The SSH override is the tenant's own input and its cluster reports its own
  // node addresses: naming another connection's address there grants nothing.
  it("drops an address that another connection also answers on", async () => {
    h.findMany.mockResolvedValue([{ id: "msp" }])
    h.allFindMany.mockResolvedValue([
      ...CONNECTIONS,
      { id: "pbs", baseUrl: "https://10.42.0.201:8007", sshPort: 22, hosts: [] },
      {
        id: "msp",
        baseUrl: "https://msp.example:8006",
        sshPort: 22,
        hosts: [
          { ip: "192.0.2.10", sshAddress: "10.42.0.101", sshPort: null },
          { ip: "192.0.2.11", sshAddress: "10.42.0.201", sshPort: null },
        ],
      },
    ])

    const scope = await hostKeyScope("connection.manage")

    expect([...scope.hosts].sort()).toEqual(["192.0.2.10", "192.0.2.11", "msp.example"])
    expect(hostKeyInScope(scope, "10.42.0.101")).toBe(false)
    expect(hostKeyInScope(scope, "10.42.0.201")).toBe(false)
  })
})
