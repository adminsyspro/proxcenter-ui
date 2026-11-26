/**
 * GHSA-5hx5-2429-mg7w: the onboarding status is read before any session
 * exists (the sign-in page asks whether the first-run setup is due), so it
 * answers with the two decisions the interface needs and nothing countable.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

import { callRoute, readJson } from "@/__tests__/setup/route-test"

const { userCountMock, vdcCountMock, connectionCountMock, tenantIdMock } = vi.hoisted(() => ({
  userCountMock: vi.fn<() => Promise<number>>(),
  vdcCountMock: vi.fn<(args: unknown) => Promise<number>>(),
  connectionCountMock: vi.fn<() => Promise<number>>(),
  tenantIdMock: vi.fn<() => Promise<string>>(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: { user: { count: userCountMock }, vdc: { count: vdcCountMock } },
}))
vi.mock("@/lib/tenant", () => ({
  getSessionPrisma: async () => ({ connection: { count: connectionCountMock } }),
  getCurrentTenantId: tenantIdMock,
}))

import { GET } from "./route"

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, "error").mockImplementation(() => undefined)
  userCountMock.mockResolvedValue(3)
  connectionCountMock.mockResolvedValue(2)
  vdcCountMock.mockResolvedValue(0)
  tenantIdMock.mockResolvedValue("default")
})

describe("GET /api/v1/app/status", () => {
  it("answers with the two decisions only, never a count", async () => {
    const res = await callRoute(GET)

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ setupRequired: false, connectionsConfigured: true })
  })

  it("asks for the setup on an instance without any user", async () => {
    userCountMock.mockResolvedValue(0)
    connectionCountMock.mockResolvedValue(0)

    expect(await readJson(await callRoute(GET))).toEqual({ setupRequired: true, connectionsConfigured: false })
  })

  it("counts a tenant as connected through its enabled vDCs", async () => {
    tenantIdMock.mockResolvedValue("tenant-a")
    connectionCountMock.mockResolvedValue(0)
    vdcCountMock.mockResolvedValue(1)

    expect(await readJson(await callRoute(GET))).toEqual({ setupRequired: false, connectionsConfigured: true })
    expect(vdcCountMock).toHaveBeenCalledWith({ where: { tenantId: "tenant-a", enabled: true } })
  })

  it("falls back to the setup answer, still without counts, when the database cannot be read", async () => {
    userCountMock.mockRejectedValue(new Error("db down"))

    const res = await callRoute(GET)

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ setupRequired: true, connectionsConfigured: false })
  })
})
