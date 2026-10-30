/**
 * GET/PUT /api/v1/settings/ai: the OpenAI and Anthropic keys are sealed at
 * rest and never leave the server again (mask + `<field>Set` flag on GET, mask
 * kept on PUT), and a tenant only ever sees or keeps its OWN keys, not the
 * provider's inherited ones. The secret helpers run for real (APP_SECRET is
 * stubbed); the settings store, tenant and RBAC are mocked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const { checkPermissionMock, getCurrentTenantIdMock, getSettingMock, getSettingWithSourceMock, setSettingMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  getSettingMock: vi.fn(),
  getSettingWithSourceMock: vi.fn(),
  setSettingMock: vi.fn(),
}))

const licence = vi.hoisted(() => ({ ai: true }))

// The assistant is Enterprise (`ai_insights`): its settings are refused otherwise.
vi.mock("@/lib/auth/requireEnterprise", () => ({
  requireFeature: async () => (licence.ai ? null : new Response(JSON.stringify({ error: "Feature not licensed" }), { status: 403 })),
}))
vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: "admin.settings" },
}))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: () => getCurrentTenantIdMock() }))
vi.mock("@/lib/db/settings", () => ({
  getSetting: (...a: any[]) => getSettingMock(...a),
  getSettingWithSource: (...a: any[]) => getSettingWithSourceMock(...a),
  setSetting: (...a: any[]) => setSettingMock(...a),
}))
vi.mock("@/lib/audit", () => ({ audit: vi.fn(async () => "audit-id") }))

import { AI_SECRET_MASK, openAiSecret, sealAiSecret } from "@/lib/ai/settingsSecrets"

const PROVIDER_ROW = {
  enabled: true,
  provider: "openai",
  ollamaUrl: "http://ollama.lab:11434",
  ollamaModel: "mistral:7b",
  openaiKey: "sk-legacy-plaintext",
  openaiModel: "gpt-4.1-nano",
  anthropicKey: "",
  anthropicModel: "claude-haiku-4-5-20251001",
}

/** The store as seen from `tenantId`: its own row, or the provider's when it has none. */
function rowsFor(tenantId: string, own: Record<string, unknown> | null, provider: Record<string, unknown> | null = PROVIDER_ROW) {
  const found = own ? { tenantId, value: own } : provider ? { tenantId: "default", value: provider } : null
  getSettingMock.mockResolvedValue(found?.value ?? null)
  getSettingWithSourceMock.mockResolvedValue(found)
}

beforeEach(() => {
  licence.ai = true
  vi.clearAllMocks()
  vi.stubEnv("APP_SECRET", "test-secret-key-for-unit-tests")
  checkPermissionMock.mockResolvedValue(null)
  getCurrentTenantIdMock.mockResolvedValue("default")
  setSettingMock.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("GET /api/v1/settings/ai", () => {
  it("refuses without the Enterprise licence, for reading as for writing", async () => {
    licence.ai = false
    const { GET, PUT } = await import("./route")

    expect((await callRoute(GET as any, { method: "GET" })).status).toBe(403)
    expect((await callRoute(PUT as any, { method: "PUT", body: { enabled: true } })).status).toBe(403)
    expect(setSettingMock).not.toHaveBeenCalled()
  })

  it("masks the provider's own keys and flags which are set, legacy plaintext included", async () => {
    rowsFor("default", PROVIDER_ROW)
    const { GET } = await import("./route")
    const res = await callRoute(GET as any, { method: "GET" })
    expect(res.status).toBe(200)
    const data = (await readJson<any>(res)).data
    expect(data).toMatchObject({
      enabled: true,
      provider: "openai",
      openaiKey: AI_SECRET_MASK,
      openaiKeySet: true,
      anthropicKey: "",
      anthropicKeySet: false,
    })
    expect(JSON.stringify(data)).not.toContain("sk-legacy-plaintext")
  })

  it("lets a tenant inherit the provider's non-secret fields but never its keys", async () => {
    getCurrentTenantIdMock.mockResolvedValue("t1")
    rowsFor("t1", null, { ...PROVIDER_ROW, openaiKey: sealAiSecret("sk-provider") })
    const { GET } = await import("./route")
    const data = (await readJson<any>(await callRoute(GET as any, { method: "GET" }))).data
    expect(data.ollamaUrl).toBe("http://ollama.lab:11434")
    expect(data.openaiKey).toBe("")
    expect(data.openaiKeySet).toBe(false)
  })

  it("answers the defaults with no key set when nothing is stored", async () => {
    rowsFor("default", null, null)
    const { GET } = await import("./route")
    const data = (await readJson<any>(await callRoute(GET as any, { method: "GET" }))).data
    expect(data).toMatchObject({ provider: "ollama", openaiKey: "", openaiKeySet: false, anthropicKeySet: false })
  })

  it("returns the RBAC refusal untouched", async () => {
    checkPermissionMock.mockResolvedValue(new Response("forbidden", { status: 403 }))
    const { GET } = await import("./route")
    expect((await callRoute(GET as any, { method: "GET" })).status).toBe(403)
    expect(getSettingMock).not.toHaveBeenCalled()
  })
})

describe("PUT /api/v1/settings/ai", () => {
  it("seals a new key at rest and drops the read-only Set flags", async () => {
    rowsFor("default", PROVIDER_ROW)
    const { PUT } = await import("./route")
    const res = await callRoute(PUT as any, {
      method: "PUT",
      body: { ...PROVIDER_ROW, openaiKey: "sk-fresh", openaiKeySet: true, anthropicKeySet: false },
    })
    expect(res.status).toBe(200)
    expect(setSettingMock).toHaveBeenCalledTimes(1)
    const [key, tenantId, stored] = setSettingMock.mock.calls[0]
    expect([key, tenantId]).toEqual(["ai", "default"])
    expect(stored.openaiKey.startsWith("enc:")).toBe(true)
    expect(openAiSecret(stored.openaiKey)).toBe("sk-fresh")
    expect(stored).not.toHaveProperty("openaiKeySet")
    expect(stored.anthropicKey).toBe("")
  })

  it("keeps the stored key when the mask comes back, re-sealing legacy plaintext", async () => {
    rowsFor("default", PROVIDER_ROW)
    const { PUT } = await import("./route")
    await callRoute(PUT as any, { method: "PUT", body: { ...PROVIDER_ROW, openaiKey: AI_SECRET_MASK, openaiModel: "gpt-5" } })
    const stored = setSettingMock.mock.calls[0][2]
    expect(stored.openaiModel).toBe("gpt-5")
    expect(stored.openaiKey.startsWith("enc:")).toBe(true)
    expect(openAiSecret(stored.openaiKey)).toBe("sk-legacy-plaintext")
  })

  it("clears a key sent empty", async () => {
    rowsFor("default", { ...PROVIDER_ROW, openaiKey: sealAiSecret("sk-old") })
    const { PUT } = await import("./route")
    await callRoute(PUT as any, { method: "PUT", body: { ...PROVIDER_ROW, openaiKey: "" } })
    expect(setSettingMock.mock.calls[0][2].openaiKey).toBe("")
  })

  it("never copies the provider's inherited key into a tenant's row", async () => {
    getCurrentTenantIdMock.mockResolvedValue("t1")
    rowsFor("t1", null, { ...PROVIDER_ROW, openaiKey: sealAiSecret("sk-provider") })
    const { PUT } = await import("./route")
    await callRoute(PUT as any, { method: "PUT", body: { ...PROVIDER_ROW, openaiKey: AI_SECRET_MASK } })
    const [, tenantId, stored] = setSettingMock.mock.calls[0]
    expect(tenantId).toBe("t1")
    expect(stored.openaiKey).toBe("")
  })

  it("refuses a payload that is not an object", async () => {
    const { PUT } = await import("./route")
    expect((await callRoute(PUT as any, { method: "PUT", body: [1, 2] })).status).toBe(400)
    expect(setSettingMock).not.toHaveBeenCalled()
  })

  it("returns the RBAC refusal without writing", async () => {
    checkPermissionMock.mockResolvedValue(new Response("forbidden", { status: 403 }))
    const { PUT } = await import("./route")
    expect((await callRoute(PUT as any, { method: "PUT", body: PROVIDER_ROW })).status).toBe(403)
    expect(setSettingMock).not.toHaveBeenCalled()
  })
})
