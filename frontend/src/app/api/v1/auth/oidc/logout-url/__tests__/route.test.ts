/**
 * GET /api/v1/auth/oidc/logout-url — the end-session URL handed to the browser
 * after the local sign-out. Every branch here must degrade to `null` rather
 * than throw: a failure would leave the user inside a session they asked to
 * leave, which is the exact bug this route exists to fix.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const getTokenMock = vi.fn()
const getOidcConfigMock = vi.fn()
const discoverMock = vi.fn()
const sessionIdTokenMock = vi.fn()

vi.mock("next-auth/jwt", () => ({ getToken: getTokenMock }))
vi.mock("@/lib/auth/oidc", () => ({ getOidcConfig: getOidcConfigMock }))
vi.mock("@/lib/auth/sessions", () => ({ sessionIdToken: sessionIdTokenMock }))
vi.mock("@/lib/auth/oidcLogout", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/oidcLogout")>("@/lib/auth/oidcLogout")
  return { ...actual, discoverEndSessionEndpoint: discoverMock }
})

const call = async () => {
  const { GET } = await import("../route")
  return readJson<any>(await callRoute(GET as any, { method: "GET" }))
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.NEXTAUTH_URL = "https://pxc.example.com"
  getTokenMock.mockResolvedValue({ authProvider: "oidc", sid: "sid1" })
  sessionIdTokenMock.mockResolvedValue("the.row.token")
  getOidcConfigMock.mockResolvedValue({
    enabled: true,
    issuerUrl: "https://idp.example.com",
    clientId: "proxcenter",
  })
  discoverMock.mockResolvedValue("https://idp.example.com/logout")
})

describe("GET /api/v1/auth/oidc/logout-url", () => {
  it("returns the end-session URL with the session row hint and our own login page", async () => {
    const url = new URL((await call()).url)
    expect(url.origin + url.pathname).toBe("https://idp.example.com/logout")
    expect(url.searchParams.get("id_token_hint")).toBe("the.row.token")
    expect(sessionIdTokenMock).toHaveBeenCalledExactlyOnceWith("sid1")
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://pxc.example.com/login")
  })

  it("prefers the session row hint over a legacy cookie value", async () => {
    getTokenMock.mockResolvedValue({ authProvider: "oidc", sid: "sid1", idToken: "legacy.cookie.token" })
    const url = new URL((await call()).url)
    expect(url.searchParams.get("id_token_hint")).toBe("the.row.token")
  })

  it("preserves IdP sign-out for legacy cookies when the row has no hint", async () => {
    getTokenMock.mockResolvedValue({ authProvider: "oidc", sid: "sid1", idToken: "legacy.cookie.token" })
    sessionIdTokenMock.mockResolvedValue(null)
    const url = new URL((await call()).url)
    expect(url.searchParams.get("id_token_hint")).toBe("legacy.cookie.token")
    expect(sessionIdTokenMock).toHaveBeenCalledExactlyOnceWith("sid1")
  })

  it("falls back to client_id when neither the row nor the cookie carries an id_token", async () => {
    sessionIdTokenMock.mockResolvedValue(null)
    const url = new URL((await call()).url)
    expect(url.searchParams.get("client_id")).toBe("proxcenter")
    expect(url.searchParams.get("id_token_hint")).toBeNull()
    expect(sessionIdTokenMock).toHaveBeenCalledExactlyOnceWith("sid1")
  })

  it.each(["credentials", "ldap"])("returns null for a %s session", async (authProvider) => {
    // Nothing to end at an IdP: the plain local sign-out is the right answer.
    getTokenMock.mockResolvedValue({ authProvider, sid: "sid1" })
    expect((await call()).url).toBeNull()
    expect(getOidcConfigMock).not.toHaveBeenCalled()
    expect(sessionIdTokenMock).not.toHaveBeenCalled()
  })

  it.each([undefined, "legacy.cookie.token"])("skips the row lookup without a sid (cookie hint: %s)", async (idToken) => {
    getTokenMock.mockResolvedValue({ authProvider: "oidc", idToken })
    const url = new URL((await call()).url)
    expect(sessionIdTokenMock).not.toHaveBeenCalled()
    expect(url.searchParams.get("id_token_hint")).toBe(idToken ?? null)
    if (!idToken) expect(url.searchParams.get("client_id")).toBe("proxcenter")
  })

  it("returns HTTP 200 with a null URL when the session row lookup rejects", async () => {
    // A database failure must still let the browser finish the local sign-out.
    sessionIdTokenMock.mockRejectedValue(new Error("db down"))
    const { GET } = await import("../route")
    const response = await callRoute(GET as any, { method: "GET" })
    expect(response.status).toBe(200)
    expect(await readJson(response)).toEqual({ url: null })
    expect(sessionIdTokenMock).toHaveBeenCalledExactlyOnceWith("sid1")
  })

  it("returns null when there is no session at all", async () => {
    getTokenMock.mockResolvedValue(null)
    expect((await call()).url).toBeNull()
  })

  it("returns null when OIDC was turned off since the user signed in", async () => {
    getOidcConfigMock.mockResolvedValue({ enabled: false, issuerUrl: "https://idp.example.com" })
    expect((await call()).url).toBeNull()
  })

  it("returns null when the provider advertises no end_session_endpoint", async () => {
    discoverMock.mockResolvedValue(null)
    expect((await call()).url).toBeNull()
  })

  it("returns null instead of throwing when reading the session blows up", async () => {
    getTokenMock.mockRejectedValue(new Error("bad secret"))
    expect((await call()).url).toBeNull()
  })

  it("uses the request origin when NEXTAUTH_URL is unset", async () => {
    delete process.env.NEXTAUTH_URL
    const url = new URL((await call()).url)
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("http://test.local/login")
  })
})
