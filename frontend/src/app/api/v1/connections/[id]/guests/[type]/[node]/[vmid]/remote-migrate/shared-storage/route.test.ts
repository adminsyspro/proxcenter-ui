import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/api-tokens/routeGuard", () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute } from "@/__tests__/setup/route-test"

const m = vi.hoisted(() => ({
  checkPermission: vi.fn(),
  getConnectionById: vi.fn(),
  pveFetch: vi.fn(),
  getInfra: vi.fn(),
  guardSessionGuest: vi.fn(),
  findConnection: vi.fn(),
  executeSSH: vi.fn(),
  prove: vi.fn(),
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
vi.mock("@/lib/migration/sharedHandover/storageProof", () => ({ proveSharedStorages: (...a: any[]) => m.prove(...a) }))

const PARAMS = { id: "conn-src", type: "qemu", node: "pve1", vmid: "100" }
const BODY = { targetConnectionId: "conn-tgt", targetNode: "pve1-dr" }
const CONF = "memory: 512\nscsi0: CephStoragePool:vm-100-disk-0,size=8G\nnet0: virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0\n"

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
    if (path.endsWith("/config")) return { memory: 512, scsi0: "CephStoragePool:vm-100-disk-0,size=8G", digest: "abc" }
    throw new Error(`unexpected ${path}`)
  })
  m.executeSSH.mockResolvedValue({ success: true, output: CONF.trim() })
  m.prove.mockResolvedValue([{ storage: "CephStoragePool", ok: true, target: "XC-ProdCeph" }])
  ssh({ src: true, tgt: true })
})

describe("POST .../remote-migrate/shared-storage", () => {
  it("offers the move without copy once every storage is proven and SSH reaches both clusters", async () => {
    const { status, json } = await post()

    expect(status).toBe(200)
    expect(json).toMatchObject({ eligible: true, relevant: true, reasons: [], storages: [{ storage: "CephStoragePool", ok: true, target: "XC-ProdCeph" }] })
    expect(m.executeSSH).toHaveBeenCalledWith("conn-src", { host: "ip-pve1", port: 22 }, "cat '/etc/pve/nodes/pve1/qemu-server/100.conf'", 30_000, {})
    expect(m.prove.mock.calls[0][0]).toMatchObject({ vmid: "100", type: "qemu", volumes: [{ storage: "CephStoragePool", volid: "CephStoragePool:vm-100-disk-0" }] })
  })

  it("keeps the option visible but closed when the target cluster has no SSH", async () => {
    ssh({ src: true, tgt: false })

    const { json } = await post()

    expect(json).toMatchObject({ eligible: false, relevant: true, reasons: ["SSH_TARGET"] })
  })

  it("reads the API view of the guest when the source has no SSH, to still tell whether the option applies", async () => {
    ssh({ src: false, tgt: true })

    const { json } = await post()

    expect(m.executeSSH).not.toHaveBeenCalled()
    expect(m.prove.mock.calls[0][0].volumes).toEqual([{ section: "main", key: "scsi0", storage: "CephStoragePool", volid: "CephStoragePool:vm-100-disk-0" }])
    expect(json).toMatchObject({ eligible: false, relevant: true, reasons: ["SSH_SOURCE"] })
  })

  it("names the keys that bind the guest to its node", async () => {
    m.executeSSH.mockResolvedValue({ success: true, output: `${CONF}hostpci0: 0000:01:00.0` })

    const { json } = await post()

    expect(json).toMatchObject({ eligible: false, reasons: ["NOT_PORTABLE"], blockers: ["hostpci0"] })
  })

  it("says which storage is not proven", async () => {
    m.prove.mockResolvedValue([{ storage: "CephStoragePool", ok: false, reason: "not-visible" }])

    const { json } = await post()

    expect(json).toMatchObject({ eligible: false, relevant: true, reasons: ["STORAGE_NOT_SHARED"] })
  })

  it("does not offer the option at all for a guest on storages no other cluster can reach", async () => {
    m.prove.mockResolvedValue([{ storage: "local-zfs", ok: false, reason: "local-type" }])

    const { json } = await post()

    expect(json).toMatchObject({ eligible: false, relevant: false })
  })

  it("lists the ISO images that will be detached", async () => {
    m.executeSSH.mockResolvedValue({ success: true, output: `${CONF}ide2: local:iso/debian.iso,media=cdrom` })

    const { json } = await post()

    expect(json.isos).toEqual(["local:iso/debian.iso"])
  })

  it("works for a container", async () => {
    m.executeSSH.mockResolvedValue({ success: true, output: "rootfs: CephStoragePool:vm-101-disk-0,size=8G" })

    const { json } = await post(BODY, { ...PARAMS, type: "lxc", vmid: "101" })

    expect(json).toMatchObject({ eligible: true })
    expect(m.executeSSH.mock.calls[0][2]).toBe("cat '/etc/pve/nodes/pve1/lxc/101.conf'")
  })

  it.each([
    ["an unknown guest type", { ...PARAMS, type: "openvz" }, BODY, 400],
    ["a VMID that is not one", { ...PARAMS, vmid: "1;id" }, BODY, 400],
    ["a target node outside the target cluster", PARAMS, { ...BODY, targetNode: "elsewhere" }, 400],
    ["a missing target connection", PARAMS, { targetNode: "pve1-dr" }, 400],
  ])("refuses %s", async (_label, params, body, status) => {
    expect((await post(body, params as any)).status).toBe(status)
    expect(m.prove).not.toHaveBeenCalled()
  })

  it("refuses a tenant that may not migrate between these connections", async () => {
    m.getInfra.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-src"]) })

    expect((await post()).status).toBe(403)
    expect(m.prove).not.toHaveBeenCalled()
  })

  it("refuses a caller without vm.migrate on the target cluster", async () => {
    const { NextResponse } = await import("next/server")
    m.checkPermission.mockImplementation(async (_p: string, kind: string) => (kind === "connection" ? NextResponse.json({ error: "Forbidden" }, { status: 403 }) : null))

    expect((await post()).status).toBe(403)
  })
})
