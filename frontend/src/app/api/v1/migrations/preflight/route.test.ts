import { describe, it, expect, vi, beforeEach } from "vitest"

// RBAC allows; the route gates on VM_MIGRATE.
vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn(async () => null),
  PERMISSIONS: { VM_MIGRATE: "vm.migrate", CONNECTION_VIEW: "connection.view" },
}))
// v2v-preflight is the default action; stub all its exports the route imports.
vi.mock("@/lib/migration/v2v-preflight", () => ({
  runV2vPreflight: vi.fn(async () => ({ ssh: true, errors: [] })),
  installV2vPackages: vi.fn(async () => ({ success: true })),
  startVirtioWinDownload: vi.fn(async () => ({ success: true })),
  checkVirtioWinProgress: vi.fn(async () => ({ done: true })),
}))
// The warm go/no-go helper — the new action under test.
vi.mock("@/lib/migration/warm/vddk-preflight", () => ({
  runWarmNodePreflight: vi.fn(async () => ({ ok: true, missing: [] })),
}))
vi.mock("@/lib/migration/warm/xcpng-node-preflight", () => ({
  runXcpngWarmNodePreflight: vi.fn(async () => ({ ok: true, missing: [] })),
}))
vi.mock("@/lib/migration/warm/target-space", () => ({
  checkTargetStorageSpace: vi.fn(),
}))
// roadmap#53: the copy-address probe from the node; the address grammar check stays real.
const readIfaces = vi.hoisted(() => vi.fn())
const scope = vi.hoisted(() => ({ tenant: "default", infra: { kind: "provider" } as any }))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: vi.fn(async () => scope.tenant), getSessionPrisma: vi.fn(async () => ({ session: true })) }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: vi.fn(async () => scope.infra),
}))
vi.mock("@/lib/vmware/copy-interfaces-server", () => ({ readVmCopyInterfaces: (...a: any[]) => readIfaces(...a) }))
vi.mock("@/lib/migration/warm/nfc-reachability", async (io) => {
  const actual = await io<typeof import("@/lib/migration/warm/nfc-reachability")>()
  return { ...actual, runWarmCopyReachability: vi.fn() }
})
vi.mock("@/lib/db/prisma", () => ({
  prisma: { connection: { findUnique: vi.fn(async () => ({ type: "vmware" })) } },
}))
// Only the boolean flag is consumed here; mocking also keeps the module's
// ssh2/prisma import chain out of this test.
vi.mock("@/lib/migration/warm/vddk-provision", () => ({
  isVddkPackageTokenConfigured: vi.fn(() => false),
}))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { runWarmNodePreflight } from "@/lib/migration/warm/vddk-preflight"
import { isVddkPackageTokenConfigured } from "@/lib/migration/warm/vddk-provision"
import { runV2vPreflight } from "@/lib/migration/v2v-preflight"
import { runXcpngWarmNodePreflight } from "@/lib/migration/warm/xcpng-node-preflight"
import { checkTargetStorageSpace, type TargetSpaceResult } from "@/lib/migration/warm/target-space"
import { runWarmCopyReachability } from "@/lib/migration/warm/nfc-reachability"
const mockReach = runWarmCopyReachability as unknown as ReturnType<typeof vi.fn>
import { prisma } from "@/lib/db/prisma"

const mockWarm = runWarmNodePreflight as unknown as ReturnType<typeof vi.fn>
const mockV2v = runV2vPreflight as unknown as ReturnType<typeof vi.fn>
const mockTokenConfigured = isVddkPackageTokenConfigured as unknown as ReturnType<typeof vi.fn>
const mockSpace = vi.mocked(checkTargetStorageSpace)
const mockSource = prisma.connection.findUnique as unknown as ReturnType<typeof vi.fn>
const spaceVerdict: TargetSpaceResult = {
  storage: "ZFS-Pool", type: "zfspool", availableBytes: 12 * 1024 ** 3,
  requiredBytes: 16 * 1024 ** 3, sufficient: false,
}
const warmBody = {
  action: "warm-check", sourceConnectionId: "src", targetConnectionId: "c1", targetNode: "pve1",
}

beforeEach(() => {
  readIfaces.mockReset()
  vi.clearAllMocks()
  mockSource.mockResolvedValue({ type: "vmware" })
  mockSpace.mockResolvedValue(spaceVerdict)
})

describe("POST /api/v1/migrations/preflight — warm-check action", () => {
  it("returns target space alongside the VDDK runtime verdict", async () => {
    const res = await callRoute(POST, {
      body: { ...warmBody, targetStorage: "ZFS-Pool", requiredDiskBytes: spaceVerdict.requiredBytes },
    })

    expect(res.status).toBe(200)
    expect(mockSource).toHaveBeenCalledWith({ where: { id: "src" }, select: { type: true } })
    expect(mockSpace).toHaveBeenCalledExactlyOnceWith("c1", "pve1", "ZFS-Pool", spaceVerdict.requiredBytes)
    expect(await res.json()).toEqual({ ok: true, missing: [], kind: "vddk", vddkTokenConfigured: false, space: spaceVerdict })
    expect(runXcpngWarmNodePreflight).not.toHaveBeenCalled()
  })

  it("omits space and does not check storage when targetStorage is absent", async () => {
    const res = await callRoute(POST, { body: { ...warmBody, requiredDiskBytes: spaceVerdict.requiredBytes } })

    expect(res.status).toBe(200)
    expect(mockSpace).not.toHaveBeenCalled()
    const json = await res.json()
    expect(json.kind).toBe("vddk")
    expect(json.space).toBeUndefined()
    expect(json).not.toHaveProperty("space")
  })

  it.each([-1, "abc"])("clamps requiredDiskBytes %j to zero", async (requiredDiskBytes) => {
    const res = await callRoute(POST, { body: { ...warmBody, targetStorage: "ZFS-Pool", requiredDiskBytes } })

    expect(res.status).toBe(200)
    expect(mockSpace).toHaveBeenCalledExactlyOnceWith("c1", "pve1", "ZFS-Pool", 0)
    expect((await res.json()).space).toEqual(spaceVerdict)
  })

  it("returns target space alongside the NBD runtime verdict for an XCP-ng source", async () => {
    mockSource.mockResolvedValueOnce({ type: "xcpng" })
    const res = await callRoute(POST, {
      body: { ...warmBody, targetStorage: "ZFS-Pool", requiredDiskBytes: spaceVerdict.requiredBytes },
    })

    expect(res.status).toBe(200)
    expect(mockSpace).toHaveBeenCalledExactlyOnceWith("c1", "pve1", "ZFS-Pool", spaceVerdict.requiredBytes)
    expect(runXcpngWarmNodePreflight).toHaveBeenCalledExactlyOnceWith("c1", "pve1")
    expect(mockWarm).not.toHaveBeenCalled()
    expect(await res.json()).toEqual({ ok: true, missing: [], kind: "nbd", vddkTokenConfigured: false, space: spaceVerdict })
  })

  it("dispatches warm-check to runWarmNodePreflight and returns its go/no-go verbatim", async () => {
    mockWarm.mockResolvedValueOnce({ ok: false, missing: ["vddk-plugin", "vddk-lib"], error: "node not prepared" })
    const res = await callRoute(POST, { body: { action: "warm-check", targetConnectionId: "c1", targetNode: "pve1" } })
    expect(res.status).toBe(200)
    expect(mockWarm).toHaveBeenCalledWith("c1", "pve1", undefined)
    const json = await readJson<{ ok: boolean; missing: string[] }>(res)
    expect(json?.ok).toBe(false)
    expect(json?.missing).toContain("vddk-plugin")
    // Must NOT fall through to the v2v preflight.
    expect(mockV2v).not.toHaveBeenCalled()
  })

  it("threads vddkLibdir through so the check uses the migration's libdir", async () => {
    mockWarm.mockResolvedValueOnce({ ok: true, missing: [] })
    const res = await callRoute(POST, {
      body: { action: "warm-check", targetConnectionId: "c1", targetNode: "pve1", vddkLibdir: "/opt/vddk" },
    })
    expect(res.status).toBe(200)
    expect(mockWarm).toHaveBeenCalledWith("c1", "pve1", "/opt/vddk")
    const json = await readJson<{ ok: boolean }>(res)
    expect(json?.ok).toBe(true)
  })

  // roadmap#53: reachability of the VMkernel adapter the copy will use.
  // roadmap#53: reachability of the VMkernel adapter the copy will use. The
  // address comes from vSphere for the adapter named, never from the request.
  const ifaces = (source: "esxi" | "vcenter") => ({
    hostName: "esxi1", source, defaultDevice: "vmk0",
    vnics: [{ device: "vmk0", address: "10.42.0.21", services: ["management"] }, { device: "vmk2", address: "10.42.53.21", services: [] }],
  })
  const copyBody = { ...warmBody, sourceConnectionId: "src", sourceVmId: "vm-14" }

  it("probes the address vSphere reports for the chosen adapter, with 443 only for a direct ESXi source", async () => {
    readIfaces.mockResolvedValueOnce(ifaces("esxi"))
    const verdict = { address: "10.42.53.21", ports: { 902: true, 443: true }, ok: true }
    mockReach.mockResolvedValueOnce(verdict)
    const res = await callRoute(POST, { body: { ...copyBody, copyVmk: "vmk2", copyAddress: "192.168.0.66" } })
    expect(res.status).toBe(200)
    expect(readIfaces).toHaveBeenCalledWith(expect.anything(), "src", "vm-14")
    // a copyAddress sent by the browser is ignored: the node probes the host's own adapter
    expect(mockReach).toHaveBeenCalledExactlyOnceWith("c1", "pve1", "10.42.53.21", true)
    expect((await readJson<{ copy: unknown }>(res))?.copy).toEqual(verdict)

    readIfaces.mockResolvedValueOnce(ifaces("vcenter"))
    mockReach.mockResolvedValueOnce({ address: "10.42.0.21", ports: { 902: false }, ok: false })
    const res2 = await callRoute(POST, { body: { ...copyBody, copyVmk: "vmk0" } })
    expect(mockReach).toHaveBeenLastCalledWith("c1", "pve1", "10.42.0.21", false)
    expect((await readJson<{ copy: { ok: boolean } }>(res2))?.copy.ok).toBe(false)
  })

  it("omits the copy verdict without an adapter, rejects a malformed one, and never probes an unknown adapter", async () => {
    const res = await callRoute(POST, { body: warmBody })
    expect(mockReach).not.toHaveBeenCalled()
    expect("copy" in ((await res.json()) as object)).toBe(false)

    for (const bad of [{ ...copyBody, copyVmk: "vmk0; reboot" }, { ...copyBody, copyVmk: "vmk0", sourceVmId: undefined }]) {
      expect((await callRoute(POST, { body: bad })).status).toBe(400)
    }

    readIfaces.mockResolvedValueOnce(ifaces("esxi"))
    const unknown = await callRoute(POST, { body: { ...copyBody, copyVmk: "vmk9" } })
    expect((await readJson<{ copy: { ok: boolean } }>(unknown))?.copy.ok).toBe(false)
    expect(mockReach).not.toHaveBeenCalled()

    readIfaces.mockRejectedValueOnce(new Error("vCenter unreachable"))
    const failed = await callRoute(POST, { body: { ...copyBody, copyVmk: "vmk2" } })
    expect(failed.status).toBe(200)
    expect((await readJson<{ copy: { ok: boolean; error: string } }>(failed))?.copy).toMatchObject({ ok: false, error: "vCenter unreachable" })
  })

  it("runs nothing for a vDC tenant, nor for an MSP outside its own clusters (404)", async () => {
    try {
      scope.tenant = "t1"
      for (const infra of [{ kind: "iaas", vdcScope: {} }, { kind: "msp", connectionIds: new Set(["c1"]) }]) {
        scope.infra = infra
        const res = await callRoute(POST, { body: { ...warmBody, sourceConnectionId: "src", sourceVmId: "vm-14", copyVmk: "vmk2" } })
        expect(res.status).toBe(404)
      }
      expect(mockWarm).not.toHaveBeenCalled()
      expect(readIfaces).not.toHaveBeenCalled()
    } finally {
      scope.tenant = "default"
      scope.infra = { kind: "provider" }
    }
  })

  it("probes an adapter only for a caller who may view the source connection", async () => {
    const { checkPermission } = await import("@/lib/rbac")
    vi.mocked(checkPermission).mockImplementation(async (perm: string) => (perm === "connection.view" ? Response.json({ error: "denied" }, { status: 403 }) as any : null))
    try {
      const res = await callRoute(POST, { body: { ...copyBody, copyVmk: "vmk2" } })
      expect(res.status).toBe(403)
      expect(checkPermission).toHaveBeenCalledWith("connection.view", "connection", "src")
      expect(readIfaces).not.toHaveBeenCalled()
      expect(mockReach).not.toHaveBeenCalled()
      // without an adapter the preflight does not need it
      expect((await callRoute(POST, { body: warmBody })).status).toBe(200)
    } finally {
      vi.mocked(checkPermission).mockImplementation(async () => null)
    }
  })

  it("reads the source adapters through the tenant-scoped client", async () => {
    readIfaces.mockResolvedValueOnce(ifaces("esxi"))
    mockReach.mockResolvedValueOnce({ address: "10.42.53.21", ports: { 902: true, 443: true }, ok: true })
    await callRoute(POST, { body: { ...copyBody, copyVmk: "vmk2" } })
    expect(readIfaces).toHaveBeenCalledWith({ session: true }, "src", "vm-14")
  })

  it("400s when targetConnectionId/targetNode are missing", async () => {
    const res = await callRoute(POST, { body: { action: "warm-check" } })
    expect(res.status).toBe(400)
    expect(mockWarm).not.toHaveBeenCalled()
  })

  it("reports whether the Enterprise VDDK package token is configured — boolean only, never the token", async () => {
    mockTokenConfigured.mockReturnValueOnce(true)
    mockWarm.mockResolvedValueOnce({ ok: false, missing: ["vddk-lib"], error: "node not prepared" })
    const res = await callRoute(POST, { body: { action: "warm-check", targetConnectionId: "c1", targetNode: "pve1" } })
    const json = await readJson<{ ok: boolean; vddkTokenConfigured?: boolean }>(res)
    expect(json?.vddkTokenConfigured).toBe(true)
    // The flag is route-layer only: the preflight helper itself is untouched.
    expect(mockWarm).toHaveBeenCalledWith("c1", "pve1", undefined)
  })

  it("hides the automated-setup offer when no token is configured", async () => {
    mockTokenConfigured.mockReturnValueOnce(false)
    const res = await callRoute(POST, { body: { action: "warm-check", targetConnectionId: "c1", targetNode: "pve1" } })
    const json = await readJson<{ vddkTokenConfigured?: boolean }>(res)
    expect(json?.vddkTokenConfigured).toBe(false)
  })

  it("leaves the default v2v preflight path intact", async () => {
    const res = await callRoute(POST, { body: { targetConnectionId: "c1", targetNode: "pve1", requiredDiskBytes: 100 } })
    expect(res.status).toBe(200)
    expect(mockV2v).toHaveBeenCalled()
    expect(mockWarm).not.toHaveBeenCalled()
  })
})

// #317 lot 2: the review step sends the disks of one VM to several storages,
// and asks the free space of each against what the disks bound for it need.
describe("POST /api/v1/migrations/preflight: storage-space action", () => {
  const body = { action: "storage-space", targetConnectionId: "c1", targetNode: "pve1" }
  const need = (storage: string, requiredBytes: number) => ({ storage, requiredBytes })

  it("checks every storage against its own need and answers one verdict per entry, in order", async () => {
    mockSpace.mockImplementation(async (_conn, _node, storage, requiredBytes) => ({ storage, type: "zfspool", availableBytes: 50, requiredBytes, sufficient: requiredBytes <= 40 }))
    const res = await callRoute(POST, { body: { ...body, needs: [need("ZFS-Pool", 10), need("san-lvm", 0), need("slow", 45)] } })
    expect(res.status).toBe(200)
    expect(mockSpace).toHaveBeenCalledTimes(3)
    expect(mockSpace).toHaveBeenCalledWith("c1", "pve1", "ZFS-Pool", 10)
    expect(mockSpace).toHaveBeenCalledWith("c1", "pve1", "san-lvm", 0)
    expect(await res.json()).toEqual({ spaces: [
      { storage: "ZFS-Pool", type: "zfspool", availableBytes: 50, requiredBytes: 10, sufficient: true },
      { storage: "san-lvm", type: "zfspool", availableBytes: 50, requiredBytes: 0, sufficient: true },
      { storage: "slow", type: "zfspool", availableBytes: 50, requiredBytes: 45, sufficient: false },
    ] })
    // its own action: neither node preflight runs
    expect(mockWarm).not.toHaveBeenCalled()
    expect(mockV2v).not.toHaveBeenCalled()
  })

  it.each([
    ["no needs", {}],
    ["an empty list", { needs: [] }],
    ["more than 64 entries", { needs: Array.from({ length: 65 }, (_, i) => need(`s${i}`, 1)) }],
    ["a storage name outside the PVE grammar", { needs: [need("pool; rm -rf /", 1)] }],
    ["a negative size", { needs: [need("ZFS-Pool", -1)] }],
    ["a size that is not a number", { needs: [{ storage: "ZFS-Pool", requiredBytes: "10" }] }],
    ["a missing size", { needs: [{ storage: "ZFS-Pool" }] }],
    ["an entry that is not an object", { needs: ["ZFS-Pool"] }],
  ])("400s on %s and checks nothing", async (_label, extra) => {
    const res = await callRoute(POST, { body: { ...body, ...extra } })
    expect(res.status).toBe(400)
    expect(mockSpace).not.toHaveBeenCalled()
  })

  it("applies the migrate right and the tenant scope of warm-check, before reading anything", async () => {
    const { checkPermission } = await import("@/lib/rbac")
    vi.mocked(checkPermission).mockImplementationOnce(async () => Response.json({ error: "denied" }, { status: 403 }) as any)
    expect((await callRoute(POST, { body: { ...body, needs: [need("ZFS-Pool", 1)] } })).status).toBe(403)
    expect(checkPermission).toHaveBeenCalledWith("vm.migrate")
    try {
      scope.tenant = "t1"
      for (const infra of [{ kind: "iaas", vdcScope: {} }, { kind: "msp", connectionIds: new Set(["other"]) }]) {
        scope.infra = infra
        expect((await callRoute(POST, { body: { ...body, needs: [need("ZFS-Pool", 1)] } })).status).toBe(404)
      }
    } finally {
      scope.tenant = "default"
      scope.infra = { kind: "provider" }
    }
    expect(mockSpace).not.toHaveBeenCalled()
  })
})
