import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const { getSettingWithSourceMock, getCurrentTenantIdMock } = vi.hoisted(() => ({
  getSettingWithSourceMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
}))

vi.mock("@/lib/db/settings", () => ({ getSettingWithSource: (...a: any[]) => getSettingWithSourceMock(...a) }))
vi.mock("@/lib/tenant", () => ({ getCurrentTenantId: () => getCurrentTenantIdMock() }))

import { AI_SECRET_MASK, sealAiSecret } from "./settingsSecrets"
import { getOwnAiSettings, resolveMaskedAiSecrets } from "./storedSecrets"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv("APP_SECRET", "test-secret-key-for-unit-tests")
  getCurrentTenantIdMock.mockResolvedValue("t1")
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("getOwnAiSettings", () => {
  it("returns the tenant's own row and null for an inherited or missing one", async () => {
    getSettingWithSourceMock.mockResolvedValue({ tenantId: "t1", value: { provider: "openai" } })
    expect(await getOwnAiSettings("t1")).toEqual({ provider: "openai" })
    expect(getSettingWithSourceMock).toHaveBeenCalledWith("ai", "t1")

    getSettingWithSourceMock.mockResolvedValue({ tenantId: "default", value: { provider: "openai" } })
    expect(await getOwnAiSettings("t1")).toBeNull()

    getSettingWithSourceMock.mockResolvedValue(null)
    expect(await getOwnAiSettings("t1")).toBeNull()
  })
})

describe("resolveMaskedAiSecrets", () => {
  it("returns a body without any mask untouched, with no lookup", async () => {
    const body = { provider: "openai", openaiKey: "sk-typed" }
    expect(await resolveMaskedAiSecrets(body)).toBe(body)
    expect(getSettingWithSourceMock).not.toHaveBeenCalled()
  })

  it("swaps the mask for the tenant's own stored key, opened", async () => {
    getSettingWithSourceMock.mockResolvedValue({ tenantId: "t1", value: { openaiKey: sealAiSecret("sk-own"), anthropicKey: "legacy" } })
    const out = await resolveMaskedAiSecrets({ provider: "openai", openaiKey: AI_SECRET_MASK, anthropicKey: AI_SECRET_MASK })
    expect(out).toEqual({ provider: "openai", openaiKey: "sk-own", anthropicKey: "legacy" })
  })

  it("never resolves the mask against the provider's inherited row", async () => {
    // The OpenAI probe takes a base URL from the form: the provider's key must
    // not be sent wherever a tenant admin points it.
    getSettingWithSourceMock.mockResolvedValue({ tenantId: "default", value: { openaiKey: sealAiSecret("sk-provider") } })
    const out = await resolveMaskedAiSecrets({ provider: "openai", openaiKey: AI_SECRET_MASK, openaiBaseUrl: "https://attacker.example" })
    expect(out.openaiKey).toBe("")
  })
})
