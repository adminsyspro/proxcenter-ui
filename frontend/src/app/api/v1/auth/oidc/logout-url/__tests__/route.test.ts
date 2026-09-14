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

vi.mock("next-auth/jwt", () => ({ getToken: getTokenMock }))
vi.mock("@/lib/auth/oidc", () => ({ getOidcConfig: getOidcConfigMock }))
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
  getTokenMock.mockResolvedValue({ authProvider: "oidc", idToken: "the.id.token" })
  getOidcConfigMock.mockResolvedValue({
    enabled: true,
    issuerUrl: "https://idp.example.com",
    clientId: "proxcenter",
  })
  discoverMock.mockResolvedValue("https://idp.example.com/logout")
})

describe("GET /api/v1/auth/oidc/logout-url", () => {
  it("returns the end-session URL with the hint and our own login page", async () => {
    const url = new URL((await call()).url)
    expect(url.origin + url.pathname).toBe("https://idp.example.com/logout")
    expect(url.searchParams.get("id_token_hint")).toBe("the.id.token")
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://pxc.example.com/login")
  })

  it("falls back to client_id when the session carries no id_token", async () => {
    getTokenMock.mockResolvedValue({ authProvider: "oidc" })
    const url = new URL((await call()).url)
    expect(url.searchParams.get("client_id")).toBe("proxcenter")
    expect(url.searchParams.get("id_token_hint")).toBeNull()
  })

  it("returns null for a local or LDAP session", async () => {
    // Nothing to end at an IdP: the plain local sign-out is the right answer.
    getTokenMock.mockResolvedValue({ authProvider: "credentials" })
    expect((await call()).url).toBeNull()
    expect(getOidcConfigMock).not.toHaveBeenCalled()
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
