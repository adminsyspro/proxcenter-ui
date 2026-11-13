import { beforeEach, describe, expect, it, vi } from "vitest"

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock("@/lib/api-tokens/routeGuard", () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { pendingVdcGpus, resetVdcPending } from "@/lib/gpu/vdcPending"

// Hoisted mocks -- referenced from vi.mock factories below, which vitest
// hoists above these imports/consts, so they must themselves be created
// via vi.hoisted().
const {
  getConnectionByIdMock,
  getInfraMock,
  checkPermissionMock,
  pveFetchMock,
  resolveVdcForTenantMock,
  getCurrentTenantIdMock,
  waitForTaskMock,
  syncIpamForVmConfigMock,
  releaseAllocationsForVmMock,
  resolveVisibleMock,
  archiveGpuConfigMock,
  restoreContingentCheckMock,
  vdcFindFirstMock,
  waitForTaskStoppedMock,
  afterCbs,
} = vi.hoisted(() => ({
  getConnectionByIdMock: vi.fn(),
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  pveFetchMock: vi.fn(),
  resolveVdcForTenantMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  waitForTaskMock: vi.fn(),
  syncIpamForVmConfigMock: vi.fn(),
  releaseAllocationsForVmMock: vi.fn(),
  resolveVisibleMock: vi.fn(),
  archiveGpuConfigMock: vi.fn(),
  restoreContingentCheckMock: vi.fn(),
  vdcFindFirstMock: vi.fn(),
  waitForTaskStoppedMock: vi.fn(),
  afterCbs: [] as Array<() => Promise<void>>,
}))

// The route schedules post-restore work (waitForTask, pool placement, IPAM
// sync, QoS restamp) via next/server's after(). Most tests only care about
// the synchronous response + the immediate PVE POST, so they never drive
// afterCbs. Tests that need to exercise the scheduled work (Task 13's
// restamp block) pull the captured callback out of afterCbs and await it
// directly -- keeping NextResponse itself real.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>()
  return { ...actual, after: (fn: () => Promise<void>) => { afterCbs.push(fn) } }
})

vi.mock("@/lib/proxmox/client", () => ({ pveFetch: pveFetchMock }))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  checkPermissions: async (perms: string[], ...rest: any[]) => {
    for (const p of perms) {
      const denied = await checkPermissionMock(p, ...rest)
      if (denied) return denied
    }
    return null
  },
  buildNodeResourceId: (...a: any[]) => a.join(":"),
  buildVmResourceId: (...a: any[]) => a.join(":"),
  PERMISSIONS: { VM_BACKUP: "vm.backup", BACKUP_RESTORE: "backup.restore", VM_DELETE: "vm.delete" },
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: () => getCurrentTenantIdMock(),
  DEFAULT_TENANT_ID: "default",
}))
// Spread the real module: the real checkTenantGuestScope (force path) reads
// maskingScope from it.
vi.mock("@/lib/tenant/infraScope", async (io) => ({
  ...(await io<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))
vi.mock("@/lib/vdc/quota", () => ({
  resolveVdcForTenant: (...a: any[]) => resolveVdcForTenantMock(...a),
}))
// Only exercised by the pbsBackup path, which none of these tests take.
// Spread the real module: the route also imports the pure helpers
// writableStoragesFor / readOnlyLibraryError (#894); only the PBS access
// guard is stubbed.
vi.mock("@/lib/vdc/scope", async (io) => {
  const actual = await io<typeof import("@/lib/vdc/scope")>()
  return { ...actual, assertVdcPbsAccess: vi.fn() }
})
vi.mock("@/lib/proxmox/tasks", () => ({
  waitForTask: (...a: any[]) => waitForTaskMock(...a),
  waitForTaskStopped: (...a: any[]) => waitForTaskStoppedMock(...a),
}))
vi.mock("@/lib/vdc/ipamSync", () => ({ syncIpamForVmConfig: (...a: any[]) => syncIpamForVmConfigMock(...a) }))
vi.mock("@/lib/vdc/ipam", () => ({ releaseAllocationsForVm: (...a: any[]) => releaseAllocationsForVmMock(...a) }))
// Guards prisma.vdc.findFirst (pool-placement lookup, isTenant only) and
// prisma.connection.findUnique (pbsBackup path, unused here) from hitting a
// real database.
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    vdc: { findFirst: (...a: any[]) => vdcFindFirstMock(...a) },
    connection: { findUnique: vi.fn() },
  },
}))
// Dynamically imported by the route (`await import("@/lib/audit")`); vi.mock
// intercepts dynamic imports too.
vi.mock("@/lib/audit", () => ({ audit: vi.fn().mockResolvedValue("audit-1") }))
vi.mock("@/lib/gpu/vdcGuard", async () => ({
  contingentRefusal: (await vi.importActual<typeof import("@/lib/gpu/vdcGuard")>("@/lib/gpu/vdcGuard")).contingentRefusal,
  archiveGpuConfig: (...a: any[]) => archiveGpuConfigMock(...a),
  restoreContingentCheck: (...a: any[]) => restoreContingentCheckMock(...a),
}))
vi.mock("@/lib/api-tokens/scope", () => ({ resolveVisibleConnectionIds: (...a: any[]) => resolveVisibleMock(...a) }))

beforeEach(() => {
  afterCbs.length = 0
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({
    id: "pve-1",
    name: "pve-1",
    baseUrl: "https://pve.local:8006",
    apiToken: "t",
    insecureDev: false,
    behindProxy: false,
  })
  getCurrentTenantIdMock.mockReset().mockResolvedValue("default")
  getInfraMock.mockReset().mockResolvedValue({ kind: "provider" })
  resolveVdcForTenantMock.mockReset().mockResolvedValue(null)
  pveFetchMock.mockReset().mockResolvedValue("UPID:pve-1:00000000:00000000:00000000:qmrestore:111:root@pam:")
  waitForTaskMock.mockReset().mockResolvedValue(undefined)
  syncIpamForVmConfigMock.mockReset().mockResolvedValue({ bodyOverrides: {}, rollback: vi.fn() })
  releaseAllocationsForVmMock.mockReset()
  archiveGpuConfigMock.mockReset().mockResolvedValue({})
  restoreContingentCheckMock.mockReset().mockResolvedValue({ ok: true, demand: [] })
  vdcFindFirstMock.mockReset().mockResolvedValue(null)
  waitForTaskStoppedMock.mockReset().mockResolvedValue({ stopped: true, exitstatus: "OK" })
  resetVdcPending()
})

/** Decode the URL-encoded form body of a pveFetch(conn, path, opts) call. */
function postedParams(call: unknown[]): URLSearchParams {
  const opts = call[2] as { body?: string }
  return new URLSearchParams(opts?.body ?? "")
}

const VZDUMP_QEMU_VOLID = "local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst"
const VZDUMP_LXC_VOLID = "local:backup/vzdump-lxc-111-2026_08_11-15_51_33.tar.zst"

describe("POST /api/v1/connections/[id]/nodes/[node]/restore -- raw archive volid contract", () => {
  it("qemu: archive volid is posted as `archive` to /nodes/{node}/qemu", async () => {
    const { POST } = await import("./route")

    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_QEMU_VOLID, type: "qemu" },
    })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)

    const call = pveFetchMock.mock.calls[0]
    expect(call[1]).toBe("/nodes/node1/qemu")
    const params = postedParams(call)
    expect(params.get("archive")).toBe(VZDUMP_QEMU_VOLID)
    expect(params.get("vmid")).toBe("111")
    expect(params.has("ostemplate")).toBe(false)
    expect(params.has("restore")).toBe(false)
  })

  it("lxc: archive volid is posted as `ostemplate` with restore=1 to /nodes/{node}/lxc", async () => {
    const { POST } = await import("./route")

    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      // An explicit target: the "default storage" resolution has its own block.
      body: { vmid: 111, archive: VZDUMP_LXC_VOLID, type: "lxc", storage: "local-lvm" },
    })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)

    const call = pveFetchMock.mock.calls[0]
    expect(call[1]).toBe("/nodes/node1/lxc")
    const params = postedParams(call)
    expect(params.get("ostemplate")).toBe(VZDUMP_LXC_VOLID)
    expect(params.get("restore")).toBe("1")
    expect(params.has("archive")).toBe(false)
  })

  it("iaas tenant: archive storage outside the vDC allow-list is refused, no PVE call emitted", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-x")
    getInfraMock.mockResolvedValue({
      kind: "iaas",
      vdcScope: {
        connectionIds: new Set(["pve-1"]),
        pbsConnectionIds: new Set<string>(),
        nodesByConnection: new Map<string, Set<string>>(),
        // Allow-listed storage is "ceph-vdc" -- deliberately does NOT
        // include "local", which is the prefix of the archive below.
        storagesByConnection: new Map([["pve-1", new Set(["ceph-vdc"])]]),
        storagePoliciesByConnection: new Map<string, Map<string, any>>(),
        poolsByConnection: new Map<string, Set<string>>(),
        vnetsByConnection: new Map<string, Set<string>>(),
        sharedBridgesByConnection: new Map<string, Set<string>>(),
        pbsNamespacesByConnection: new Map<string, Array<{ datastore: string; namespace: string }>>(),
        pbsNamespacesByPveConnection: new Map<string, Set<string>>(),
      },
    })
    // Tenant does have a vDC on this connection/node -- the allow-list
    // check, not the "no vDC" branch, is what must reject this request.
    resolveVdcForTenantMock.mockResolvedValue({ vdcId: "vdc-1", poolName: "pool-1", quota: null })

    const { POST } = await import("./route")
    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_QEMU_VOLID, type: "qemu" },
    })

    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toMatch(/not authorised/i)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

describe("POST /api/v1/connections/[id]/nodes/[node]/restore -- post-restore QoS restamp (Task 13)", () => {
  const gold = { policyId: "p-gold", name: "Gold", iopsRd: 5000, iopsWr: 4000, mbpsRd: 500, mbpsWr: null }

  /** iaas union scope with the given per-connection allowed storages + tier policies. */
  function iaasScope(storages: string[], policies: Record<string, typeof gold> = {}) {
    return {
      kind: "iaas",
      vdcScope: {
        connectionIds: new Set(["pve-1"]),
        pbsConnectionIds: new Set<string>(),
        nodesByConnection: new Map<string, Set<string>>(),
        storagesByConnection: new Map([["pve-1", new Set(storages)]]),
        storagePoliciesByConnection: new Map([["pve-1", new Map(Object.entries(policies))]]),
        poolsByConnection: new Map<string, Set<string>>(),
        vnetsByConnection: new Map<string, Set<string>>(),
        sharedBridgesByConnection: new Map<string, Set<string>>(),
        pbsNamespacesByConnection: new Map<string, Array<{ datastore: string; namespace: string }>>(),
        pbsNamespacesByPveConnection: new Map<string, Set<string>>(),
      },
    }
  }

  function restoredConfigCall() {
    return pveFetchMock.mock.calls.find(
      (c) => String(c[1]).endsWith("/qemu/111/config") && c[2]?.method === "PUT",
    )
  }

  it("iaas: restores an archive whose config carries a stale-QoS scsi0 on a policied storage -- restamp PUT captured with the policy caps", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-x")
    getInfraMock.mockResolvedValue(iaasScope(["ceph-nvme"], { "ceph-nvme": gold }))
    resolveVdcForTenantMock.mockResolvedValue({ vdcId: "vdc-1", poolName: "pool-1", quota: null })
    pveFetchMock.mockImplementation(async (_conn: any, path: string, opts?: any) => {
      if (opts?.method === "POST") return "UPID:pve-1:00000000:00000000:00000000:qmrestore:111:root@pam:"
      if (opts?.method === "PUT") return null
      if (String(path).endsWith("/qemu/111/config")) {
        return { scsi0: "ceph-nvme:vm-111-disk-0,size=32G,iops_rd=1" }
      }
      return {}
    })

    const { POST } = await import("./route")
    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: "ceph-nvme:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst", type: "qemu" },
    })
    expect(res.status).toBe(200)

    expect(afterCbs.length).toBeGreaterThan(0)
    for (const cb of afterCbs) await cb()

    const putCall = restoredConfigCall()
    expect(putCall).toBeTruthy()
    const patch = new URLSearchParams(String(putCall?.[2]?.body))
    expect(patch.get("scsi0")).toBe("ceph-nvme:vm-111-disk-0,size=32G,iops_rd=5000,iops_wr=4000,mbps_rd=500")
  })

  it("no policies on the connection: no restamp PUT", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-x")
    getInfraMock.mockResolvedValue(iaasScope(["ceph-nvme"]))
    resolveVdcForTenantMock.mockResolvedValue({ vdcId: "vdc-1", poolName: "pool-1", quota: null })
    pveFetchMock.mockImplementation(async (_conn: any, path: string, opts?: any) => {
      if (opts?.method === "POST") return "UPID:pve-1:00000000:00000000:00000000:qmrestore:111:root@pam:"
      if (opts?.method === "PUT") return null
      if (String(path).endsWith("/qemu/111/config")) {
        return { scsi0: "ceph-nvme:vm-111-disk-0,size=32G" }
      }
      return {}
    })

    const { POST } = await import("./route")
    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: "ceph-nvme:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst", type: "qemu" },
    })
    expect(res.status).toBe(200)

    for (const cb of afterCbs) await cb()

    expect(restoredConfigCall()).toBeUndefined()
  })

  it("provider: unchanged, no restamp attempted", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    getInfraMock.mockResolvedValue({ kind: "provider" })
    pveFetchMock.mockImplementation(async (_conn: any, path: string, opts?: any) => {
      if (opts?.method === "POST") return "UPID:pve-1:00000000:00000000:00000000:qmrestore:111:root@pam:"
      if (opts?.method === "PUT") return null
      if (String(path).endsWith("/qemu/111/config")) {
        return { scsi0: "local-lvm:vm-111-disk-0,size=32G,iops_rd=1" }
      }
      return {}
    })

    const { POST } = await import("./route")
    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_QEMU_VOLID, type: "qemu" },
    })
    expect(res.status).toBe(200)

    for (const cb of afterCbs) await cb()

    expect(restoredConfigCall()).toBeUndefined()
  })
})

describe("POST /api/v1/connections/[id]/nodes/[node]/restore -- read-only ISO library target (#894)", () => {
  function libraryScope() {
    return {
      kind: "iaas",
      vdcScope: {
        connectionIds: new Set(["pve-1"]),
        pbsConnectionIds: new Set<string>(),
        nodesByConnection: new Map<string, Set<string>>(),
        // `local` is visible (the archive lives there) AND writable, `isolib`
        // is visible only as an ISO library.
        storagesByConnection: new Map([["pve-1", new Set(["local", "ceph-vdc", "isolib"])]]),
        writableStoragesByConnection: new Map([["pve-1", new Set(["local", "ceph-vdc"])]]),
        isoLibrariesByConnection: new Map([["pve-1", new Set(["isolib"])]]),
        uploadLibrariesByConnection: new Map([["pve-1", new Set<string>()]]),
        storagePoliciesByConnection: new Map<string, Map<string, any>>(),
        poolsByConnection: new Map<string, Set<string>>(),
        vnetsByConnection: new Map<string, Set<string>>(),
        sharedBridgesByConnection: new Map<string, Set<string>>(),
        pbsNamespacesByConnection: new Map<string, Array<{ datastore: string; namespace: string }>>(),
        pbsNamespacesByPveConnection: new Map<string, Set<string>>(),
      },
    }
  }

  it("iaas tenant: restoring onto a library storage is refused, no PVE call emitted", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-x")
    getInfraMock.mockResolvedValue(libraryScope())
    resolveVdcForTenantMock.mockResolvedValue({ vdcId: "vdc-1", poolName: "pool-1", quota: null })

    const { POST } = await import("./route")
    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_QEMU_VOLID, type: "qemu", storage: "isolib" },
    })

    expect(res.status).toBe(403)
    const json = await readJson<{ error: string }>(res)
    expect(json?.error).toMatch(/read-only ISO library/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("iaas tenant: the archive may still be READ from a visible storage while the target is writable", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-x")
    getInfraMock.mockResolvedValue(libraryScope())
    resolveVdcForTenantMock.mockResolvedValue({ vdcId: "vdc-1", poolName: "pool-1", quota: null })

    const { POST } = await import("./route")
    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_QEMU_VOLID, type: "qemu", storage: "ceph-vdc" },
    })

    expect(res.status).not.toBe(403)
  })
})

describe("POST restore -- restoreTags option (#965)", () => {
  const PBS_VOLID = "pbs:backup/vm/111/2026-10-14T07:26:09Z"

  it("keeps PVE's behaviour when restoreTags is absent or true: no tags override", async () => {
    const { POST } = await import("./route")

    for (const extra of [{}, { restoreTags: true }]) {
      pveFetchMock.mockClear()
      const res = await callRoute(POST, {
        method: "POST",
        params: { id: "pve-1", node: "node1" },
        body: { vmid: 111, archive: PBS_VOLID, type: "qemu", ...extra },
      })
      expect(res.status).toBe(200)
      expect(postedParams(pveFetchMock.mock.calls[0]).has("tags")).toBe(false)
    }
  })

  it("qemu: restoreTags=false sends an empty tags override with the restore itself, start and live-restore included", async () => {
    const { POST } = await import("./route")

    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: PBS_VOLID, type: "qemu", restoreTags: false, start: true, live: true },
    })

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    const params = postedParams(pveFetchMock.mock.calls[0])
    expect(params.has("tags")).toBe(true)
    expect(params.get("tags")).toBe("")
    expect(params.get("start")).toBe("1")
    expect(params.get("live-restore")).toBe("1")
  })

  it("lxc: restoreTags=false sends the same override on the pct restore", async () => {
    const { POST } = await import("./route")

    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_LXC_VOLID, type: "lxc", storage: "local-lvm", restoreTags: false },
    })

    expect(res.status).toBe(200)
    const call = pveFetchMock.mock.calls[0]
    expect(call[1]).toBe("/nodes/node1/lxc")
    expect(postedParams(call).get("tags")).toBe("")
  })

  it("does not take a truthy non-boolean as an opt-out", async () => {
    const { POST } = await import("./route")

    await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: PBS_VOLID, type: "qemu", restoreTags: "false" },
    })

    expect(postedParams(pveFetchMock.mock.calls[0]).has("tags")).toBe(false)
  })

  it("after the task, removes the blank tags line the override leaves", async () => {
    const { POST } = await import("./route")
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string, opts?: { method?: string }) => {
      if (path === "/nodes/node1/lxc") return "UPID:x"
      if (path === "/nodes/node1/lxc/111/config" && !opts?.method) return { hostname: "ct", tags: " " }
      return null
    })

    await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_LXC_VOLID, type: "lxc", storage: "local-lvm", restoreTags: false },
    })
    expect(afterCbs).toHaveLength(1)
    await afterCbs[0]()

    const put = pveFetchMock.mock.calls.find(c => c[1] === "/nodes/node1/lxc/111/config" && c[2]?.method === "PUT")
    expect(put).toBeTruthy()
    expect(postedParams(put!).get("delete")).toBe("tags")
  })

  it("still cleans up when the task ended in warnings, and leaves the guest alone when tags were kept", async () => {
    const { POST } = await import("./route")
    waitForTaskMock.mockRejectedValueOnce(new Error("PVE task failed: WARNINGS: 1"))
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string, opts?: { method?: string }) => {
      if (path === "/nodes/node1/qemu") return "UPID:x"
      if (path === "/nodes/node1/qemu/111/config" && !opts?.method) return { name: "vm" }
      return null
    })

    await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: PBS_VOLID, type: "qemu", restoreTags: false },
    })
    await afterCbs[0]()

    // No tags line at all: nothing to delete, and the failed task stops the rest.
    expect(pveFetchMock.mock.calls.some(c => c[2]?.method === "PUT")).toBe(false)
    expect(syncIpamForVmConfigMock).not.toHaveBeenCalled()
  })

  it("never touches the restored config's tags when the option is left on", async () => {
    const { POST } = await import("./route")
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string, opts?: { method?: string }) => {
      if (path === "/nodes/node1/qemu") return "UPID:x"
      if (path === "/nodes/node1/qemu/111/config" && !opts?.method) return { name: "vm", tags: "prod;proxcenter-replica" }
      return null
    })

    await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: PBS_VOLID, type: "qemu" },
    })
    await afterCbs[0]()

    expect(pveFetchMock.mock.calls.some(c => c[2]?.method === "PUT")).toBe(false)
  })
})

describe("POST restore -- container on the default storage (#965 follow-up)", () => {
  // pct restore without `storage` puts every volume on 'local', which on most
  // clusters cannot hold containers: the route resolves the backup's own
  // rootfs storage instead, or refuses before calling PVE.
  function lxcLab(opts: { config?: string | Error; rootdir?: string[] } = {}) {
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => {
      if (path.includes("/vzdump/extractconfig")) {
        if (opts.config instanceof Error) throw opts.config
        return opts.config ?? "arch: amd64\nrootfs: CephStoragePool:vm-111-disk-0,size=2G\ntags: a;b\n"
      }
      if (path.includes("/storage?content=rootdir")) return (opts.rootdir ?? ["ZFS-Pool", "CephStoragePool"]).map(storage => ({ storage }))
      if (path === "/nodes/node1/lxc") return "UPID:x"
      return null
    })
  }
  const restoreCall = () => pveFetchMock.mock.calls.find(c => c[1] === "/nodes/node1/lxc")

  it("restores the container on the storage its backup came from", async () => {
    const { POST } = await import("./route")
    lxcLab()

    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_LXC_VOLID, type: "lxc" },
    })

    expect(res.status).toBe(200)
    const extract = pveFetchMock.mock.calls.find(c => String(c[1]).includes("extractconfig"))
    expect(extract?.[1]).toBe(`/nodes/node1/vzdump/extractconfig?volume=${encodeURIComponent(VZDUMP_LXC_VOLID)}`)
    expect(postedParams(restoreCall()!).get("storage")).toBe("CephStoragePool")
  })

  it("refuses, without calling PVE, when that storage cannot hold containers on the target node", async () => {
    const { POST } = await import("./route")
    lxcLab({ rootdir: ["ZFS-Pool"] })

    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_LXC_VOLID, type: "lxc" },
    })

    expect(res.status).toBe(400)
    expect((await readJson<{ error: string }>(res))?.error).toMatch(/Choose a target storage: "CephStoragePool"/)
    expect(restoreCall()).toBeUndefined()
  })

  it("refuses when the backed-up config cannot be read or has no volume rootfs", async () => {
    const { POST } = await import("./route")
    vi.spyOn(console, "error").mockImplementation(() => {})

    for (const config of [new Error("500"), "arch: amd64\nrootfs: /srv/ct,size=0T\n", "arch: amd64\n"]) {
      pveFetchMock.mockReset()
      lxcLab({ config })
      const res = await callRoute(POST, {
        method: "POST",
        params: { id: "pve-1", node: "node1" },
        body: { vmid: 111, archive: VZDUMP_LXC_VOLID, type: "lxc" },
      })
      expect(res.status).toBe(400)
      expect((await readJson<{ error: string }>(res))?.error).toMatch(/could not be determined/)
      expect(restoreCall()).toBeUndefined()
    }
  })

  it("keeps an explicit target and never resolves anything for a VM", async () => {
    const { POST } = await import("./route")
    lxcLab()

    await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_LXC_VOLID, type: "lxc", storage: "ZFS-Pool" },
    })
    expect(postedParams(restoreCall()!).get("storage")).toBe("ZFS-Pool")

    pveFetchMock.mockClear()
    await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_QEMU_VOLID, type: "qemu" },
    })
    expect(pveFetchMock.mock.calls.some(c => String(c[1]).includes("extractconfig"))).toBe(false)
  })

  it("judges a tenant restore on the resolved storage", async () => {
    getCurrentTenantIdMock.mockResolvedValue("tenant-x")
    resolveVdcForTenantMock.mockResolvedValue({ id: "vdc-1" })
    getInfraMock.mockResolvedValue({
      kind: "iaas",
      vdcScope: {
        connectionIds: new Set(["pve-1"]),
        storagesByConnection: new Map([["pve-1", new Set(["local"])]]),
        storagePoliciesByConnection: new Map(),
      },
    })
    const { POST } = await import("./route")
    lxcLab()

    const res = await callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_LXC_VOLID, type: "lxc" },
    })

    expect(res.status).toBe(403)
    expect((await readJson<{ error: string }>(res))?.error).toMatch(/CephStoragePool/)
    expect(restoreCall()).toBeUndefined()
  })
})

// Spec 6.4: a restore needs backup.restore, and `force` overwrites (destroys)
// an existing guest, so it also needs vm.delete on that guest, judged on the
// node it actually lives on.
describe("POST restore -- backup.restore and the guest that force overwrites", () => {
  const RESTORE_UPID = "UPID:pve-1:00000000:00000000:00000000:qmrestore:111:root@pam:"

  /** Grant exactly the listed permissions, deny everything else. */
  function grantOnly(...perms: string[]) {
    checkPermissionMock.mockImplementation(async (perm: string) =>
      perms.includes(perm) ? null : new Response(JSON.stringify({ error: `Permission denied: ${perm}` }), { status: 403 }))
  }

  /** /cluster/resources answers `guests`; anything else is the restore POST. */
  function wireGuests(guests: unknown) {
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string) =>
      path === "/cluster/resources?type=vm" ? guests : RESTORE_UPID)
  }

  const restorePosts = () => pveFetchMock.mock.calls.filter(c => c[1] === "/nodes/node1/qemu")

  async function restore(body: Record<string, unknown>) {
    const { POST } = await import("./route")
    return callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_QEMU_VOLID, type: "qemu", ...body },
    })
  }

  it("403 without backup.restore, even with vm.backup", async () => {
    grantOnly("vm.backup")

    const res = await restore({})

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith("backup.restore", "node", "pve-1:node1")
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("restores with vm.backup and backup.restore, without looking the vmid up when force is off", async () => {
    grantOnly("vm.backup", "backup.restore")

    const res = await restore({})

    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalledTimes(1)
    expect(checkPermissionMock).not.toHaveBeenCalledWith("vm.delete", expect.anything(), expect.anything())
  })

  it("force on an existing vmid: 403 without vm.delete on that guest, nothing restored", async () => {
    grantOnly("vm.backup", "backup.restore")
    wireGuests([{ vmid: 111, node: "node2", type: "qemu", pool: "p1" }])

    const res = await restore({ force: true })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith("vm.delete", "vm", "pve-1:node2:qemu:111")
    expect(restorePosts()).toHaveLength(0)
  })

  it("force on an existing vmid: restores with force=1 when vm.delete is held", async () => {
    grantOnly("vm.backup", "backup.restore", "vm.delete")
    wireGuests([{ vmid: 110, node: "node1", type: "lxc" }, { vmid: 111, node: "node2", type: "qemu" }])

    const res = await restore({ force: true })

    expect(res.status).toBe(200)
    expect(restorePosts()).toHaveLength(1)
    expect(postedParams(restorePosts()[0]).get("force")).toBe("1")
  })

  it("force on a free vmid: nothing to overwrite, vm.delete is not required", async () => {
    grantOnly("vm.backup", "backup.restore")
    wireGuests([{ vmid: 110, node: "node1", type: "qemu" }])

    const res = await restore({ force: true })

    expect(res.status).toBe(200)
    expect(restorePosts()).toHaveLength(1)
  })

  it.each([
    ["the lookup throws", () => pveFetchMock.mockRejectedValue(new Error("ECONNREFUSED"))],
    ["the lookup is not a list", () => wireGuests({ data: null })],
  ])("force: 503 and nothing restored when %s", async (_label, wire) => {
    wire()

    const res = await restore({ force: true })

    expect(res.status).toBe(503)
    expect(restorePosts()).toHaveLength(0)
  })

  /** A vDC tenant whose vDC holds node1 and node2 and the pool "pool-1". */
  function iaasTenant() {
    getCurrentTenantIdMock.mockResolvedValue("tenant-x")
    getInfraMock.mockResolvedValue({
      kind: "iaas",
      vdcScope: {
        connectionIds: new Set(["pve-1"]),
        pbsConnectionIds: new Set<string>(),
        nodesByConnection: new Map([["pve-1", new Set(["node1", "node2"])]]),
        storagesByConnection: new Map([["pve-1", new Set(["local"])]]),
        writableStoragesByConnection: new Map([["pve-1", new Set(["local"])]]),
        storagePoliciesByConnection: new Map<string, Map<string, any>>(),
        poolsByConnection: new Map([["pve-1", new Set(["pool-1"])]]),
        vnetsByConnection: new Map<string, Set<string>>(),
        sharedBridgesByConnection: new Map<string, Set<string>>(),
        pbsNamespacesByConnection: new Map<string, Array<{ datastore: string; namespace: string }>>(),
        pbsNamespacesByPveConnection: new Map<string, Set<string>>(),
      },
    })
    resolveVdcForTenantMock.mockResolvedValue({ vdcId: "vdc-1", poolName: "pool-1", quota: null })
  }

  // Every caller of a vDC tenant (session or token) is judged on the guest
  // it would overwrite, not only on the node it restores to.
  it("iaas session with force on a guest outside its vDC: 403, nothing restored", async () => {
    iaasTenant()
    wireGuests([{ vmid: 111, node: "node2", type: "qemu", pool: "other-tenant-pool" }])

    const res = await restore({ force: true })

    expect(res.status).toBe(403)
    expect((await readJson<{ error: string }>(res))?.error).toMatch(/outside your vDC/i)
    expect(restorePosts()).toHaveLength(0)
  })

  it("iaas session with force on its own vDC guest goes through", async () => {
    iaasTenant()
    wireGuests([{ vmid: 111, node: "node2", type: "qemu", pool: "pool-1" }])

    const res = await restore({ force: true })

    expect(res.status).toBe(200)
    expect(restorePosts()).toHaveLength(1)
  })

  it("provider with force on an existing guest: the vDC guest check is a no-op", async () => {
    wireGuests([{ vmid: 111, node: "node2", type: "qemu" }])

    const res = await restore({ force: true })

    expect(res.status).toBe(200)
    // One lookup for the vm.delete target; the vDC check makes none for a provider.
    expect(pveFetchMock.mock.calls.filter(c => c[1] === "/cluster/resources?type=vm")).toHaveLength(1)
  })
})

describe("POST restore -- API token and the nested PBS source", () => {
  const token = { kind: "token", tokenId: "tok-1", tenantId: "default", connectionIds: ["pve-1", "pbs-in"] }
  const pbsBody = (pbsId: string) => ({
    vmid: 111, type: "qemu", pbsBackup: { pbsId, datastore: "ds1", backupPath: "backup/vm/111/2026-08-11T15:51:33Z" },
  })
  const call = async (body: object, principal?: object) => {
    const { POST } = await import("./route")
    const req = new Request("http://test.local/_", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })
    return POST(req, { params: Promise.resolve({ id: "pve-1", node: "node1" }), ...(principal ? { principal } : {}) } as any)
  }

  beforeEach(async () => {
    resolveVisibleMock.mockReset().mockResolvedValue(new Set(["pve-1", "pbs-in"]))
    const { prisma } = await import("@/lib/db/prisma")
    vi.mocked(prisma.connection.findUnique).mockReset().mockResolvedValue(null as any)
  })

  it("refuses a pbsId outside the token perimeter before touching the PBS connection", async () => {
    const res = await call(pbsBody("pbs-out"), token)

    expect(res.status).toBe(403)
    expect(await readJson(res)).toEqual({ error: "Connection not in token scope", connection: "pbs-out" })
    expect(resolveVisibleMock).toHaveBeenCalledWith(token)
    const { prisma } = await import("@/lib/db/prisma")
    expect(prisma.connection.findUnique).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("lets a pbsId inside the perimeter through, and never consults it for a session", async () => {
    const { prisma } = await import("@/lib/db/prisma")
    expect((await call(pbsBody("pbs-in"), token)).status).toBe(404)
    expect(prisma.connection.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pbs-in" } }))

    resolveVisibleMock.mockClear()
    expect((await call(pbsBody("pbs-out"))).status).toBe(404)
    expect(resolveVisibleMock).not.toHaveBeenCalled()
  })
})

// The PVE storage that reads the PBS backup is found by what it points at,
// never by its ID (ui#1308): an operator names a `pbs` storage as they like,
// and may declare the server by FQDN on one side and by IP on the other.
describe("POST restore -- PVE storage resolved from the PBS coordinates (ui#1308)", () => {
  const FP = "17:44:52:4E:99:EA:D8:04:7E:15:CB:EA:F3:7D:43:56:8F:23:D2:D7:B2:43:26:F4:E6:13:C8:9C:4A:E4:AC:21"
  const OTHER_FP = "AA:44:52:4E:99:EA:D8:04:7E:15:CB:EA:F3:7D:43:56:8F:23:D2:D7:B2:43:26:F4:E6:13:C8:9C:4A:E4:AC:21"
  const body = {
    vmid: 91318, type: "qemu", storage: "ceph",
    pbsBackup: { pbsId: "pbs-1", datastore: "test-vdc", namespace: "", backupPath: "backup/vm/91308/2026-11-07T16:10:01Z" },
  }
  const call = async () => {
    const { POST } = await import("./route")
    const req = new Request("http://test.local/_", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } })
    return POST(req, { params: Promise.resolve({ id: "pve-1", node: "node1" }) } as any)
  }
  const withStorages = (configs: Record<string, object>) => {
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string) => {
      if (path.startsWith("/nodes/node1/storage")) return Object.keys(configs).map(storage => ({ storage, type: "pbs" }))
      const m = /^\/storage\/(.+)$/.exec(path)
      if (m) return { type: "pbs", ...configs[decodeURIComponent(m[1])] }
      return "UPID:node1:00000000:00000000:00000000:qmrestore:91318:root@pam:"
    })
  }
  const postedArchive = () => {
    const post = pveFetchMock.mock.calls.find(c => c[1] === "/nodes/node1/qemu")
    return post ? postedParams(post).get("archive") : undefined
  }

  beforeEach(async () => {
    const { prisma } = await import("@/lib/db/prisma")
    vi.mocked(prisma.connection.findUnique).mockReset().mockResolvedValue({ baseUrl: "https://10.42.0.201:8007", fingerprint: FP } as any)
  })

  it("restores through a storage whose ID differs from the datastore name", async () => {
    withStorages({ "SZ-PBS-Backup": { server: "10.42.0.201", datastore: "test-vdc" } })

    expect((await call()).status).toBe(200)
    expect(postedArchive()).toBe("SZ-PBS-Backup:backup/vm/91308/2026-11-07T16:10:01Z")
  })

  it("joins a storage declared by FQDN to a connection declared by IP through the pinned fingerprint", async () => {
    withStorages({
      "pbs-elsewhere": { server: "pbs.other.lan", datastore: "test-vdc", fingerprint: OTHER_FP },
      "WH-PBS-Store": { server: "pbs.test.com", datastore: "test-vdc", fingerprint: FP.toLowerCase() },
    })

    expect((await call()).status).toBe(200)
    expect(postedArchive()).toBe("WH-PBS-Store:backup/vm/91308/2026-11-07T16:10:01Z")
  })

  it("409 naming what has to match when no storage reaches this server, and nothing is restored", async () => {
    withStorages({ "pbs-elsewhere": { server: "pbs.other.lan", datastore: "test-vdc", fingerprint: OTHER_FP } })

    const res = await call()
    expect(res.status).toBe(409)
    const { error } = (await readJson<{ error: string }>(res))!
    expect(error).toContain('No PBS storage on node "node1" reaches this backup server with datastore "test-vdc"')
    expect(error).toContain("The storage ID can be any name")
    expect(postedArchive()).toBeUndefined()
  })
})

// A restored VM holds the GPUs of its backed-up config (#672): for a vDC
// tenant they draw on the contingent, under the vDC lock, and stay reserved
// until the restore task ends.
describe("POST restore -- vDC GPU contingent", () => {
  const RESTORE_UPID = "UPID:pve-1:00000000:00000000:00000000:qmrestore:111:root@pam:"
  const q12 = { kind: "vgpu", modelKey: "0x10de:0x2231", profileName: "RTXA5000-12Q" }
  const gpuArchive = { hostpci0: "mapping=vgpu-n1-03-00,mdev=nvidia-665" }

  function vdcTenant() {
    getCurrentTenantIdMock.mockResolvedValue("tenant-x")
    getInfraMock.mockResolvedValue({
      kind: "iaas",
      vdcScope: {
        connectionIds: new Set(["pve-1"]),
        pbsConnectionIds: new Set<string>(),
        nodesByConnection: new Map([["pve-1", new Set(["node1"])]]),
        storagesByConnection: new Map([["pve-1", new Set(["local"])]]),
        writableStoragesByConnection: new Map([["pve-1", new Set(["local"])]]),
        storagePoliciesByConnection: new Map<string, Map<string, any>>(),
        poolsByConnection: new Map([["pve-1", new Set(["pool-1"])]]),
        vnetsByConnection: new Map<string, Set<string>>(),
        sharedBridgesByConnection: new Map<string, Set<string>>(),
        pbsNamespacesByConnection: new Map<string, Array<{ datastore: string; namespace: string }>>(),
        pbsNamespacesByPveConnection: new Map<string, Set<string>>(),
      },
    })
    resolveVdcForTenantMock.mockResolvedValue({ vdcId: "vdc-1", poolName: "pool-1", quota: null })
    vdcFindFirstMock.mockResolvedValue({ id: "vdc-1", pvePoolName: "pool-1" })
    pveFetchMock.mockImplementation(async (_conn: unknown, path: string) =>
      path === "/cluster/resources?type=vm" ? [{ vmid: 111, node: "node1", type: "qemu", pool: "pool-1" }] : RESTORE_UPID)
  }

  const restorePosts = () => pveFetchMock.mock.calls.filter(c => c[1] === "/nodes/node1/qemu")

  async function restore(body: Record<string, unknown> = {}) {
    const { POST } = await import("./route")
    return callRoute(POST, {
      method: "POST",
      params: { id: "pve-1", node: "node1" },
      body: { vmid: 111, archive: VZDUMP_QEMU_VOLID, type: "qemu", ...body },
    })
  }

  it("409 quota_exhausted: the archive holds a vGPU its line has no room for", async () => {
    vdcTenant()
    archiveGpuConfigMock.mockResolvedValue(gpuArchive)
    restoreContingentCheckMock.mockResolvedValue({ ok: false, code: "quota_exhausted", used: 2, count: 2 })

    const res = await restore()

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: "quota_exhausted", used: 2, count: 2 })
    expect(archiveGpuConfigMock).toHaveBeenCalledWith(expect.anything(), "node1", VZDUMP_QEMU_VOLID)
    expect(restoreContingentCheckMock).toHaveBeenCalledWith("vdc-1", "pve-1", "pool-1", "node1", gpuArchive, null)
    expect(restorePosts()).toHaveLength(0)
  })

  it("over the VM that holds that vGPU: judged without it, restored, the vGPU held until the task ends", async () => {
    vdcTenant()
    archiveGpuConfigMock.mockResolvedValue(gpuArchive)
    restoreContingentCheckMock.mockResolvedValue({ ok: true, demand: [q12] })

    const res = await restore({ force: true })

    expect(res.status).toBe(200)
    expect(restoreContingentCheckMock).toHaveBeenCalledWith("vdc-1", "pve-1", "pool-1", "node1", gpuArchive, "111")
    expect(restorePosts()).toHaveLength(1)
    expect(pendingVdcGpus("vdc-1")).toEqual([{ vmid: "111", demand: [q12] }])
    for (const cb of afterCbs) await cb()
    expect(waitForTaskStoppedMock).toHaveBeenCalledWith(expect.anything(), "pve-1", RESTORE_UPID, expect.objectContaining({ timeoutMs: expect.any(Number) }))
    expect(pendingVdcGpus("vdc-1")).toEqual([])
  })

  it("a restore task whose end was not seen (timeout, polls failing) keeps the vGPU reserved", async () => {
    vdcTenant()
    archiveGpuConfigMock.mockResolvedValue(gpuArchive)
    restoreContingentCheckMock.mockResolvedValue({ ok: true, demand: [q12] })
    waitForTaskMock.mockRejectedValue(new Error("PVE task timed out after 600s"))
    waitForTaskStoppedMock.mockResolvedValue({ stopped: false })

    expect((await restore()).status).toBe(200)
    for (const cb of afterCbs) await cb()

    expect(pendingVdcGpus("vdc-1")).toHaveLength(1)
  })

  it("two vDCs on the node: judged on the contingent of the vDC whose pool receives the VM", async () => {
    vdcTenant()
    vdcFindFirstMock.mockResolvedValue({ id: "vdc-2", pvePoolName: "pool-2" })
    archiveGpuConfigMock.mockResolvedValue(gpuArchive)
    restoreContingentCheckMock.mockResolvedValue({ ok: true, demand: [q12] })

    expect((await restore()).status).toBe(200)
    expect(restoreContingentCheckMock).toHaveBeenCalledWith("vdc-2", "pve-1", "pool-2", "node1", gpuArchive, null)
    expect(pendingVdcGpus("vdc-2")).toHaveLength(1)
    for (const cb of afterCbs) await cb()
    expect(pveFetchMock.mock.calls.some(c => c[1] === "/pools/pool-2" && c[2]?.method === "PUT")).toBe(true)
  })

  it("503 gpu_check_unavailable when the contingent cannot be checked now", async () => {
    vdcTenant()
    archiveGpuConfigMock.mockResolvedValue(gpuArchive)
    restoreContingentCheckMock.mockResolvedValue({ ok: false, code: "gpu_check_unavailable" })

    const res = await restore()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "gpu_check_unavailable" })
    expect(restorePosts()).toHaveLength(0)
  })

  it("503 gpu_check_unavailable when no vDC pool would receive a VM holding GPUs", async () => {
    vdcTenant()
    vdcFindFirstMock.mockResolvedValue(null)
    archiveGpuConfigMock.mockResolvedValue(gpuArchive)

    const res = await restore()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "gpu_check_unavailable" })
    expect(restoreContingentCheckMock).not.toHaveBeenCalled()
    expect(restorePosts()).toHaveLength(0)
  })

  it("an archive without GPU is restored after the one config read", async () => {
    vdcTenant()

    const res = await restore()

    expect(res.status).toBe(200)
    expect(archiveGpuConfigMock).toHaveBeenCalledTimes(1)
    expect(restoreContingentCheckMock).not.toHaveBeenCalled()
    expect(restorePosts()).toHaveLength(1)
  })

  it("503 gpu_check_unavailable when the backed-up config cannot be read", async () => {
    vdcTenant()
    archiveGpuConfigMock.mockResolvedValue(null)

    const res = await restore()

    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: "gpu_check_unavailable" })
    expect(restorePosts()).toHaveLength(0)
  })

  it("the provider and a container restore never read the backed-up config", async () => {
    pveFetchMock.mockResolvedValue(RESTORE_UPID)
    expect((await restore()).status).toBe(200)
    vdcTenant()
    archiveGpuConfigMock.mockClear()
    await restore({ archive: VZDUMP_LXC_VOLID, type: "lxc", storage: "local" })
    expect(archiveGpuConfigMock).not.toHaveBeenCalled()
  })
})
