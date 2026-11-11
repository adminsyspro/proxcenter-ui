import { beforeEach, describe, expect, it, vi } from "vitest"

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock("@/lib/api-tokens/routeGuard", () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute } from "../../../../../../../../../../__tests__/setup/route-test"

// Hoist mocks so they are available in vi.mock factories
const { getInfraMock, checkPermissionMock, getConnectionByIdMock, pveFetchMock, getNodeIpMock, watchMigrationMock, TARGET_FP, tlsState, recordMock, finalizeMock, failMock, heartbeatMock } = vi.hoisted(() => ({
  recordMock: vi.fn(),
  finalizeMock: vi.fn(),
  failMock: vi.fn(),
  heartbeatMock: vi.fn(),
  getInfraMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  getNodeIpMock: vi.fn(),
  watchMigrationMock: vi.fn(),
  /** SHA-256 fingerprint the target cluster reports for pve2 (32 colon-separated bytes). */
  TARGET_FP: Array.from({ length: 32 }, (_, i) => ((i * 7 + 3) % 256).toString(16).padStart(2, "0").toUpperCase()).join(":"),
  /** What the fake TLS handshake with the resolved host presents. */
  tlsState: { fingerprint: "" },
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

vi.mock("@/lib/vdc/move/service", () => ({ recordProviderMigrationAsMove: (...a: any[]) => recordMock(...a) }))
vi.mock("@/lib/vdc/move/runner", () => ({
  finalizeMove: (...a: any[]) => finalizeMock(...a),
  failMove: (...a: any[]) => failMock(...a),
  heartbeatMove: (...a: any[]) => heartbeatMock(...a),
}))

// The route opens a real TLS connection to the resolved host to cross-check the
// fingerprint the target API reports. Stub it out so the tests reach body
// execution without a network timeout; `tlsState` says what the host presents.
vi.mock("tls", () => ({
  connect: (_opts: any, cb?: () => void) => {
    const emitter: any = {
      getPeerCertificate: () => ({ fingerprint256: tlsState.fingerprint }),
      end: () => {},
      on: (_event: string, _handler: () => void) => emitter,
    }
    if (cb) setTimeout(cb, 0)
    return emitter
  },
}))

/** Target cluster API: pve2 is a member, and its pveproxy certificate is TARGET_FP. */
function targetClusterAnswers(path: string): unknown {
  if (path === "/nodes") return [{ node: "pve1" }, { node: "pve2" }]
  if (path === "/nodes/pve2/certificates/info") return [{ filename: "pve-ssl.pem", fingerprint: "11:".repeat(31) + "11" }, { filename: "pveproxy-ssl.pem", fingerprint: TARGET_FP }]
  return []
}

/** The target-endpoint of the latest remote_migrate call, decoded from its form body. */
function sentTargetEndpoint(): string {
  const call = pveFetchMock.mock.calls.filter(([, path]: any[]) => path.includes("remote_migrate")).at(-1)
  return new URLSearchParams(call![2].body).get("target-endpoint") ?? ""
}

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
  recordMock.mockReset().mockResolvedValue(null)
  finalizeMock.mockReset().mockResolvedValue(undefined)
  failMock.mockReset().mockResolvedValue(undefined)
  heartbeatMock.mockReset().mockResolvedValue(undefined)
  getInfraMock.mockReset()
  tlsState.fingerprint = TARGET_FP
})

// #1335: the provider's cross-cluster migration of a guest of a vDC joins the
// tenant's vDC on the target cluster instead of landing outside any vDC.
describe("POST .../remote-migrate, vDC link", () => {
  function answerPve() {
    pveFetchMock.mockImplementation(async (conn: any, path: string) => {
      if (conn?.id === "conn-tgt") return targetClusterAnswers(path)
      if (path.includes("remote_migrate")) return "UPID:pve1:00:01:02:qmigrate:100:root@pam:"
      return null
    })
  }

  async function run() {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    answerPve()
    const POST = (await import("./route")).POST as Parameters<typeof callRoute>[0]
    return callRoute(POST, { method: "POST", params: PARAMS, body: VALID_BODY })
  }

  it("records the migration as a move and finalizes it once the copy completed", async () => {
    recordMock.mockResolvedValue({ moveId: "m1", targetVdcName: "Lyon" })
    watchMigrationMock.mockImplementation(async (opts: any) => {
      await opts.onPoll()
      return { outcome: "completed", sourceLeft: true }
    })

    const res = await run()
    expect(res.status).toBe(200)
    expect((await res.json()).details.targetVdc).toEqual({ moveId: "m1", name: "Lyon" })
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({
      sourceConnectionId: "conn-src", vmid: 100, targetConnectionId: "conn-tgt", targetNode: "pve2", targetVmid: 100,
      targetStorage: "local-lvm", targetBridge: "vmbr0", deleteSource: false, upid: "UPID:pve1:00:01:02:qmigrate:100:root@pam:",
    }))
    await vi.waitFor(() => expect(finalizeMock).toHaveBeenCalledWith("m1", false))
    expect(heartbeatMock).toHaveBeenCalledWith("m1")
  })

  it("fails the move when the copy did not complete", async () => {
    recordMock.mockResolvedValue({ moveId: "m2", targetVdcName: "Lyon" })
    watchMigrationMock.mockResolvedValue({ outcome: "failed", exitstatus: "aborted" })
    await run()
    await vi.waitFor(() => expect(failMock).toHaveBeenCalledWith("m2", expect.stringContaining("did not complete")))
    expect(finalizeMock).not.toHaveBeenCalled()
  })

  it("migrates as before when the guest is in no vDC, or when recording fails", async () => {
    watchMigrationMock.mockResolvedValue({ outcome: "completed", sourceLeft: false })
    const res = await run()
    expect((await res.json()).details.targetVdc).toBeNull()
    expect(finalizeMock).not.toHaveBeenCalled()

    vi.spyOn(console, "warn").mockImplementation(() => {})
    recordMock.mockRejectedValue(new Error("db down"))
    expect((await run()).status).toBe(200)
  })
})
