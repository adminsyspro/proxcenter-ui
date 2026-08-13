/**
 * GHSA-qxgh-pw46-6pw6: first-run bootstrap hardening.
 *
 * The endpoint stays unauthenticated by nature (there is no account to
 * authenticate against yet), so what is tested here is everything that bounds
 * it: the optional shared secret, the global rate limit, and the fact that
 * "no user exists" is now decided INSIDE the transaction that creates the
 * super admin. The read-then-write gap was raceable.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"
import { _resetRateLimitCounters } from "@/lib/api-tokens/rateLimit"

// vi.hoisted: the vi.mock factories below are hoisted above these
// declarations, so plain consts would not be initialized yet when the route
// under test is imported.
const {
  userCountMock, userCreateMock, userTenantCreateMock,
  rbacUserRoleCreateMock, txUserCountMock, transactionMock,
} = vi.hoisted(() => ({
  userCountMock: vi.fn<() => Promise<number>>(),
  userCreateMock: vi.fn(async (args: any) => ({ __op: "user.create", args })),
  userTenantCreateMock: vi.fn(async (args: any) => ({ __op: "userTenant.create", args })),
  rbacUserRoleCreateMock: vi.fn(async (args: any) => ({ __op: "rbacUserRole.create", args })),
  txUserCountMock: vi.fn<() => Promise<number>>(),
  transactionMock: vi.fn<(...a: any[]) => Promise<any>>(),
}))

vi.mock("@/lib/auth/password", () => ({ hashPassword: vi.fn(async () => "hashed") }))
vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    user: { count: userCountMock, create: userCreateMock },
    userTenant: { create: userTenantCreateMock },
    rbacUserRole: { create: rbacUserRoleCreateMock },
    $transaction: transactionMock,
  },
}))

import { POST, GET } from "./route"

const VALID = { email: "admin@example.com", password: "correct horse", name: "Admin" }

/** Runs the route's transaction callback for real, against the tx-side mocks. */
function runTransaction() {
  transactionMock.mockImplementation(async (fn: any, _opts: any) =>
    fn({
      user: { count: txUserCountMock, create: userCreateMock },
      userTenant: { create: userTenantCreateMock },
      rbacUserRole: { create: rbacUserRoleCreateMock },
    })
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  _resetRateLimitCounters()
  delete process.env.PROXCENTER_SETUP_TOKEN
  userCountMock.mockResolvedValue(0)
  txUserCountMock.mockResolvedValue(0)
  runTransaction()
})

afterEach(() => {
  delete process.env.PROXCENTER_SETUP_TOKEN
})

describe("POST /api/v1/auth/setup: first run", () => {
  it("creates the super admin, its default membership and its global grant", async () => {
    const res = await callRoute(POST, { body: VALID })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).user).toMatchObject({
      email: "admin@example.com",
      role: "super_admin",
    })
    expect(userCreateMock).toHaveBeenCalledTimes(1)
    expect(userTenantCreateMock).toHaveBeenCalledTimes(1)
    expect(rbacUserRoleCreateMock).toHaveBeenCalledTimes(1)
  })

  it("runs the writes at serializable isolation", async () => {
    await callRoute(POST, { body: VALID })

    expect(transactionMock.mock.calls[0][1]).toEqual({ isolationLevel: "Serializable" })
  })

  it("refuses once a user exists", async () => {
    userCountMock.mockResolvedValue(1)

    const res = await callRoute(POST, { body: VALID })

    expect(res.status).toBe(400)
    expect(userCreateMock).not.toHaveBeenCalled()
  })

  it("stores a null name when none is supplied", async () => {
    const { name, ...withoutName } = VALID

    const res = await callRoute(POST, { body: withoutName })

    expect(res.status).toBe(200)
    expect(userCreateMock.mock.calls[0][0].data.name).toBeNull()
  })
})

describe("POST /api/v1/auth/setup: the raceable window", () => {
  // The pre-transaction count is the fast path; the one that decides is the
  // one inside. A concurrent bootstrap that lands between the two sees 0 then 1.
  it("still refuses when the user appears after the fast-path check", async () => {
    userCountMock.mockResolvedValue(0)
    txUserCountMock.mockResolvedValue(1)

    const res = await callRoute(POST, { body: VALID })

    expect(res.status).toBe(400)
    expect(await readJson<any>(res)).toEqual({ error: "Le setup initial a déjà été effectué" })
    expect(userCreateMock).not.toHaveBeenCalled()
  })

  it("maps a serialization failure (P2034) to the already-initialised answer", async () => {
    transactionMock.mockRejectedValue(Object.assign(new Error("write conflict"), { code: "P2034" }))

    const res = await callRoute(POST, { body: VALID })

    expect(res.status).toBe(400)
    expect(await readJson<any>(res)).toEqual({ error: "Le setup initial a déjà été effectué" })
  })

  it("still reports a genuine failure as a 500", async () => {
    transactionMock.mockRejectedValue(new Error("connection refused"))

    const res = await callRoute(POST, { body: VALID })

    expect(res.status).toBe(500)
  })
})

describe("POST /api/v1/auth/setup: optional shared secret", () => {
  it("requires nothing when PROXCENTER_SETUP_TOKEN is unset", async () => {
    const res = await callRoute(POST, { body: VALID })

    expect(res.status).toBe(200)
  })

  it("rejects a wrong token", async () => {
    process.env.PROXCENTER_SETUP_TOKEN = "s3cret"

    const res = await callRoute(POST, { body: VALID, headers: { "x-setup-token": "wrong!" } })

    expect(res.status).toBe(403)
    expect(userCreateMock).not.toHaveBeenCalled()
  })

  it("rejects an absent token", async () => {
    process.env.PROXCENTER_SETUP_TOKEN = "s3cret"

    const res = await callRoute(POST, { body: VALID })

    expect(res.status).toBe(403)
  })

  it("rejects a token that is merely a prefix of the real one", async () => {
    process.env.PROXCENTER_SETUP_TOKEN = "s3cret"

    const res = await callRoute(POST, { body: VALID, headers: { "x-setup-token": "s3c" } })

    expect(res.status).toBe(403)
  })

  it("accepts the right token", async () => {
    process.env.PROXCENTER_SETUP_TOKEN = "s3cret"

    const res = await callRoute(POST, { body: VALID, headers: { "x-setup-token": "s3cret" } })

    expect(res.status).toBe(200)
  })
})

describe("POST /api/v1/auth/setup: rate limit", () => {
  it("cuts the 11th attempt of a window with a Retry-After", async () => {
    userCountMock.mockResolvedValue(1) // keep every attempt cheap and identical

    for (let i = 0; i < 10; i++) {
      const res = await callRoute(POST, { body: VALID })

      expect(res.status).toBe(400)
    }

    const res = await callRoute(POST, { body: VALID })

    expect(res.status).toBe(429)
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0)
  })
})

describe("POST /api/v1/auth/setup: input validation", () => {
  it.each([
    ["missing password", { email: "a@b.co" }],
    ["missing email", { password: "longenough" }],
    ["malformed email", { email: "not-an-email", password: "longenough" }],
    ["short password", { email: "a@b.co", password: "short" }],
  ])("rejects %s", async (_label, body) => {
    const res = await callRoute(POST, { body })

    expect(res.status).toBe(400)
    expect(userCreateMock).not.toHaveBeenCalled()
  })
})

describe("GET /api/v1/auth/setup", () => {
  it("says whether setup is required without leaking the user count", async () => {
    userCountMock.mockResolvedValue(7)

    const res = await callRoute(GET, { method: "GET" })
    const body = await readJson<any>(res)

    expect(body).toEqual({ setupRequired: false })
    expect(body).not.toHaveProperty("userCount")
  })

  it("reports setup required on an empty instance", async () => {
    userCountMock.mockResolvedValue(0)

    expect(await readJson<any>(await callRoute(GET, { method: "GET" }))).toEqual({
      setupRequired: true,
    })
  })

  // A database that cannot be reached must not strand the installer on a page
  // that refuses to show the form. The safe answer is "setup required".
  it("falls back to setup required when the count cannot be read", async () => {
    userCountMock.mockRejectedValue(new Error("db unreachable"))

    expect(await readJson<any>(await callRoute(GET, { method: "GET" }))).toEqual({
      setupRequired: true,
    })
  })
})
