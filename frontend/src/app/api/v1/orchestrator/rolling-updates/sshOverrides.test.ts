/**
 * Rolling update launch and preflight forward the per-node SSH overrides in the
 * object form { node: { address, port } } the orchestrator resolves per node.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { connFindUniqueMock, hostFindManyMock } = vi.hoisted(() => ({
  connFindUniqueMock: vi.fn(),
  hostFindManyMock: vi.fn(),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: vi.fn(),
  getTenantConnectionIds: vi.fn(),
  getSessionPrisma: async () => ({
    connection: { findUnique: connFindUniqueMock },
    managedHost: { findMany: hostFindManyMock },
  }),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { AUTOMATION_VIEW: "automation.view", AUTOMATION_EXECUTE: "automation.execute" },
}))

vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: (s: string) => `plain:${s}` }))

vi.mock("@/lib/orchestrator/headers", () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => extra,
}))

const fetchMock = vi.fn(async (..._args: any[]) => ({ ok: true, status: 200, json: async () => ({ data: {} }) }))
vi.stubGlobal("fetch", fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  connFindUniqueMock.mockResolvedValue({
    sshEnabled: true, sshPort: 2222, sshUser: "root", sshAuthMethod: "password", sshKeyEnc: null, sshPassEnc: "pw",
  })
  hostFindManyMock.mockResolvedValue([
    { node: "pve1", sshAddress: "203.0.113.10", sshPort: 2201 },
    { node: "pve2", sshAddress: "203.0.113.10", sshPort: 2202 },
    { node: "pve3", sshAddress: "100.64.0.3", sshPort: null },
    { node: "pve4", sshAddress: null, sshPort: null },
  ])
})

const EXPECTED = {
  pve1: { address: "203.0.113.10", port: 2201 },
  pve2: { address: "203.0.113.10", port: 2202 },
  pve3: { address: "100.64.0.3" },
}

function sentConfig() {
  const init = fetchMock.mock.calls[0][1] as RequestInit
  return JSON.parse(init.body as string).config
}

describe.each([
  ["launch", "./route"],
  ["preflight", "./preflight/route"],
])("POST rolling update %s", (_label, path) => {
  it("sends ssh_overrides in the object form and keeps the connection port as the default", async () => {
    const { POST } = await import(path)
    const res = await callRoute(POST as any, { method: "POST", body: { connection_id: "c1", config: { reboot: true } } })

    expect(res.status).toBe(200)
    expect(hostFindManyMock).toHaveBeenCalledWith({
      where: { connectionId: "c1" },
      select: { node: true, sshAddress: true, sshPort: true },
    })
    const config = sentConfig()
    expect(config.ssh_overrides).toEqual(EXPECTED)
    expect(config.ssh_credentials.sshPort).toBe(2222)
    expect(config.reboot).toBe(true)
  })

  it("omits ssh_overrides when no node has an override", async () => {
    hostFindManyMock.mockResolvedValue([{ node: "pve1", sshAddress: null, sshPort: null }])

    const { POST } = await import(path)
    await callRoute(POST as any, { method: "POST", body: { connection_id: "c1", config: {} } })

    expect(sentConfig()).not.toHaveProperty("ssh_overrides")
  })
})
