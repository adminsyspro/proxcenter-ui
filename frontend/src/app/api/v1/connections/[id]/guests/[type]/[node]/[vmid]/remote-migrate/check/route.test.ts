import { beforeEach, describe, expect, it, vi } from "vitest"

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock("@/lib/api-tokens/routeGuard", () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute } from "@/__tests__/setup/route-test"

const { checkPermissionMock, getConnectionByIdMock, pveFetchMock, getInfraMock, guardSessionGuestMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  getInfraMock: vi.fn(),
  guardSessionGuestMock: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}/${node}/${type}/${vmid}`,
  PERMISSIONS: { VM_MIGRATE: "vm.migrate" },
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => getConnectionByIdMock(...a),
}))
vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...a: any[]) => pveFetchMock(...a),
}))
// The tenant guards of the sibling POST routes: a provider session by default,
// so the pre-flight tests below keep exercising the checks themselves.
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: async () => "default" }))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))
vi.mock("@/lib/vdc/guestGuard", () => ({ guardSessionGuest: (...a: any[]) => guardSessionGuestMock(...a) }))
const { sshReadyMock } = vi.hoisted(() => ({ sshReadyMock: vi.fn() }))
vi.mock("@/lib/migration/sharedHandover/server", async (orig) => ({
  ...(await orig<typeof import("@/lib/migration/sharedHandover/server")>()),
  sshReady: (...a: any[]) => sshReadyMock(...a),
}))

const PARAMS = { id: "conn-src", type: "qemu", node: "pve1", vmid: "100" }
const BODY = { targetConnectionId: "conn-tgt", targetNode: "pve2", targetStorage: "local-lvm", targetBridge: "vmbr0" }

// Route pveFetch responses by path substring. `snapshotResult` is per-test.
function wirePveFetch(snapshotResult: any, prerequisites?: {
  replication?: any
  ha?: any[]
  rules?: any
}) {
  pveFetchMock.mockImplementation((_conn: any, path: string) => {
    if (path.includes("/snapshot")) {
      if (snapshotResult instanceof Error) return Promise.reject(snapshotResult)
      return Promise.resolve(snapshotResult)
    }
    if (path.endsWith("/config")) return Promise.resolve({})
    if (path.includes("/cluster/ha/resources")) return Promise.resolve(prerequisites?.ha || [])
    if (path === "/cluster/replication" || path === "/cluster/ha/rules") {
      const result = path === "/cluster/replication" ? prerequisites?.replication : prerequisites?.rules
      return result instanceof Error ? Promise.reject(result) : Promise.resolve(result || [])
    }
    if (prerequisites) {
      if (path === "/nodes") return Promise.resolve([{ node: BODY.targetNode, status: "online" }])
      if (path.endsWith("/storage")) return Promise.resolve([{ storage: BODY.targetStorage, content: "images" }])
      if (path.endsWith("/network")) return Promise.resolve([{ iface: BODY.targetBridge, type: "bridge" }])
    }
    // target-side checks: return benign empties so they don't crash
    return Promise.resolve([])
  })
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: "c", baseUrl: "https://x:8006", apiToken: "t" })
  pveFetchMock.mockReset()
  getInfraMock.mockReset().mockResolvedValue({ kind: "provider" })
  guardSessionGuestMock.mockReset().mockResolvedValue(null)
})

describe("POST .../remote-migrate/check — snapshot pre-flight", () => {
  it("flags a blocking SNAPSHOTS_PRESENT error when the VM has snapshots", async () => {
    wirePveFetch([{ name: "current" }, { name: "snap1" }, { name: "snap2" }])
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    const issue = json.issues.find((i: any) => i.code === "SNAPSHOTS_PRESENT")
    expect(issue).toBeDefined()
    expect(issue.type).toBe("error")
    expect(issue.message).toMatch(/2/) // count surfaced
    expect(json.valid).toBe(false)
  })

  it("does NOT flag when the VM has only the 'current' pseudo-snapshot", async () => {
    wirePveFetch([{ name: "current" }])
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.some((i: any) => i.code === "SNAPSHOTS_PRESENT")).toBe(false)
  })

  it("degrades to a SNAPSHOTS_CHECK_FAILED warning (not a block) when the snapshot fetch throws", async () => {
    wirePveFetch(new Error("boom"))
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    const issue = json.issues.find((i: any) => i.code === "SNAPSHOTS_CHECK_FAILED")
    expect(issue).toBeDefined()
    expect(issue.type).toBe("warning")
    expect(json.issues.some((i: any) => i.code === "SNAPSHOTS_PRESENT")).toBe(false)
  })
})

// Route pveFetch responses for the CPU-type-on-target check. `vmCpu` feeds the
// VM config, `targetCpus` the target node's /capabilities/qemu/cpu response.
function wireCpuPveFetch(opts: { vmCpu?: string; targetCpus?: any }) {
  pveFetchMock.mockImplementation((_conn: any, path: string) => {
    if (path.endsWith("/config")) return Promise.resolve(opts.vmCpu ? { cpu: opts.vmCpu } : {})
    if (path.includes("/capabilities/qemu/cpu")) {
      if (opts.targetCpus instanceof Error) return Promise.reject(opts.targetCpus)
      return Promise.resolve(opts.targetCpus)
    }
    if (path.includes("/snapshot")) return Promise.resolve([])
    if (path.includes("/cluster/ha/resources")) return Promise.resolve([])
    // Benign target-side data so no unrelated blocking issue pollutes `valid`.
    if (path === "/nodes") return Promise.resolve([{ node: BODY.targetNode, status: "online" }])
    if (path.endsWith("/storage")) return Promise.resolve([{ storage: BODY.targetStorage, content: "images", avail: 100 * 1024 * 1024 * 1024 }])
    if (path.endsWith("/network")) return Promise.resolve([{ iface: BODY.targetBridge, type: "bridge" }])
    return Promise.resolve([])
  })
}

describe("POST .../remote-migrate/check — CPU type availability on target", () => {
  it("flags a blocking CPU_TYPE_NOT_ON_TARGET error when a custom model is missing on the target", async () => {
    wireCpuPveFetch({
      vmCpu: "custom-migration-safe,flags=+aes",
      targetCpus: [{ name: "kvm64" }, { name: "x86-64-v2-AES" }],
    })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    const issue = json.issues.find((i: any) => i.code === "CPU_TYPE_NOT_ON_TARGET")
    expect(issue).toBeDefined()
    expect(issue.type).toBe("error")
    expect(issue.message).toContain("custom-migration-safe")
    expect(issue.details).toContain("cpu-models.conf")
    expect(json.valid).toBe(false)
  })

  it("does NOT flag when the custom model exists on the target", async () => {
    wireCpuPveFetch({
      vmCpu: "custom-migration-safe",
      targetCpus: [{ name: "kvm64" }, { name: "custom-migration-safe", custom: 1 }],
    })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.some((i: any) => i.code === "CPU_TYPE_NOT_ON_TARGET")).toBe(false)
  })

  it("flags a builtin CPU type absent from a non-empty capability list", async () => {
    wireCpuPveFetch({ vmCpu: "SapphireRapids", targetCpus: [{ name: "kvm64" }] })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    const issue = json.issues.find((i: any) => i.code === "CPU_TYPE_NOT_ON_TARGET")
    expect(issue).toBeDefined()
    expect(issue.type).toBe("error")
  })

  it("does NOT conclude anything from an empty capability list", async () => {
    wireCpuPveFetch({ vmCpu: "SapphireRapids", targetCpus: [] })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.some((i: any) => i.code === "CPU_TYPE_NOT_ON_TARGET")).toBe(false)
  })

  it("degrades to a CPU_TYPE_CHECK_FAILED warning (not a block) when the capability fetch throws", async () => {
    wireCpuPveFetch({ vmCpu: "custom-migration-safe", targetCpus: new Error("nope") })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    const issue = json.issues.find((i: any) => i.code === "CPU_TYPE_CHECK_FAILED")
    expect(issue).toBeDefined()
    expect(issue.type).toBe("warning")
    expect(json.issues.some((i: any) => i.code === "CPU_TYPE_NOT_ON_TARGET")).toBe(false)
    expect(json.valid).toBe(true)
  })

  it("does not apply the availability check to CPU type 'host' (CPU_HOST warning still fires)", async () => {
    wireCpuPveFetch({ vmCpu: "host", targetCpus: [] })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.some((i: any) => i.code === "CPU_TYPE_NOT_ON_TARGET")).toBe(false)
    const hostIssue = json.issues.find((i: any) => i.code === "CPU_HOST")
    expect(hostIssue).toBeDefined()
    expect(hostIssue.type).toBe("warning")
  })
})


describe("POST .../remote-migrate/check — replication pre-flight", () => {
  it("blocks matching replication jobs and supplies their remediation config", async () => {
    wirePveFetch([], { replication: [
      { id: "100-0", guest: 100, target: "pve3", schedule: "*/15", remove_job: "full" },
      { id: "101-0", guest: 101, target: "pve4" },
    ] })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.valid).toBe(false)
    expect(json.issues.find((i: any) => i.code === "REPLICATION_CONFIGURED")).toMatchObject({
      type: "error",
      remediation: { kind: "replication", reversible: true, jobs: [{ id: "100-0", target: "pve3", schedule: "*/15" }] },
    })
  })

  it("ignores jobs belonging only to other guests", async () => {
    wirePveFetch([], { replication: [{ id: "101-0", guest: 101, target: "pve3" }] })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.some((i: any) => i.code === "REPLICATION_CONFIGURED")).toBe(false)
    expect(json.valid).toBe(true)
  })

  it("warns without blocking when replication cannot be read", async () => {
    wirePveFetch([], { replication: new Error("PVE unavailable") })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.find((i: any) => i.code === "REPLICATION_CHECK_FAILED")).toMatchObject({
      type: "warning", details: "PVE unavailable",
    })
    expect(json.issues.some((i: any) => i.code === "REPLICATION_CONFIGURED")).toBe(false)
    expect(json.valid).toBe(true)
  })

  it("keeps other blockers when the replication read fails", async () => {
    wirePveFetch([{ name: "snap1" }], { replication: new Error("PVE unavailable") })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.valid).toBe(false)
    expect(json.issues.find((i: any) => i.code === "REPLICATION_CHECK_FAILED").type).toBe("warning")
    expect(json.issues.find((i: any) => i.code === "SNAPSHOTS_PRESENT").type).toBe("error")
  })

  it("attaches the HA sid, state, and group to the HA blocker", async () => {
    wirePveFetch([], { ha: [{ sid: "vm:100", state: "started", group: "source-ha" }] })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.find((i: any) => i.code === "HA_ENABLED")).toMatchObject({
      type: "error", remediation: { kind: "ha", sid: "vm:100", state: "started", group: "source-ha", reversible: true },
    })
  })

  it("warns about source HA rules that name the guest", async () => {
    wirePveFetch([], {
      ha: [{ sid: "vm:100" }],
      rules: [{ rule: "source-affinity", resources: "vm:100, vm:101" }],
    })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.find((i: any) => i.code === "HA_RULES_NOT_PORTABLE")).toMatchObject({
      type: "warning", details: expect.stringContaining("source-affinity"),
    })
    expect(json.summary.errors).toBe(1)
  })

  it.each([[], new Error("PVE 8 endpoint 404")])("does not warn for unavailable or empty HA rules: %s", async rules => {
    wirePveFetch([], { ha: [{ sid: "vm:100" }], rules })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.some((i: any) => i.code === "HA_RULES_NOT_PORTABLE")).toBe(false)
    expect(json.issues.some((i: any) => i.code === "HA_ENABLED")).toBe(true)
  })

  it("sends the values behind a warning, not just its English sentence", async () => {
    // The dialog shows a check as `label · values`, so a sentence that repeats
    // its own label ("VMID" + "VMID 100 already exists...") reads twice and
    // stays English whatever the locale. The route carries the values.
    wirePveFetch([], { ha: [] })
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path.endsWith("/config")) return Promise.resolve({})
      if (path === "/nodes") return Promise.resolve([{ node: BODY.targetNode, status: "online" }])
      if (path.endsWith("/storage")) return Promise.resolve([{ storage: BODY.targetStorage, content: "images" }])
      if (path.endsWith("/network")) return Promise.resolve([{ iface: BODY.targetBridge, type: "bridge" }])
      if (path.includes("/cluster/resources")) return Promise.resolve([{ vmid: 100, node: "pve2", name: "clone" }])

      return Promise.resolve([])
    })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.find((i: any) => i.code === "VMID_EXISTS_ON_TARGET")).toMatchObject({
      type: "warning",
      context: { vmid: "100", node: "pve2" },
      message: expect.stringContaining("already exists"),
    })
  })

  it("checks the overridden target VMID instead of the source one", async () => {
    wirePveFetch([], { ha: [] })
    const base = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation((conn: any, path: string) =>
      path.includes("/cluster/resources") ? Promise.resolve([{ vmid: 100, node: "pve2" }, { vmid: 250, node: "pve3" }]) : base(conn, path))
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]

    const free = await (await callRoute(POST, { method: "POST", params: PARAMS, body: { ...BODY, targetVmid: 300 } })).json()
    expect(free.issues.some((i: any) => i.code === "VMID_EXISTS_ON_TARGET")).toBe(false)

    const taken = await (await callRoute(POST, { method: "POST", params: PARAMS, body: { ...BODY, targetVmid: 250 } })).json()
    expect(taken.issues.find((i: any) => i.code === "VMID_EXISTS_ON_TARGET")?.context).toEqual({ vmid: "250", node: "pve3" })

    const junk = await (await callRoute(POST, { method: "POST", params: PARAMS, body: { ...BODY, targetVmid: "abc" } })).json()
    expect(junk.issues.find((i: any) => i.code === "VMID_EXISTS_ON_TARGET")?.context).toEqual({ vmid: "100", node: "pve2" })
  })

  it("names only real snapshots in the irreversible remediation", async () => {
    wirePveFetch([{ name: "current" }, { name: "before-upgrade" }, { name: "backup" }], {})
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })
    const json = await res.json()
    expect(json.issues.find((i: any) => i.code === "SNAPSHOTS_PRESENT").remediation).toEqual({
      kind: "snapshots", names: ["before-upgrade", "backup"], reversible: false,
    })
  })
})

describe("POST .../remote-migrate/check tenant guards", () => {
  const post = async (params = PARAMS, body: any = BODY) => {
    wirePveFetch([], {})
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    return callRoute(POST, { method: "POST", params, body })
  }

  it("refuses malformed node names and vmids before any permission or Proxmox call", async () => {
    expect((await post({ ...PARAMS, node: "pve1;x" })).status).toBe(400)
    expect((await post({ ...PARAMS, vmid: "100 or 1" })).status).toBe(400)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("refuses a malformed target node name before any Proxmox call", async () => {
    expect((await post(PARAMS, { ...BODY, targetNode: "pve2/../x" })).status).toBe(400)
    expect((await post(PARAMS, { ...BODY, targetConnectionId: 42 })).status).toBe(400)
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it("checks vm.migrate on the target connection too, and stops there when it is denied", async () => {
    checkPermissionMock.mockImplementation(async (_perm: string, scope: string, target: string) =>
      scope === "connection" && target === BODY.targetConnectionId ? new Response("{}", { status: 403 }) : null)
    const res = await post()
    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith("vm.migrate", "connection", BODY.targetConnectionId)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it("answers 403 to a vDC (iaas) tenant, whose scope cannot migrate, before reading either cluster", async () => {
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope: {} })
    const res = await post()
    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it("answers 403 to an MSP tenant that owns the source but not the target connection", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set([PARAMS.id]) })
    const res = await post()
    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()

    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set([PARAMS.id, BODY.targetConnectionId]) })
    expect((await post()).status).toBe(200)
  })

  it("relays the guest guard refusal for a guest outside the session's pools", async () => {
    guardSessionGuestMock.mockResolvedValue(new Response(JSON.stringify({ error: "Guest outside your vDC scope" }), { status: 403 }))
    const res = await post()
    expect(res.status).toBe(403)
    expect(guardSessionGuestMock).toHaveBeenCalledWith(expect.objectContaining({ connectionId: PARAMS.id, node: PARAMS.node, vmid: PARAMS.vmid, type: "qemu" }))
    // The source connection was resolved for the guard, nothing of the guest was read.
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})

// Proxmox VE 9.3 migration tunnel (lab 26/11: PVE-DR 9.3.1 to PVE-PROD 9.2).
describe("POST .../remote-migrate/check — Proxmox VE 9.3 migration tunnel", () => {
  function wireVersions(source: string, target: string) {
    wirePveFetch([], { ha: [] })
    const base = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation((conn: any, path: string) => {
      if (path === `/nodes/${PARAMS.node}/apt/versions`) return Promise.resolve([{ Package: "qemu-server", Version: source, OldVersion: source }])
      if (path === `/nodes/${BODY.targetNode}/apt/versions`) return Promise.resolve([{ Package: "qemu-server", Version: "9.2.24", OldVersion: target }])
      return base(conn, path)
    })
  }

  beforeEach(async () => {
    const { clearTunnelVersionCache } = await import("@/lib/migration/tunnelVersion")
    clearTunnelVersionCache()
  })

  it("blocks a 9.3 source with an older target, with the versions behind it", async () => {
    wireVersions("9.2.24", "9.2.15")
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const json = await (await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })).json()

    expect(json.valid).toBe(false)
    expect(json.issues.find((i: any) => i.code === "TARGET_TUNNEL_TOO_OLD")).toMatchObject({
      type: "error",
      context: { pkg: "qemu-server", source: "9.2.24", target: "9.2.15", required: "9.2.21" },
      details: expect.stringContaining("Upgrade the target cluster to Proxmox VE 9.3 first"),
    })
  })

  it("says nothing once the target is upgraded, or while the source is still older", async () => {
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    for (const [source, target] of [["9.2.24", "9.2.24"], ["9.2.15", "9.2.10"]]) {
      const { clearTunnelVersionCache } = await import("@/lib/migration/tunnelVersion")
      clearTunnelVersionCache()
      wireVersions(source, target)
      const json = await (await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })).json()
      expect(json.issues.some((i: any) => i.code === "TARGET_TUNNEL_TOO_OLD")).toBe(false)
    }
  })
})

// ui#1460: the move without copy reuses the preflight with its own rules.
describe("POST .../remote-migrate/check — move without copy (handover)", () => {
  const HANDOVER = { targetConnectionId: "conn-tgt", targetNode: "pve2", targetBridge: "vmbr0", handover: true }

  function wireHandover(opts: { status?: string; config?: Record<string, unknown>; targetVms?: any[]; pool?: string; snapshots?: any[] } = {}) {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path.endsWith("/status/current")) return Promise.resolve({ status: opts.status ?? "stopped" })
      if (path.endsWith("/status")) return Promise.resolve({ cpuinfo: { cpus: 8 }, memory: { free: 8 * 1024 ** 3 } })
      if (path.endsWith("/config")) return Promise.resolve(opts.config ?? { memory: 512, scsi0: "CephStoragePool:vm-100-disk-0,size=8G", net0: "virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0" })
      if (path.includes("/snapshot")) return Promise.resolve(opts.snapshots ?? [{ name: "current" }])
      if (path === "/nodes") return Promise.resolve([{ node: "pve2", status: "online" }])
      if (path.endsWith("/network")) return Promise.resolve([{ iface: "vmbr0", type: "bridge" }])
      if (path === "/cluster/resources?type=vm") {
        return Promise.resolve(_conn === "tgt" ? (opts.targetVms ?? []) : [{ vmid: 100, pool: opts.pool }])
      }
      return Promise.resolve([])
    })
  }

  async function check(body: any = HANDOVER, params: any = PARAMS) {
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]

    return (await callRoute(POST, { method: "POST", params, body })).json()
  }

  beforeEach(() => {
    sshReadyMock.mockReset().mockResolvedValue(true)
    getConnectionByIdMock.mockReset().mockImplementation(async (id: string) => (id === "conn-tgt" ? "tgt" : "src"))
  })

  it("passes a stopped guest without asking for a target storage", async () => {
    wireHandover()

    const json = await check()

    expect(json.valid).toBe(true)
    // Only the reminder that the source cluster, on its default range of new
    // IDs, can hand this VMID out again (ui#1460).
    expect(json.issues.map((i: any) => [i.type, i.code])).toEqual([["warning", "VMID_REUSABLE_ON_SOURCE"]])
  })

  it("blocks a running guest and offers to shut it down", async () => {
    wireHandover({ status: "running" })

    const json = await check()

    expect(json.issues.find((i: any) => i.code === "GUEST_RUNNING")).toMatchObject({ type: "error", remediation: { kind: "shutdown" } })
  })

  it("makes a VMID taken on the target a blocker: the guest keeps its VMID", async () => {
    wireHandover({ targetVms: [{ vmid: 100, node: "pve3", name: "other" }] })

    const json = await check({ ...HANDOVER, targetVmid: 555 })

    expect(json.issues.find((i: any) => i.code === "VMID_EXISTS_ON_TARGET")).toMatchObject({ type: "error", context: { vmid: "100" } })
  })

  it("carries snapshots instead of blocking on them", async () => {
    wireHandover({ snapshots: [{ name: "current" }, { name: "before" }] })

    const json = await check()

    expect(json.issues.some((i: any) => i.code === "SNAPSHOTS_PRESENT")).toBe(false)
  })

  it.each([
    [false, true, "source"],
    [true, false, "target"],
  ])("blocks without SSH (source %s, target %s)", async (src, tgt, side) => {
    wireHandover()
    sshReadyMock.mockImplementation(async (id: string) => (id === "conn-src" ? src : tgt))

    const json = await check()

    expect(json.issues.find((i: any) => i.code === "SSH_REQUIRED")).toMatchObject({ type: "error", context: { side } })
  })

  it("blocks a guest bound to a device of its node", async () => {
    wireHandover({ config: { memory: 512, hostpci0: "0000:01:00.0", scsi0: "A:vm-100-disk-0" } })

    const json = await check()

    expect(json.issues.find((i: any) => i.code === "NOT_PORTABLE")).toMatchObject({ type: "error", context: { keys: "hostpci0" } })
  })

  it("warns about an ISO it will detach and a pool the guest leaves", async () => {
    wireHandover({ config: { memory: 512, ide2: "local:iso/debian.iso,media=cdrom", scsi0: "A:vm-100-disk-0" }, pool: "web" })

    const json = await check()

    expect(json.valid).toBe(true)
    expect(json.issues.find((i: any) => i.code === "ISO_DETACHED")).toMatchObject({ type: "warning", context: { isos: "local:iso/debian.iso" } })
    expect(json.issues.find((i: any) => i.code === "POOL_NOT_CARRIED")).toMatchObject({ type: "warning", context: { pool: "web" } })
  })

  it("accepts a container", async () => {
    wireHandover({ config: { hostname: "ct", rootfs: "A:vm-101-disk-0,size=8G", net0: "name=eth0,bridge=vmbr0" } })

    const json = await check(HANDOVER, { ...PARAMS, type: "lxc", vmid: "101" })

    expect(json.valid).toBe(true)
    expect(pveFetchMock.mock.calls.some(([, path]: any[]) => path === "/nodes/pve1/lxc/101/config")).toBe(true)
  })

  it("still turns a container away from the migration with copy", async () => {
    const json = await check(BODY, { ...PARAMS, type: "lxc" })

    expect(json.issues[0].code).toBe("LXC_NOT_SUPPORTED")
  })
})

// Lab 27/11: a stopped VM on RBD sent to a ZFS pool was refused by Proxmox one
// second into the task. The preflight says it first.
describe("POST .../remote-migrate/check — offline copy between storage types", () => {
  function wireCopy(opts: { status: string; targetType: string }) {
    pveFetchMock.mockImplementation((conn: any, path: string) => {
      if (path.endsWith("/status/current")) return Promise.resolve({ status: opts.status })
      if (path.endsWith("/config")) return Promise.resolve({ scsi0: "CephStoragePool:vm-100-disk-0,size=8G", efidisk0: "CephStoragePool:vm-100-disk-1,size=1M" })
      if (path === "/storage") return Promise.resolve([{ storage: "CephStoragePool", type: "rbd" }])
      if (path === "/nodes") return Promise.resolve([{ node: BODY.targetNode, status: "online" }])
      if (path.endsWith("/storage")) return Promise.resolve([{ storage: BODY.targetStorage, type: opts.targetType, content: "images,rootdir" }])
      if (path.endsWith("/network")) return Promise.resolve([{ iface: BODY.targetBridge, type: "bridge" }])
      return Promise.resolve([])
    })
  }

  async function check() {
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]

    return (await callRoute(POST, { method: "POST", params: PARAMS, body: BODY })).json()
  }

  it("blocks a stopped VM whose disks Proxmox cannot copy to the target storage type", async () => {
    wireCopy({ status: "stopped", targetType: "zfspool" })

    const json = await check()

    expect(json.valid).toBe(false)
    expect(json.issues.find((i: any) => i.code === "STORAGE_FORMAT_MISMATCH")).toMatchObject({
      type: "error",
      context: { storage: BODY.targetStorage, sourceType: "rbd", targetType: "zfspool" },
    })
  })

  it("lets a running VM through: a live migration mirrors its disks instead", async () => {
    wireCopy({ status: "running", targetType: "zfspool" })

    const json = await check()

    expect(json.issues.some((i: any) => i.code === "STORAGE_FORMAT_MISMATCH")).toBe(false)
  })

  it("lets a stopped VM through to a storage of a compatible type", async () => {
    wireCopy({ status: "stopped", targetType: "lvmthin" })

    const json = await check()

    expect(json.issues.some((i: any) => i.code === "STORAGE_FORMAT_MISMATCH")).toBe(false)
  })
})
