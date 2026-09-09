import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../../../../../../../__tests__/setup/route-test"

// Hoist mocks so they are available in vi.mock factories
const { getInfraMock, checkPermissionMock, getConnectionByIdMock, pveFetchMock, getNodeIpMock, watchMigrationMock } = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  getNodeIpMock: vi.fn(),
  watchMigrationMock: vi.fn(),
}))

vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => "test-tenant",
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...args: any[]) => checkPermissionMock(...args),
  buildVmResourceId: (id: string, node: string, type: string, vmid: string) => `${id}/${node}/${type}/${vmid}`,
  PERMISSIONS: { VM_MIGRATE: "vm.migrate" },
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...args: any[]) => getConnectionByIdMock(...args),
}))

vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...args: any[]) => pveFetchMock(...args),
}))

vi.mock("@/lib/ssh/node-ip", () => ({
  getNodeIp: (...args: any[]) => getNodeIpMock(...args),
}))

vi.mock("@/lib/migration/cross-cluster-watcher", () => ({
  watchMigrationAndCleanup: (...args: any[]) => watchMigrationMock(...args),
}))

vi.mock("@/lib/audit", () => ({ audit: vi.fn() }))

// The route tries a real TLS connection to fetch the target fingerprint before
// reaching the execution logic. Stub it out so the "passes the gate" tests
// reach body execution without a network timeout.
vi.mock("tls", () => ({
  connect: (_opts: any, cb?: () => void) => {
    const emitter: any = {
      getPeerCertificate: () => ({ fingerprint256: "AA:BB:CC:DD" }),
      end: () => {},
      on: (_event: string, _handler: () => void) => emitter,
    }
    if (cb) setTimeout(cb, 0)
    return emitter
  },
}))
vi.mock("net", () => ({}))

const STUB_SOURCE_CONN = { id: "conn-src", name: "Source", baseUrl: "https://src-pve:8006", apiToken: "tok-src" }
const STUB_TARGET_CONN = { id: "conn-tgt", name: "Target", baseUrl: "https://tgt-pve:8006", apiToken: "tok-tgt" }

const PARAMS = { id: "conn-src", type: "qemu", node: "pve1", vmid: "100" }

const VALID_BODY = {
  targetConnectionId: "conn-tgt",
  targetNode: "pve2",
  targetStorage: "local-lvm",
  targetBridge: "vmbr0",
  online: true,
  delete: false,
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockImplementation((id: string) => {
    if (id === "conn-src") return Promise.resolve(STUB_SOURCE_CONN)
    if (id === "conn-tgt") return Promise.resolve(STUB_TARGET_CONN)
    return Promise.resolve(null)
  })
  pveFetchMock.mockReset()
  getNodeIpMock.mockReset().mockResolvedValue("10.0.0.2")
  watchMigrationMock.mockReset().mockResolvedValue(undefined)
  getInfraMock.mockReset()
})

describe("POST .../remote-migrate — MSP ownership gate", () => {
  it("provider tenant passes the source gate (reaches body parsing, no 403)", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: VALID_BODY,
    })

    // Provider passes the gate; may fail later on TLS fingerprint logic (500 or 400)
    // but must NOT return 403
    expect(res.status).not.toBe(403)
  })

  it("msp tenant that owns BOTH connections passes the gate", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-src", "conn-tgt"]) })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: VALID_BODY,
    })

    expect(res.status).not.toBe(403)
  })

  it("msp tenant that does NOT own the source connection gets 403", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-tgt"]) })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: VALID_BODY,
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/migration is restricted/i)
  })

  it("msp tenant that owns source but NOT target connection gets 403", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-src"]) })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: VALID_BODY,
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/target must be a connection owned by your tenant/i)
  })

  it("iaas tenant gets 403 regardless of connection ids", async () => {
    const vdcScope: any = { connectionIds: new Set(["conn-src", "conn-tgt"]), pbsConnectionIds: new Set() }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: PARAMS,
      body: VALID_BODY,
    })

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/migration is restricted/i)
  })

  it("rejects LXC type before even reaching the gate — returns 400", async () => {
    // Type check happens before the gate; ensure we don't regress it
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: { ...PARAMS, type: "lxc" },
      body: VALID_BODY,
    })

    expect(res.status).toBe(400)
  })
})

// The [vmid] segment reaches `qm unlock ${vmid}` in the cleanup watcher and the
// [node] segment can become the SSH host (getNodeIp fallback), so both are
// re-derived at the boundary and injection payloads must 400 before the gate.
describe("POST .../remote-migrate — node/vmid validation (command injection)", () => {
  it("rejects a vmid with shell metacharacters (400, before the RBAC gate / watcher)", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: { ...PARAMS, vmid: "100; touch /tmp/pwn" },
      body: VALID_BODY,
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/invalid node name or vmid/i)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(watchMigrationMock).not.toHaveBeenCalled()
  })

  it("rejects a node name with shell metacharacters (400, before the RBAC gate / watcher)", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    const res = await callRoute(POST, {
      method: "POST",
      params: { ...PARAMS, node: "pve1$(reboot)" },
      body: VALID_BODY,
    })
    expect(res.status).toBe(400)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(watchMigrationMock).not.toHaveBeenCalled()
  })
})

// The restore plan is built by the browser and handed to a detached watcher that
// writes HA resources and replication jobs on the TARGET cluster. It is parsed at
// the boundary so a malformed capture is dropped rather than replayed.
describe("POST .../remote-migrate — restore plan", () => {
  const CAPTURE = {
    ha: { sid: "vm:100", state: "started", group: "prod", maxRestart: 2, maxRelocate: 3 },
    replication: [{ id: "100-0", guest: 100, target: "pve2", schedule: "*/15" }],
    snapshotsDeleted: ["before-upgrade"],
  }
  const PLAN = {
    capture: CAPTURE,
    restoreHa: true,
    restoreReplication: true,
    haState: "started",
    replicationTarget: "pve2-dr",
    replicationSchedule: "*/15",
  }

  function wirePve({ replicationJobs = [] as any[] } = {}) {
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path === "/cluster/replication") return Promise.resolve(replicationJobs)
      if (path.includes("remote_migrate")) return Promise.resolve("UPID:pve1:0000A:qmigrate:100:root@pam:")

      return Promise.resolve([])
    })
  }

  const post = async (body: any, params = PARAMS) => {
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]

    return callRoute(POST, { method: "POST", params, body })
  }

  beforeEach(() => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    wirePve()
  })

  it("hands a well-formed plan to the watcher, with the target it was given", async () => {
    const res = await post({ ...VALID_BODY, targetVmid: "9100", restore: PLAN })

    expect(res.status).toBe(200)
    expect(watchMigrationMock).toHaveBeenCalledTimes(1)
    expect(watchMigrationMock.mock.calls[0][0]).toMatchObject({
      targetVmid: "9100",
      targetNode: "pve2",
      restore: { restoreHa: true, restoreReplication: true, haState: "started", replicationTarget: "pve2-dr" },
    })
    expect(watchMigrationMock.mock.calls[0][0].restore.capture.replication[0].id).toBe("100-0")
  })

  it("falls back to the source vmid when no target vmid is asked for", async () => {
    await post({ ...VALID_BODY, restore: PLAN })

    expect(watchMigrationMock.mock.calls[0][0].targetVmid).toBe("100")
  })

  // A guest with no HA resource captures `ha: null`, and an older client may not
  // send the key at all. Both must survive: dropping the plan would also drop the
  // rollback that puts the source back together after a failed migration.
  it.each([
    ["explicit null", null],
    ["absent", undefined],
  ])("keeps a plan whose ha capture is %s", async (_label, ha) => {
    const capture: Record<string, unknown> = { ...CAPTURE, ha }
    if (ha === undefined) delete capture.ha

    await post({ ...VALID_BODY, restore: { ...PLAN, capture } })

    expect(watchMigrationMock).toHaveBeenCalledTimes(1)
    expect(watchMigrationMock.mock.calls[0][0].restore).toBeDefined()
  })

  it.each([
    ["no capture at all", { restoreHa: true }],
    ["a capture that is not an object", { capture: "vm:100" }],
    ["an ha entry without a sid", { capture: { ...CAPTURE, ha: { state: "started" } } }],
    ["an ha entry with an empty sid", { capture: { ...CAPTURE, ha: { sid: "" } } }],
    ["an ha entry with a non-string group", { capture: { ...CAPTURE, ha: { sid: "vm:100", group: 7 } } }],
    ["an ha entry with a non-finite maxRestart", { capture: { ...CAPTURE, ha: { sid: "vm:100", maxRestart: Number.NaN } } }],
    ["a replication list that is not an array", { capture: { ...CAPTURE, replication: "100-0" } }],
    ["a replication job without an id", { capture: { ...CAPTURE, replication: [{ guest: 100, target: "pve2" }] } }],
    ["a replication job whose guest is not a positive integer", { capture: { ...CAPTURE, replication: [{ id: "100-0", guest: 0, target: "pve2" }] } }],
    ["a replication job whose target is not a string", { capture: { ...CAPTURE, replication: [{ id: "100-0", guest: 100, target: 2 }] } }],
    ["a replication job whose rate is not a number", { capture: { ...CAPTURE, replication: [{ id: "100-0", guest: 100, target: "pve2", rate: "fast" }] } }],
    ["a snapshot list holding something else than names", { capture: { ...CAPTURE, snapshotsDeleted: [{ name: "s1" }] } }],
    ["a non-boolean restoreHa", { capture: CAPTURE, restoreHa: "yes" }],
    ["a non-string haState", { capture: CAPTURE, haState: 1 }],
    ["a non-number replicationRate", { capture: CAPTURE, replicationRate: "10" }],
  ])("drops a plan with %s", async (_label, restore) => {
    const res = await post({ ...VALID_BODY, restore })

    expect(res.status).toBe(200)
    expect(watchMigrationMock).toHaveBeenCalledTimes(1)
    expect(watchMigrationMock.mock.calls[0][0].restore).toBeUndefined()
  })

  // Proxmox keeps refusing remote_migrate while a replication job is still being
  // torn down, and answers with a raw perl error. Catch it before the migration.
  it("returns 409 while Proxmox is still removing the replication job", async () => {
    wirePve({ replicationJobs: [{ id: "100-0", guest: 100, target: "pve2" }] })

    const res = await post({ ...VALID_BODY, restore: PLAN })

    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/still removing replication job\(s\) 100-0/i)
    expect(watchMigrationMock).not.toHaveBeenCalled()
  })

  it("ignores a replication job that belongs to another guest", async () => {
    wirePve({ replicationJobs: [{ id: "101-0", guest: 101, target: "pve2" }] })

    const res = await post({ ...VALID_BODY, restore: PLAN })

    expect(res.status).toBe(200)
    expect(watchMigrationMock).toHaveBeenCalledTimes(1)
  })

  // Without a plan there is nothing to put back, so the guard must not cost a
  // round trip to /cluster/replication on every ordinary migration.
  it("does not query replication when no plan is sent", async () => {
    const res = await post({ ...VALID_BODY })

    expect(res.status).toBe(200)
    expect(pveFetchMock.mock.calls.some(([, path]: any[]) => path === "/cluster/replication")).toBe(false)
  })
})
