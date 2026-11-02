import { beforeEach, describe, expect, it, vi } from "vitest"

import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { callRoute } from "@/__tests__/setup/route-test"

// Every Ceph route answers 404 { error: "Not found" } to an IaaS tenant, with
// NO call to PVE, SSH, the database, the orchestrator or the network. The real
// guard runs here: only the principal and the tenant scope are mocked, then
// every side-effecting dependency of the routes is a recording spy.
const h = vi.hoisted(() => {
  const prismaCalls: string[] = []
  const prisma = new Proxy({}, {
    get: (_t, model) => new Proxy({}, {
      get: (_m, op) => (..._a: unknown[]) => {
        prismaCalls.push(`${String(model)}.${String(op)}`)
        // The guard's check of an msp session: its tenant is enabled.
        return Promise.resolve(String(model) === "tenant" ? { enabled: true } : null)
      },
    }),
  })
  return {
    prismaCalls,
    prisma,
    getPrincipal: vi.fn(),
    scope: vi.fn(),
    checkPermission: vi.fn(),
    getConnectionById: vi.fn(),
    pveFetch: vi.fn(),
    executeSSH: vi.fn(),
    resolveNodeSshEndpoint: vi.fn(),
    getSessionPrisma: vi.fn(),
    getTenantConnectionIds: vi.fn(),
    getOrchestratorClient: vi.fn(),
    getServerLicense: vi.fn(),
    decryptSecret: vi.fn(),
    audit: vi.fn(),
    fetch: vi.fn(),
  }
})

vi.mock("@/lib/auth/principal", () => ({
  getPrincipal: (...a: any[]) => h.getPrincipal(...a),
  rejectionToResponse: (r: any) => new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 401 }),
}))
vi.mock("@/lib/tenant/infraScope", () => ({
  getTenantInfrastructureScope: (...a: any[]) => h.scope(...a),
}))
vi.mock("@/lib/tenant", () => ({
  userHasAccessToTenant: async () => true,
  getSessionPrisma: (...a: any[]) => h.getSessionPrisma(...a),
  getTenantConnectionIds: (...a: any[]) => h.getTenantConnectionIds(...a),
  getCurrentTenantId: () => { throw new Error("getCurrentTenantId must not decide the Ceph guard") },
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }))
vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: any[]) => h.checkPermission(...a),
  buildNodeResourceId: (c: string, n: string) => `${c}:${n}`,
  PERMISSIONS: new Proxy({}, { get: (_t, k) => String(k) }),
}))
vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: (...a: any[]) => h.getConnectionById(...a),
  isConnectionNotFoundError: () => false,
}))
vi.mock("@/lib/proxmox/client", () => ({ pveFetch: (...a: any[]) => h.pveFetch(...a) }))
vi.mock("@/lib/ssh/exec", () => ({ executeSSH: (...a: any[]) => h.executeSSH(...a) }))
vi.mock("@/lib/ssh/node-endpoint", () => ({
  resolveNodeSshEndpoint: (...a: any[]) => h.resolveNodeSshEndpoint(...a),
  formatSshEndpoint: () => "endpoint",
}))
vi.mock("@/lib/orchestrator/client", () => ({ getOrchestratorClient: (...a: any[]) => h.getOrchestratorClient(...a) }))
vi.mock("@/lib/auth/requireEnterprise", () => ({ getServerLicense: (...a: any[]) => h.getServerLicense(...a) }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: (...a: any[]) => h.decryptSecret(...a) }))
vi.mock("@/lib/audit", () => ({ audit: (...a: any[]) => h.audit(...a) }))
vi.mock("@/lib/audit/withAudit", () => ({ withAudit: (_o: unknown, handler: unknown) => handler }))

type Method = "GET" | "POST" | "PUT" | "DELETE"
type Case = {
  name: string
  /** Route file, relative to src/app/api/v1. */
  file: string
  load: () => Promise<Record<string, any>>
  method: Method
  params: Record<string, string>
  body?: Record<string, unknown>
  searchParams?: Record<string, string>
}

const C = { id: "conn-1" }
const N = { id: "conn-1", node: "pve1" }
const O = { id: "conn-1", node: "pve1", osdid: "3" }

const CASES: Case[] = [
  { name: "ceph GET", file: "connections/[id]/ceph/route.ts", load: () => import("@/app/api/v1/connections/[id]/ceph/route"), method: "GET", params: C },
  { name: "ceph/crush GET", file: "connections/[id]/ceph/crush/route.ts", load: () => import("@/app/api/v1/connections/[id]/ceph/crush/route"), method: "GET", params: C },
  { name: "ceph/exporter GET", file: "connections/[id]/ceph/exporter/route.ts", load: () => import("@/app/api/v1/connections/[id]/ceph/exporter/route"), method: "GET", params: C, searchParams: { nodes: "pve1" } },
  { name: "ceph/flags GET", file: "connections/[id]/ceph/flags/route.ts", load: () => import("@/app/api/v1/connections/[id]/ceph/flags/route"), method: "GET", params: C },
  { name: "ceph/flags PUT", file: "connections/[id]/ceph/flags/route.ts", load: () => import("@/app/api/v1/connections/[id]/ceph/flags/route"), method: "PUT", params: C, body: { flag: "noout" } },
  { name: "ceph/flags DELETE (host)", file: "connections/[id]/ceph/flags/route.ts", load: () => import("@/app/api/v1/connections/[id]/ceph/flags/route"), method: "DELETE", params: C, body: { flag: "noout", host: "pve1" } },
  { name: "ceph/live GET", file: "connections/[id]/ceph/live/route.ts", load: () => import("@/app/api/v1/connections/[id]/ceph/live/route"), method: "GET", params: C },
  { name: "ceph/status GET", file: "connections/[id]/ceph/status/route.ts", load: () => import("@/app/api/v1/connections/[id]/ceph/status/route"), method: "GET", params: C },
  { name: "detect-ceph POST", file: "connections/[id]/detect-ceph/route.ts", load: () => import("@/app/api/v1/connections/[id]/detect-ceph/route"), method: "POST", params: C },
  { name: "nodes/ceph GET", file: "connections/[id]/nodes/[node]/ceph/route.ts", load: () => import("@/app/api/v1/connections/[id]/nodes/[node]/ceph/route"), method: "GET", params: N },
  { name: "nodes/ceph/create POST", file: "connections/[id]/nodes/[node]/ceph/create/route.ts", load: () => import("@/app/api/v1/connections/[id]/nodes/[node]/ceph/create/route"), method: "POST", params: N, body: { kind: "mgr" } },
  { name: "nodes/ceph/exporter GET", file: "connections/[id]/nodes/[node]/ceph/exporter/route.ts", load: () => import("@/app/api/v1/connections/[id]/nodes/[node]/ceph/exporter/route"), method: "GET", params: N, searchParams: { osd: "3" } },
  { name: "nodes/ceph/noout GET", file: "connections/[id]/nodes/[node]/ceph/noout/route.ts", load: () => import("@/app/api/v1/connections/[id]/nodes/[node]/ceph/noout/route"), method: "GET", params: N },
  { name: "nodes/ceph/noout POST", file: "connections/[id]/nodes/[node]/ceph/noout/route.ts", load: () => import("@/app/api/v1/connections/[id]/nodes/[node]/ceph/noout/route"), method: "POST", params: N },
  { name: "nodes/ceph/noout DELETE", file: "connections/[id]/nodes/[node]/ceph/noout/route.ts", load: () => import("@/app/api/v1/connections/[id]/nodes/[node]/ceph/noout/route"), method: "DELETE", params: N },
  { name: "nodes/ceph/service POST", file: "connections/[id]/nodes/[node]/ceph/service/route.ts", load: () => import("@/app/api/v1/connections/[id]/nodes/[node]/ceph/service/route"), method: "POST", params: N, body: { action: "restart", service: "osd.3" } },
  { name: "nodes/ceph/osd POST", file: "connections/[id]/nodes/[node]/ceph/osd/[osdid]/route.ts", load: () => import("@/app/api/v1/connections/[id]/nodes/[node]/ceph/osd/[osdid]/route"), method: "POST", params: O, body: { action: "out" } },
  { name: "nodes/ceph/osd/ok-to-stop POST", file: "connections/[id]/nodes/[node]/ceph/osd/[osdid]/ok-to-stop/route.ts", load: () => import("@/app/api/v1/connections/[id]/nodes/[node]/ceph/osd/[osdid]/ok-to-stop/route"), method: "POST", params: O },
  { name: "orchestrator ceph history GET", file: "orchestrator/ceph/[connectionId]/history/route.ts", load: () => import("@/app/api/v1/orchestrator/ceph/[connectionId]/history/route"), method: "GET", params: { connectionId: "conn-1" }, searchParams: { range: "1h" } },
]

const API_V1 = fileURLToPath(new URL("../../app/api/v1/", import.meta.url))

/** Every route.ts under src/app/api whose path names Ceph, relative to src/app/api/v1. */
function cephRouteFiles(): string[] {
  const apiRoot = fileURLToPath(new URL("../../app/api/", import.meta.url))
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === "route.ts" && /ceph/i.test(relative(apiRoot, full))) found.push(full)
    }
  }
  walk(apiRoot)
  return found.map(f => relative(API_V1, f).split(sep).join("/")).sort()
}

const SIDE_EFFECTS = [
  "getConnectionById", "pveFetch", "executeSSH", "resolveNodeSshEndpoint", "getSessionPrisma",
  "getTenantConnectionIds", "getOrchestratorClient", "getServerLicense", "decryptSecret", "audit", "fetch",
] as const

beforeEach(() => {
  vi.clearAllMocks()
  h.prismaCalls.length = 0
  vi.stubGlobal("fetch", h.fetch)
  h.checkPermission.mockResolvedValue(null)
  h.getPrincipal.mockResolvedValue({
    ok: true,
    principal: { kind: "session", userId: "u1", tenantId: "tenant-iaas", connectionIds: null },
  })
  h.scope.mockResolvedValue({ kind: "iaas", vdcScope: { connectionIds: new Set(["conn-1"]) } })
})

describe("Ceph routes refuse an IaaS tenant", () => {
  it("every Ceph route file on disk calls the guard and is exercised here", () => {
    const onDisk = cephRouteFiles()

    // The 15 route files of G20 at least; a new one fails here until it is
    // gated and listed in CASES.
    expect(onDisk.length).toBeGreaterThanOrEqual(15)
    expect([...new Set(CASES.map(c => c.file))].sort()).toEqual(onDisk)
    for (const file of onDisk) {
      const source = readFileSync(join(API_V1, file), "utf8")
      expect(source, file).toMatch(/await denyIaasTenantCeph\(\)/)
    }
  })

  it.each(CASES)("$name: 404 Not found, no PVE, SSH, database or network call", async (c) => {
    const mod = await c.load()
    const handler = mod[c.method]
    expect(typeof handler).toBe("function")

    const res = await callRoute(handler, { method: c.method, params: c.params, body: c.body as any, searchParams: c.searchParams })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: "Not found" })
    expect(h.checkPermission).toHaveBeenCalled()
    for (const k of SIDE_EFFECTS) expect(h[k], k).not.toHaveBeenCalled()
    expect(h.prismaCalls).toEqual([])
  })

  it.each(CASES)("$name: the API token of an IaaS tenant is refused the same way", async (c) => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: { kind: "token", tokenId: "t1", tenantId: "tenant-iaas", connectionIds: null } })
    const mod = await c.load()
    const res = await callRoute(mod[c.method], { method: c.method, params: c.params, body: c.body as any, searchParams: c.searchParams })
    expect(res.status).toBe(404)
    expect(h.pveFetch).not.toHaveBeenCalled()
    expect(h.executeSSH).not.toHaveBeenCalled()
    expect(h.fetch).not.toHaveBeenCalled()
  })

  it.each(CASES)("$name: an unresolvable tenant scope refuses too (fail closed)", async (c) => {
    h.scope.mockRejectedValue(new Error("lookup failed"))
    const mod = await c.load()
    const res = await callRoute(mod[c.method], { method: c.method, params: c.params, body: c.body as any, searchParams: c.searchParams })
    expect(res.status).toBe(404)
    expect(h.getConnectionById).not.toHaveBeenCalled()
    expect(h.pveFetch).not.toHaveBeenCalled()
  })

  it.each(CASES)("$name: a permission refusal still wins before the tenant gate", async (c) => {
    h.checkPermission.mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }))
    const mod = await c.load()
    const res = await callRoute(mod[c.method], { method: c.method, params: c.params, body: c.body as any, searchParams: c.searchParams })
    expect(res.status).toBe(403)
    expect(h.getPrincipal).not.toHaveBeenCalled()
  })
})

describe("Ceph routes let the provider and an msp through the real guard", () => {
  const PROVIDER = { ok: true, principal: { kind: "session", userId: "u1", tenantId: "default", connectionIds: null } }
  const MSP_SESSION = { ok: true, principal: { kind: "session", userId: "u2", tenantId: "tenant-msp", connectionIds: null } }
  const MSP_TOKEN = { ok: true, principal: { kind: "token", tokenId: "t1", tenantId: "tenant-msp", connectionIds: null } }

  it.each([
    ["provider session", PROVIDER, { kind: "provider" }],
    ["msp session", MSP_SESSION, { kind: "msp", connectionIds: new Set(["conn-1"]) }],
    ["msp token", MSP_TOKEN, { kind: "msp", connectionIds: new Set(["conn-1"]) }],
  ])("%s: every route goes past the guard to its own work", async (_label, principal, scope) => {
    h.getPrincipal.mockResolvedValue(principal)
    h.scope.mockResolvedValue(scope)
    vi.spyOn(console, "error").mockImplementation(() => {})

    for (const c of CASES) {
      vi.clearAllMocks()
      h.checkPermission.mockResolvedValue(null)
      h.getPrincipal.mockResolvedValue(principal)
      h.scope.mockResolvedValue(scope)
      const mod = await c.load()
      await callRoute(mod[c.method], { method: c.method, params: c.params, body: c.body as any, searchParams: c.searchParams })

      expect(h.scope, c.name).toHaveBeenCalled()
      expect(SIDE_EFFECTS.some(k => h[k].mock.calls.length > 0), `${c.name} reached no dependency`).toBe(true)
    }
  })

  it("provider: /ceph/live reaches Proxmox and answers 200", async () => {
    h.getPrincipal.mockResolvedValue(PROVIDER)
    h.scope.mockResolvedValue({ kind: "provider" })
    h.getConnectionById.mockResolvedValue({ id: "conn-1", baseUrl: "https://pve.invalid:8006", apiToken: "t" })
    h.pveFetch.mockResolvedValue({ health: { status: "HEALTH_OK", checks: {} }, pgmap: {}, osdmap: {} })

    const mod = await import("@/app/api/v1/connections/[id]/ceph/live/route")
    const res = await callRoute(mod.GET, { method: "GET", params: C })

    expect(h.pveFetch).toHaveBeenCalledWith(expect.anything(), "/cluster/ceph/status")
    expect(res.status).toBe(200)
  })
})
