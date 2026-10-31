import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  sessionGuestVisibility: vi.fn(),
  rbacCtx: vi.fn(),
  filterVms: vi.fn(),
  pveFetch: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  getRBACContext: h.rbacCtx,
  filterVmsByPermission: h.filterVms,
  PERMISSIONS: { VM_VIEW: "vm.view" },
}))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: h.pveFetch }))

vi.mock("./guestGuard", async (orig) => ({
  ...(await orig<typeof import("./guestGuard")>()),
  sessionGuestVisibility: h.sessionGuestVisibility,
}))

import { groupGuestsByConnection, visibleRequestedGuests } from "./bulkGuests"

const CONN = { id: "c1" } as any

describe("groupGuestsByConnection", () => {
  it("groups well-formed guests by connection, vmid as a string, status kept", () => {
    const grouped = groupGuestsByConnection([
      { connId: "c1", type: "qemu", node: "pve1", vmid: 100, status: "running" },
      { connId: "c1", type: "lxc", node: "pve2", vmid: "101" },
      { connId: "c2", type: "qemu", node: "pve3", vmid: "102" },
    ])

    expect([...grouped.keys()]).toEqual(["c1", "c2"])
    expect(grouped.get("c1")).toEqual([
      { type: "qemu", node: "pve1", vmid: "100", status: "running" },
      { type: "lxc", node: "pve2", vmid: "101" },
    ])
  })

  it("drops every entry whose identifiers would reshape the PVE URL", () => {
    const grouped = groupGuestsByConnection([
      { connId: "c1", type: "qemu/../../cluster", node: "pve1", vmid: "100" },
      { connId: "c1", type: "qemu", node: "pve1", vmid: "100/../105" },
      { connId: "c1", type: "qemu", node: "../pve1", vmid: "100" },
      { connId: "c1", type: "qemu", node: "pve1" },
      { connId: "", type: "qemu", node: "pve1", vmid: "100" },
      { connId: 7, type: "qemu", node: "pve1", vmid: "100" },
      null,
    ])

    expect(grouped.size).toBe(0)
  })

  it("answers an empty map for a body that is not a list", () => {
    expect(groupGuestsByConnection(undefined).size).toBe(0)
    expect(groupGuestsByConnection({ connId: "c1" }).size).toBe(0)
  })

  it("ignores a status that is not a string", () => {
    const grouped = groupGuestsByConnection([{ connId: "c1", type: "qemu", node: "pve1", vmid: "100", status: 1 }])
    expect(grouped.get("c1")).toEqual([{ type: "qemu", node: "pve1", vmid: "100" }])
  })
})

describe("visibleRequestedGuests", () => {
  const guests = [
    { type: "qemu" as const, node: "pve1", vmid: "100" },
    { type: "lxc" as const, node: "pve2", vmid: "105" },
  ]

  beforeEach(() => {
    h.sessionGuestVisibility.mockReset()
    h.rbacCtx.mockReset().mockResolvedValue({ isAdmin: true, tenantId: "default" })
    h.filterVms.mockReset()
    h.pveFetch.mockReset()
  })

  it("keeps every guest for a provider or MSP session", async () => {
    h.sessionGuestVisibility.mockResolvedValue({ ok: true, visibility: { all: true, has: () => true } })

    expect(await visibleRequestedGuests("c1", CONN, guests)).toBe(guests)
    expect(h.sessionGuestVisibility).toHaveBeenCalledWith({ connectionId: "c1", conn: CONN, resources: undefined })
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it("keeps the guests the caller's vm.view grants cover, matched on the pool PVE reports", async () => {
    const resources = [{ type: "qemu", vmid: 100, pool: "web" }, { type: "lxc", vmid: 105, pool: "db" }]
    h.rbacCtx.mockResolvedValue({ isAdmin: false, tenantId: "default", userId: "u1" })
    h.pveFetch.mockResolvedValue(resources)
    h.filterVms.mockImplementation(async (_p: unknown, list: any[]) => list.filter(g => g.pool === "web"))
    h.sessionGuestVisibility.mockResolvedValue({ ok: true, visibility: { all: true, has: () => true } })

    expect(await visibleRequestedGuests("c1", CONN, guests)).toEqual([guests[0]])
    expect(h.filterVms.mock.calls[0][1].map((g: any) => [g.connId, g.pool])).toEqual([["c1", "web"], ["c1", "db"]])
    expect(h.sessionGuestVisibility).toHaveBeenCalledWith({ connectionId: "c1", conn: CONN, resources })
  })

  it("answers null for a scoped caller when the guest list cannot be read", async () => {
    h.rbacCtx.mockResolvedValue({ isAdmin: false, tenantId: "default", userId: "u1" })
    h.pveFetch.mockRejectedValue(new Error("595"))

    expect(await visibleRequestedGuests("c1", CONN, guests)).toBeNull()
    expect(h.filterVms).not.toHaveBeenCalled()
  })

  it("keeps the guests of the vDC pools only", async () => {
    const has = vi.fn((type: string | null, vmid: string | number) => type === "lxc" && vmid === "105")
    h.sessionGuestVisibility.mockResolvedValue({ ok: true, visibility: { all: false, has } })

    expect(await visibleRequestedGuests("c1", CONN, guests)).toEqual([guests[1]])
  })

  it("answers null when the visibility cannot be established", async () => {
    h.sessionGuestVisibility.mockResolvedValue({ ok: false, response: new Response(null, { status: 503 }) })

    expect(await visibleRequestedGuests("c1", CONN, guests)).toBeNull()
  })
})
