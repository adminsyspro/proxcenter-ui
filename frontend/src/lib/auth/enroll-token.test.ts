import { describe, expect, it } from "vitest"
import { errors as joseErrors } from "jose"
import { signEnrollToken, verifyEnrollToken } from "./enroll-token"

const SECRET = "x".repeat(32)

describe("enroll-token", () => {
  it("round-trips a payload within ttl", async () => {
    const tok = await signEnrollToken({ userId: "u1", secretEnc: "abc" }, SECRET)
    const payload = await verifyEnrollToken(tok, SECRET)
    expect(payload.userId).toBe("u1")
    expect(payload.secretEnc).toBe("abc")
  })

  it("rejects a token signed with a different secret", async () => {
    const tok = await signEnrollToken({ userId: "u1", secretEnc: "abc" }, SECRET)
    await expect(verifyEnrollToken(tok, "y".repeat(32))).rejects.toThrow()
  })

  it("rejects an expired token", async () => {
    const tok = await signEnrollToken({ userId: "u1", secretEnc: "abc" }, SECRET, 1)
    await new Promise((r) => setTimeout(r, 1100))
    await expect(verifyEnrollToken(tok, SECRET)).rejects.toBeInstanceOf(joseErrors.JWTExpired)
  })

  it("throws TypeError when payload shape is wrong", async () => {
    const { SignJWT } = await import("jose")
    const key = new TextEncoder().encode(SECRET)
    const tok = await new SignJWT({ wrongField: "yes" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(key)
    await expect(verifyEnrollToken(tok, SECRET)).rejects.toBeInstanceOf(TypeError)
  })
})
