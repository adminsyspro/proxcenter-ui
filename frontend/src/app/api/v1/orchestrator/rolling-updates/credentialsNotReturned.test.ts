/**
 * The rolling update routes never hand the SSH credentials the
 * launch sent to the orchestrator back to a browser, even if the orchestrator
 * (or a row an older version stored) returns them.
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "@/__tests__/setup/route-test"

const { connFindUniqueMock } = vi.hoisted(() => ({ connFindUniqueMock: vi.fn() }))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue("default"),
  getTenantConnectionIds: vi.fn().mockResolvedValue(new Set(["c1"])),
  getSessionPrisma: async () => ({
    connection: { findUnique: connFindUniqueMock },
    managedHost: { findMany: vi.fn().mockResolvedValue([]) },
  }),
}))

vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: vi.fn().mockResolvedValue({ kind: "provider" }),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { AUTOMATION_VIEW: "automation.view", AUTOMATION_EXECUTE: "automation.execute" },
}))

vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: (s: string) => `plain-${s}` }))

vi.mock("@/lib/orchestrator/headers", () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => extra,
}))

const LEAKED = { sshEnabled: true, sshUser: "root", sshAuthMethod: "key", sshKey: "plain-key-enc", sshPassphrase: "plain-pass-enc" }
const RUN = { id: "ru-1", connection_id: "c1", status: "running", config: { auto_reboot: true, ssh_credentials: LEAKED } }

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

function answer(body: unknown) {
  fetchMock.mockImplementation(async () => ({ ok: true, status: 200, json: async () => body }))
}

async function bodyOf(res: Response) {
  const text = await res.text()

  expect(text).not.toMatch(/ssh_credentials|plain-key-enc|plain-pass-enc/)

  return JSON.parse(text)
}

beforeEach(() => {
  vi.clearAllMocks()
  connFindUniqueMock.mockResolvedValue({
    sshEnabled: true, sshPort: 22, sshUser: "root", sshAuthMethod: "key", sshKeyEnc: "key-enc", sshPassEnc: "pass-enc",
  })
})

describe("rolling update routes never return the SSH credentials", () => {
  it.each([
    ["an array", [RUN]],
    ["a list under data", { data: [RUN] }],
  ])("GET list, orchestrator answering %s", async (_label, body) => {
    answer(body)
    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })

    expect(res.status).toBe(200)
    const json = await bodyOf(res)

    expect(json.data[0].config.auto_reboot).toBe(true)
  })

  it("GET one run", async () => {
    answer(RUN)
    const { GET } = await import("./[id]/route")
    const res = await callRoute(GET as any, { method: "GET", params: { id: "ru-1" } })

    expect(res.status).toBe(200)
    expect((await bodyOf(res)).data.id).toBe("ru-1")
  })

  it("POST launch still sends the credentials to the orchestrator but not back to the caller", async () => {
    answer(RUN)
    const { POST } = await import("./route")
    const res = await callRoute(POST as any, { method: "POST", body: { connection_id: "c1", config: {} } })

    expect(res.status).toBe(200)
    const sent = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)

    expect(sent.config.ssh_credentials.sshKey).toBe("plain-key-enc")
    expect((await bodyOf(res)).data.id).toBe("ru-1")
  })
})
