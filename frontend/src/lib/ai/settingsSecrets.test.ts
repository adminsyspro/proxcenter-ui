import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// Set before the fixtures below seal anything (same as lib/crypto/secret.test.ts).
process.env.APP_SECRET = "test-secret-key-for-unit-tests"

import { decryptSecret } from "@/lib/crypto/secret"

import {
  AI_SECRET_MASK,
  isSealedAiSecret,
  maskAiSecrets,
  mergeAiSecretUpdate,
  openAiSecret,
  openAiSecrets,
  sealAiSecret,
} from "./settingsSecrets"

beforeEach(() => {
  vi.stubEnv("APP_SECRET", "test-secret-key-for-unit-tests")
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe("sealAiSecret / openAiSecret", () => {
  it("round-trips a key through the enc: envelope", () => {
    const sealed = sealAiSecret("sk-live-123")
    expect(isSealedAiSecret(sealed)).toBe(true)
    expect(sealed).not.toContain("sk-live-123")
    expect(decryptSecret(sealed.slice("enc:".length))).toBe("sk-live-123")
    expect(openAiSecret(sealed)).toBe("sk-live-123")
  })

  it("keeps an empty key empty and reads a legacy plaintext key as is", () => {
    expect(sealAiSecret("")).toBe("")
    expect(openAiSecret("sk-legacy")).toBe("sk-legacy")
    expect(openAiSecret("")).toBe("")
    expect(openAiSecret(undefined)).toBe("")
    expect(openAiSecret(42)).toBe("")
  })

  it("reads a ciphertext that no longer opens as no key, never as the ciphertext", () => {
    const sealed = sealAiSecret("sk-live-123")
    vi.stubEnv("APP_SECRET", "rotated")
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    expect(openAiSecret(sealed)).toBe("")
    expect(spy).toHaveBeenCalled()
  })

  it("openAiSecrets opens every key field and leaves the rest untouched", () => {
    const out = openAiSecrets({ provider: "openai", openaiKey: sealAiSecret("a"), anthropicKey: "legacy", ollamaUrl: "u" })
    expect(out).toEqual({ provider: "openai", openaiKey: "a", anthropicKey: "legacy", ollamaUrl: "u" })
  })
})

describe("maskAiSecrets", () => {
  it("replaces stored keys with the mask and reports which are set", () => {
    const out = maskAiSecrets({ provider: "openai", openaiKey: sealAiSecret("a"), anthropicKey: "" })
    expect(out).toEqual({
      provider: "openai",
      openaiKey: AI_SECRET_MASK,
      openaiKeySet: true,
      anthropicKey: "",
      anthropicKeySet: false,
    })
    expect(JSON.stringify(out)).not.toContain("enc:")
  })
})

describe("mergeAiSecretUpdate", () => {
  const stored = { provider: "openai", openaiKey: sealAiSecret("old-openai"), anthropicKey: "legacy-anthropic" }

  it("keeps the stored key when the mask comes back, sealing a legacy plaintext one on the way", () => {
    const out = mergeAiSecretUpdate(
      { provider: "openai", openaiKey: AI_SECRET_MASK, anthropicKey: AI_SECRET_MASK, openaiKeySet: true, anthropicKeySet: true },
      stored,
    )
    expect(out.openaiKey).toBe(stored.openaiKey)
    expect(isSealedAiSecret(out.anthropicKey)).toBe(true)
    expect(openAiSecret(out.anthropicKey)).toBe("legacy-anthropic")
    expect(out).not.toHaveProperty("openaiKeySet")
    expect(out).not.toHaveProperty("anthropicKeySet")
  })

  it("keeps the stored key when the field is omitted", () => {
    const out = mergeAiSecretUpdate({ provider: "anthropic" }, stored)
    expect(out.openaiKey).toBe(stored.openaiKey)
    expect(openAiSecret(out.anthropicKey)).toBe("legacy-anthropic")
  })

  it("seals a new key and clears one sent empty", () => {
    const out = mergeAiSecretUpdate({ openaiKey: "sk-new", anthropicKey: "" }, stored)
    expect(isSealedAiSecret(out.openaiKey)).toBe(true)
    expect(openAiSecret(out.openaiKey)).toBe("sk-new")
    expect(out.anthropicKey).toBe("")
  })

  it("stores no key when the mask comes back and nothing is stored (inherited row, first save)", () => {
    const out = mergeAiSecretUpdate({ openaiKey: AI_SECRET_MASK }, null)
    expect(out.openaiKey).toBe("")
    expect(out.anthropicKey).toBe("")
  })

  it("never writes the mask itself", () => {
    const out = mergeAiSecretUpdate({ openaiKey: AI_SECRET_MASK, anthropicKey: AI_SECRET_MASK }, { openaiKey: AI_SECRET_MASK })
    expect(JSON.stringify(out)).not.toContain(AI_SECRET_MASK)
  })
})
