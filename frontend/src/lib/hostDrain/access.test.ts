import { beforeEach, describe, expect, it, vi } from "vitest"

const checkPermissionMock = vi.hoisted(() => vi.fn())

const { pveFetchMock, getConnectionMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn(), getConnectionMock: vi.fn() }))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  buildNodeResourceId: (connId: string, node: string) => `${connId}:${node}`,
  buildVmResourceId: (connId: string, node: string, type: string, vmid: string) => `${connId}:${node}:${type}:${vmid}`,
  PERMISSIONS: { NODE_VIEW: "node.view", NODE_MANAGE: "node.manage", VM_MIGRATE: "vm.migrate" },
}))

vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: (...a: any[]) => getConnectionMock(...a) }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

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
  // The cluster as Proxmox reports it: pve4 is unknown to ProxCenter's host
  // records, it must be checked all the same.
  const cluster = [
    { type: "node", node: "pve1" }, { type: "node", node: "pve2" }, { type: "node", node: "pve3" }, { type: "node", node: "pve4" },
    { type: "qemu", node: "pve3", vmid: 105, status: "running" },
    { type: "qemu", node: "pve3", vmid: 106, status: "running", hastate: "started" },
    { type: "lxc", node: "pve3", vmid: 107, status: "stopped" },
    { type: "qemu", node: "pve3", vmid: 9000, status: "stopped", template: 1 },
    { type: "qemu", node: "pve1", vmid: 200, status: "running" },
  ]

  it("excludes from automatic placement the nodes the caller does not manage", async () => {
    const { restrictDrainTargets } = await import("./access")
    checkPermissionMock.mockImplementation(async (_p: string, _t: string, id: string) => (id === "c1:pve2" ? new Response(null, { status: 403 }) : null))

    expect(await restrictDrainTargets(cluster, "c1", "pve3", { exclude_nodes: ["pve9"] })).toEqual({ exclude_nodes: ["pve9", "pve2"] })
    // A node missing from ProxCenter's records is checked too (no fail-open).
    expect(checkPermissionMock).toHaveBeenCalledWith("node.manage", "node", "c1:pve4")
    expect(checkPermissionMock).not.toHaveBeenCalledWith("node.manage", "node", "c1:pve3")
  })

  it("keeps the config as is when every target is managed", async () => {
    const { restrictDrainTargets } = await import("./access")
    checkPermissionMock.mockResolvedValue(null)
    const config = { target_node: "pve1" }

    expect(await restrictDrainTargets(cluster, "c1", "pve3", config)).toBe(config)
  })

  it("refuses a target chosen for one guest that the caller does not manage", async () => {
    const { restrictDrainTargets, DrainTargetDenied } = await import("./access")
    checkPermissionMock.mockImplementation(async (_p: string, _t: string, id: string) => (id === "c1:pve2" ? new Response(null, { status: 403 }) : null))

    await expect(restrictDrainTargets(cluster, "c1", "pve3", { guest_targets: { 105: "pve1", 106: "pve2" } })).rejects.toBeInstanceOf(DrainTargetDenied)
  })

  it("refuses a forced target the caller does not manage", async () => {
    const { restrictDrainTargets, DrainTargetDenied } = await import("./access")
    checkPermissionMock.mockImplementation(async (_p: string, _t: string, id: string) => (id === "c1:pve1" ? new Response(null, { status: 403 }) : null))

    await expect(restrictDrainTargets(cluster, "c1", "pve3", { target_node: "pve1" })).rejects.toBeInstanceOf(DrainTargetDenied)
  })

  it("needs the right to migrate every guest the drain moves itself", async () => {
    const { restrictDrainTargets, DrainTargetDenied } = await import("./access")
    checkPermissionMock.mockImplementation(async (p: string, _t: string, id: string) => (p === "vm.migrate" && id === "c1:pve3:lxc:107" ? new Response(null, { status: 403 }) : null))

    await expect(restrictDrainTargets(cluster, "c1", "pve3", {})).rejects.toThrow("You cannot migrate guest(s) 107")
    await expect(restrictDrainTargets(cluster, "c1", "pve3", {})).rejects.toBeInstanceOf(DrainTargetDenied)
    // Neither the template nor a guest of another node is checked.
    expect(checkPermissionMock).not.toHaveBeenCalledWith("vm.migrate", "vm", "c1:pve3:qemu:9000")
    expect(checkPermissionMock).not.toHaveBeenCalledWith("vm.migrate", "vm", "c1:pve1:qemu:200")

    // Left on the node, or a stopped guest not moved: nothing to migrate.
    expect(await restrictDrainTargets(cluster, "c1", "pve3", { keep_vmids: [107] })).toEqual({ keep_vmids: [107] })
    expect(await restrictDrainTargets(cluster, "c1", "pve3", { include_stopped: false })).toEqual({ include_stopped: false })
  })

  it("leaves the running HA guests of a node entering maintenance to Proxmox HA", async () => {
    const { restrictDrainTargets } = await import("./access")
    checkPermissionMock.mockImplementation(async (p: string, _t: string, id: string) => (p === "vm.migrate" && id === "c1:pve3:qemu:106" ? new Response(null, { status: 403 }) : null))

    expect(await restrictDrainTargets(cluster, "c1", "pve3", { enter_maintenance: true })).toEqual({ enter_maintenance: true })
    await expect(restrictDrainTargets(cluster, "c1", "pve3", {})).rejects.toThrow("You cannot migrate guest(s) 106")
    // A node in maintenance is emptied: keep_vmids does not spare a guest.
    await expect(restrictDrainTargets(cluster, "c1", "pve3", { keep_vmids: [106] })).resolves.toBeDefined()
  })
})

describe("drainCluster (#248)", () => {
  it("reads the cluster from Proxmox and refuses a partial view", async () => {
    const { drainCluster } = await import("./access")
    getConnectionMock.mockResolvedValue({ id: "c1" })
    pveFetchMock.mockResolvedValueOnce([{ type: "node", node: "pve1" }])
    expect(await drainCluster("c1")).toEqual([{ type: "node", node: "pve1" }])
    expect(pveFetchMock).toHaveBeenCalledWith({ id: "c1" }, "/cluster/resources")

    pveFetchMock.mockResolvedValueOnce(null)
    await expect(drainCluster("c1")).rejects.toThrow("Could not read the cluster resources")
  })
})

describe("selection of guests (#1218)", () => {
  const cluster = [
    { type: "node", node: "pve1" }, { type: "node", node: "pve2" }, { type: "node", node: "pve3" },
    { type: "qemu", node: "pve1", vmid: 101, status: "running" },
    { type: "qemu", node: "pve2", vmid: 102, status: "stopped" },
    { type: "qemu", node: "pve3", vmid: 103, status: "running" },
    { type: "qemu", node: "pve2", vmid: 900, status: "stopped", template: 1 },
  ]

  it("names the nodes a drain acts on: its node, or every node its guests leave", async () => {
    const { drainNodes } = await import("./access")

    expect(drainNodes({ node: "pve3", guests: [{ source_node: "pve1" }] })).toEqual(["pve3"])
    expect(drainNodes({ guests: [{ source_node: "pve1" }, { source_node: "pve2" }, { source_node: "pve1" }, {}] })).toEqual(["pve1", "pve2"])
    expect(drainNodes({})).toEqual([])
  })

  it("lists a selection only with the right to view every node it moves guests from", async () => {
    checkPermissionMock.mockImplementation(async (_p: string, _t: string, id: string) => (id === "c1:pve2" ? new Response(null, { status: 403 }) : null))
    const selection = (id: string, nodes: string[]) => ({ id, connection_id: "c1", node: "", guests: nodes.map(n => ({ source_node: n })) })

    const kept = await filterViewableDrains([selection("a", ["pve1", "pve3"]), selection("b", ["pve1", "pve2"])])

    expect(kept.map(d => d.id)).toEqual(["a"])
  })

  it("checks the right to migrate each selected guest on the node it runs on, and nothing else", async () => {
    const { restrictDrainTargets } = await import("./access")
    checkPermissionMock.mockResolvedValue(null)

    expect(await restrictDrainTargets(cluster, "c1", "", { vmids: [101, 102] })).toEqual({ vmids: [101, 102] })
    expect(checkPermissionMock).toHaveBeenCalledWith("vm.migrate", "vm", "c1:pve1:qemu:101")
    expect(checkPermissionMock).toHaveBeenCalledWith("vm.migrate", "vm", "c1:pve2:qemu:102")
    expect(checkPermissionMock).not.toHaveBeenCalledWith("vm.migrate", "vm", "c1:pve3:qemu:103")
    // No source node: every node of the cluster is a possible target.
    for (const n of ["pve1", "pve2", "pve3"]) expect(checkPermissionMock).toHaveBeenCalledWith("node.manage", "node", `c1:${n}`)
  })

  it("refuses a selected guest the caller may not migrate", async () => {
    const { restrictDrainTargets } = await import("./access")
    checkPermissionMock.mockImplementation(async (p: string, _t: string, id: string) => (p === "vm.migrate" && id === "c1:pve3:qemu:103" ? new Response(null, { status: 403 }) : null))

    await expect(restrictDrainTargets(cluster, "c1", "", { vmids: [101, 103] })).rejects.toThrow("You cannot migrate guest(s) 103")
  })

  it("checks a selection whole: a template or a stopped guest left in place still needs the right, an unknown guest is refused alike", async () => {
    const { restrictDrainTargets } = await import("./access")
    checkPermissionMock.mockImplementation(async (p: string) => (p === "vm.migrate" ? new Response(null, { status: 403 }) : null))

    // The plan would name them: no right to migrate them, no plan.
    await expect(restrictDrainTargets(cluster, "c1", "", { vmids: [900, 102], include_stopped: false })).rejects.toThrow("You cannot migrate guest(s) 102, 900")
    // A guest outside the cluster gets the same answer, before the orchestrator could say it is unknown.
    checkPermissionMock.mockResolvedValue(null)
    await expect(restrictDrainTargets(cluster, "c1", "", { vmids: [101, 4242] })).rejects.toThrow("You cannot migrate guest(s) 4242")
  })

  it("refuses a drain record with no node at all", async () => {
    const { canActOnDrain } = await import("./access")
    checkPermissionMock.mockResolvedValue(null)

    expect(await canActOnDrain({ connection_id: "c1", node: "", guests: [] }, "node.view")).toBe(false)
    expect(await canActOnDrain({ connection_id: "c1", node: "pve1" }, "node.view")).toBe(true)
  })
})
