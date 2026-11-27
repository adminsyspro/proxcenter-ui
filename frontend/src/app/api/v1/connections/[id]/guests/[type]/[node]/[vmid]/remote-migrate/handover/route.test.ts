import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api-tokens/routeGuard", () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))
vi.mock("@/lib/audit/withAudit", () => ({ withAudit: (_o: any, handler: any) => handler }))

import { callRoute } from "@/__tests__/setup/route-test"

const m = vi.hoisted(() => ({
  checkPermission: vi.fn(),
  getConnectionById: vi.fn(),
  pveFetch: vi.fn(),
  getInfra: vi.fn(),
  guardSessionGuest: vi.fn(),
  findConnection: vi.fn(),
  executeSSH: vi.fn(),
  executeHandover: vi.fn(),
  audit: vi.fn(),
  forgetCachedGuest: vi.fn(),
  refreshCachedGuests: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => m.checkPermission(...a),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}/${node}/${type}/${vmid}`,
  PERMISSIONS: { VM_MIGRATE: "vm.migrate" },
}))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: (...a: any[]) => m.getConnectionById(...a) }))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => m.pveFetch(...a) }))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: async () => "default" }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => m.getInfra(...a),
}))
vi.mock("@/lib/vdc/guestGuard", () => ({ guardSessionGuest: (...a: any[]) => m.guardSessionGuest(...a) }))
vi.mock("@/lib/db/prisma", () => ({ prisma: { connection: { findUnique: (...a: any[]) => m.findConnection(...a) } } }))
vi.mock("@/lib/ssh/exec", () => ({ executeSSH: (...a: any[]) => m.executeSSH(...a) }))
vi.mock("@/lib/ssh/node-endpoint", () => ({ resolveNodeSshEndpoint: async (_c: any, node: string) => ({ host: `ip-${node}`, port: 22 }) }))
vi.mock("@/lib/migration/sharedHandover/handover", async (orig) => ({
  ...(await orig<typeof import("@/lib/migration/sharedHandover/handover")>()),
  executeHandover: (...a: any[]) => m.executeHandover(...a),
}))
vi.mock("@/lib/audit", () => ({ audit: (...a: any[]) => m.audit(...a) }))
vi.mock("@/lib/cache/inventoryCache", () => ({ forgetCachedGuest: (...a: any[]) => m.forgetCachedGuest(...a) }))
vi.mock("@/lib/cache/guestSetRefresh", () => ({ refreshCachedGuests: (...a: any[]) => m.refreshCachedGuests(...a) }))

const PARAMS = { id: "conn-src", type: "qemu", node: "pve1", vmid: "100" }
const BODY = { targetConnectionId: "conn-tgt", targetNode: "pve1-dr", targetBridge: "vmbr1", start: true }
const MOVED = {
  ok: true,
  storages: { CephStoragePool: "XC-ProdCeph" },
  detachedIsos: [],
  firewall: false,
  archive: "/var/lib/proxcenter/handover/100-20261127T072900Z",
  startUpid: "UPID:pve1-dr:qmstart:100",
}

function ssh(enabled: { src: boolean; tgt: boolean }) {
  m.findConnection.mockImplementation(async ({ where }: any) => {
    const on = where.id === "conn-src" ? enabled.src : enabled.tgt

    return { sshEnabled: on, sshKeyEnc: on ? "k" : null, sshPassEnc: null }
  })
}

async function post(body: any = BODY, params = PARAMS) {
  const { POST } = await import("./route")
  const res = await callRoute(POST as any, { method: "POST", params, body })

  return { status: res.status, json: await res.json() }
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset()
  m.checkPermission.mockResolvedValue(null)
  m.getConnectionById.mockImplementation(async (id: string) => ({ id, name: id, baseUrl: "https://x:8006", apiToken: "t" }))
  m.getInfra.mockResolvedValue({ kind: "provider" })
  m.guardSessionGuest.mockResolvedValue(null)
  m.pveFetch.mockImplementation(async (_c: any, path: string) => {
    if (path === "/nodes") return [{ node: "pve1-dr" }]
    throw new Error(`unexpected ${path}`)
  })
  m.executeSSH.mockResolvedValue({ success: true, output: "" })
  m.executeHandover.mockResolvedValue(MOVED)
  m.audit.mockResolvedValue("a1")
  m.refreshCachedGuests.mockResolvedValue(undefined)
  ssh({ src: true, tgt: true })
})

describe("POST .../remote-migrate/handover", () => {
  it("moves the guest and hands back the start task on the target cluster", async () => {
    const { status, json } = await post()

    expect(status).toBe(200)
    expect(json).toMatchObject({
      success: true,
      data: "UPID:pve1-dr:qmstart:100",
      task: { connectionId: "conn-tgt", node: "pve1-dr" },
      handover: { storages: { CephStoragePool: "XC-ProdCeph" } },
    })
    expect(m.executeHandover.mock.calls[0][0]).toMatchObject({
      type: "qemu", vmid: "100", bridge: "vmbr1", start: true,
      source: { node: "pve1", conn: { id: "conn-src" } },
      target: { node: "pve1-dr", conn: { id: "conn-tgt" } },
    })
  })

  it("runs the SSH commands of each side on that side's node", async () => {
    await post()
    const { source, target } = m.executeHandover.mock.calls[0][0]

    await source.ssh("true")
    await target.ssh("tee x", { stdin: "memory: 1\n" })

    expect(m.executeSSH).toHaveBeenCalledWith("conn-src", { host: "ip-pve1", port: 22 }, "true", 30_000, {})
    expect(m.executeSSH).toHaveBeenCalledWith("conn-tgt", { host: "ip-pve1-dr", port: 22 }, "tee x", 30_000, { stdin: "memory: 1\n" })
  })

  it("leaves the guest stopped unless asked to start it", async () => {
    await post({ ...BODY, start: undefined })

    expect(m.executeHandover.mock.calls[0][0].start).toBe(false)
  })

  it("updates both inventories: gone from the source, present on the target", async () => {
    await post()

    expect(m.forgetCachedGuest).toHaveBeenCalledWith("conn-src", "qemu", "100")
    expect(m.refreshCachedGuests).toHaveBeenCalledWith("conn-tgt", expect.objectContaining({ id: "conn-tgt" }), { type: "qemu", vmid: "100" })
  })

  it("audits the move with its storages", async () => {
    await post()

    expect(m.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: "migrate",
      resourceId: "100",
      details: expect.objectContaining({ mode: "shared-storage", targetCluster: "conn-tgt", storages: { CephStoragePool: "XC-ProdCeph" } }),
    }))
  })

  it.each([
    ["source", { src: false, tgt: true }],
    ["target", { src: true, tgt: false }],
  ])("refuses without SSH on the %s cluster", async (_side, enabled) => {
    ssh(enabled)

    const { status, json } = await post()

    expect(status).toBe(409)
    expect(json.code).toBe("SSH_REQUIRED")
    expect(m.executeHandover).not.toHaveBeenCalled()
  })

  it("refuses a bridge name that is not one", async () => {
    expect((await post({ ...BODY, targetBridge: "vmbr0;id" })).status).toBe(400)
    expect(m.executeHandover).not.toHaveBeenCalled()
  })

  it("answers 409 to a refusal made before anything changed", async () => {
    m.executeHandover.mockResolvedValue({ ok: false, code: "GUEST_RUNNING", message: "The guest must be stopped first", context: { status: "running" } })

    const { status, json } = await post()

    expect(status).toBe(409)
    expect(json).toMatchObject({ error: "The guest must be stopped first", code: "GUEST_RUNNING", context: { status: "running" } })
    expect(m.forgetCachedGuest).not.toHaveBeenCalled()
  })

  it("answers 500 with the manual steps when the rollback failed", async () => {
    m.executeHandover.mockResolvedValue({ ok: false, code: "ROLLBACK_FAILED", message: "rollback failed", manual: ["mv a b"] })

    const { status, json } = await post()

    expect(status).toBe(500)
    expect(json).toMatchObject({ code: "ROLLBACK_FAILED", manual: ["mv a b"] })
  })

  it("answers 200 with the start error when only the start failed", async () => {
    m.executeHandover.mockResolvedValue({ ...MOVED, startUpid: null, startError: "bridge vmbr9 does not exist" })

    const { status, json } = await post()

    expect(status).toBe(200)
    expect(json).toMatchObject({ data: null, handover: { startError: "bridge vmbr9 does not exist" } })
    expect(m.audit.mock.calls[0][0].details).toMatchObject({ started: false, startError: "bridge vmbr9 does not exist" })
  })

  it("refuses a tenant that may not migrate between these connections", async () => {
    m.getInfra.mockResolvedValue({ kind: "vdc" })

    expect((await post()).status).toBe(403)
    expect(m.executeHandover).not.toHaveBeenCalled()
  })

  it("answers 500 when the move throws", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    m.executeHandover.mockRejectedValue(new Error("proxy handler failed"))

    const { status, json } = await post()

    expect(status).toBe(500)
    expect(json.error).toContain("proxy handler failed")
    err.mockRestore()
  })
})
