import { beforeEach, describe, expect, it, vi } from "vitest"

const checkPermissionMock = vi.hoisted(() => vi.fn())

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  buildNodeResourceId: (connId: string, node: string) => `${connId}:${node}`,
  PERMISSIONS: { NODE_VIEW: "node.view", NODE_MANAGE: "node.manage" },
}))

import { filterViewableDrains } from "./access"

beforeEach(() => checkPermissionMock.mockReset())

describe("filterViewableDrains (#248)", () => {
  it("keeps the drains whose node the caller may view, checked node by node", async () => {
    checkPermissionMock.mockImplementation(async (_p: string, _t: string, id: string) => (id === "c1:pve3" ? null : new Response(null, { status: 403 })))

    const kept = await filterViewableDrains([
      { id: "a", connection_id: "c1", node: "pve3" },
      { id: "b", connection_id: "c1", node: "pve2" },
      { id: "c" },
    ])

    expect(kept.map(d => (d as any).id)).toEqual(["a", "c"])
    expect(checkPermissionMock).toHaveBeenCalledWith("node.view", "node", "c1:pve2")
    expect(checkPermissionMock).toHaveBeenCalledTimes(2)
  })
})

describe("publicDrain (#248)", () => {
  it("drops the SSH access from the config, keeps the rest", async () => {
    const { publicDrain } = await import("./access")
    const drain = { id: "d", node: "pve3", config: { enter_maintenance: true, ssh_credentials: { sshPassword: "p" }, ssh_overrides: { pve3: {} } } }

    expect(publicDrain(drain)).toEqual({ id: "d", node: "pve3", config: { enter_maintenance: true } })
    expect(drain.config.ssh_credentials).toBeDefined()
    expect(publicDrain({ id: "x" })).toEqual({ id: "x" })
    expect(publicDrain(null)).toBeNull()
  })
})

describe("restrictDrainTargets (#248)", () => {
  const prisma = { managedHost: { findMany: vi.fn(async () => [{ node: "pve1" }, { node: "pve2" }, { node: "pve3" }, { node: "pve2" }]) } }

  it("excludes from automatic placement the nodes the caller does not manage", async () => {
    const { restrictDrainTargets } = await import("./access")
    checkPermissionMock.mockImplementation(async (_p: string, _t: string, id: string) => (id === "c1:pve2" ? new Response(null, { status: 403 }) : null))

    expect(await restrictDrainTargets(prisma, "c1", "pve3", { exclude_nodes: ["pve9"] })).toEqual({ exclude_nodes: ["pve9", "pve2"] })
    expect(checkPermissionMock).not.toHaveBeenCalledWith("node.manage", "node", "c1:pve3")
  })

  it("keeps the config as is when every target is managed", async () => {
    const { restrictDrainTargets } = await import("./access")
    checkPermissionMock.mockResolvedValue(null)
    const config = { target_node: "pve1" }

    expect(await restrictDrainTargets(prisma, "c1", "pve3", config)).toBe(config)
  })

  it("refuses a target chosen for one guest that the caller does not manage", async () => {
    const { restrictDrainTargets, DrainTargetDenied } = await import("./access")
    checkPermissionMock.mockImplementation(async (_p: string, _t: string, id: string) => (id === "c1:pve2" ? new Response(null, { status: 403 }) : null))

    await expect(restrictDrainTargets(prisma, "c1", "pve3", { guest_targets: { 105: "pve1", 106: "pve2" } })).rejects.toBeInstanceOf(DrainTargetDenied)
  })

  it("refuses a forced target the caller does not manage", async () => {
    const { restrictDrainTargets, DrainTargetDenied } = await import("./access")
    checkPermissionMock.mockImplementation(async (_p: string, _t: string, id: string) => (id === "c1:pve1" ? new Response(null, { status: 403 }) : null))

    await expect(restrictDrainTargets(prisma, "c1", "pve3", { target_node: "pve1" })).rejects.toBeInstanceOf(DrainTargetDenied)
  })
})
