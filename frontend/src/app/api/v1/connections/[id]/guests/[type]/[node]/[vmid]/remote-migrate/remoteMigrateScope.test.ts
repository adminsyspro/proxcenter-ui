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
