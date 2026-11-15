import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ denied: null as any, prisma: { connection: { findUnique: vi.fn() } } }))

vi.mock("@/lib/tenant", () => ({ getSessionPrisma: vi.fn(async () => h.prisma) }))
vi.mock("@/lib/rbac", () => ({ checkPermission: vi.fn(async () => h.denied), PERMISSIONS: { VM_MIGRATE: "vm.migrate" } }))

import { GET } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const read = (query: Record<string, string> = { sourceConnectionId: "src" }) => callRoute(GET, { method: "GET", searchParams: query })

beforeEach(() => {
  h.denied = null
  h.prisma.connection.findUnique.mockReset().mockResolvedValue({ migrationSyncIntervalSec: 3600 })
})

describe("GET /api/v1/migrations/sync-interval", () => {
  it("answers the setting of the source connection, read through the caller's tenant", async () => {
    expect(await readJson<any>(await read())).toEqual({ data: { defaultSyncIntervalSec: 3600 } })
    expect(h.prisma.connection.findUnique).toHaveBeenCalledWith({ where: { id: "src" }, select: { migrationSyncIntervalSec: true } })
  })

  it("answers one minute for a connection without a setting, or one the caller's tenant does not hold", async () => {
    h.prisma.connection.findUnique.mockResolvedValue(null)
    expect((await readJson<any>(await read())).data.defaultSyncIntervalSec).toBe(60)
  })

  it("asks for the source connection", async () => {
    expect((await read({})).status).toBe(400)
  })

  it("answers the permission refusal as is", async () => {
    h.denied = new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 })
    expect((await read()).status).toBe(403)
    expect(h.prisma.connection.findUnique).not.toHaveBeenCalled()
  })
})
