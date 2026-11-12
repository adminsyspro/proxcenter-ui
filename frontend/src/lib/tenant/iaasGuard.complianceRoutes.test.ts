import { beforeEach, describe, expect, it, vi } from "vitest"

import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { callRoute } from "@/__tests__/setup/route-test"

// roadmap#224: the compliance routes keyed by a connection read the whole
// cluster (every node, every guest, PVE users, certificates) and audit every
// node over SSH. verifyConnectionOwnership() hands an IaaS tenant the
// provider connection its vDC is bound to, so these routes ask iaasGuard
// first: 404 { error: "Not found" } to an IaaS tenant with no call to PVE,
// SSH, the database or the renderer. A new compliance route fails the first
// test until it is classified.
const h = vi.hoisted(() => {
  const prismaCalls: string[] = []
  const prisma = new Proxy({}, {
    get: (_t, model) => new Proxy({}, {
      get: (_m, op) => (..._a: unknown[]) => {
        prismaCalls.push(`${String(model)}.${String(op)}`)
        // The MSP gate reads its tenant row: an enabled tenant.
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
    verifyConnectionOwnership: vi.fn(),
    getConnectionById: vi.fn(),
    getSessionPrisma: vi.fn(),
    collectHardeningData: vi.fn(),
    requireEnterprise: vi.fn(),
    renderPdf: vi.fn(),
    fetch: vi.fn(),
  }
})

vi.mock("@/lib/auth/principal", () => ({
  getPrincipal: (...a: any[]) => h.getPrincipal(...a),
  rejectionToResponse: (r: any) => new Response(JSON.stringify(r?.body ?? {}), { status: r?.status ?? 401 }),
}))
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getTenantInfrastructureScope: (...a: any[]) => h.scope(...a),
}))
vi.mock("@/lib/tenant", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  userHasAccessToTenant: async () => true,
  getCurrentTenantId: async () => "tenant-x",
  verifyConnectionOwnership: (...a: any[]) => h.verifyConnectionOwnership(...a),
  getSessionPrisma: (...a: any[]) => h.getSessionPrisma(...a),
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }))
vi.mock("@/lib/rbac", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  checkPermission: (...a: any[]) => h.checkPermission(...a),
}))
vi.mock("@/lib/connections/getConnection", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getConnectionById: (...a: any[]) => h.getConnectionById(...a),
}))
vi.mock("@/lib/compliance/collectHardeningData", () => ({
  collectHardeningData: (...a: any[]) => h.collectHardeningData(...a),
}))
vi.mock("@/lib/auth/requireEnterprise", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  requireEnterprise: (...a: any[]) => h.requireEnterprise(...a),
}))
vi.mock("@/lib/reporting/weasyprintClient", () => ({ renderPdf: (...a: any[]) => h.renderPdf(...a) }))
vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: () => null }))

/** Paths relative to src/app/api/v1/compliance. Every handler of these files is refused to an IaaS tenant. */
const DENIED_FILES = [
  "hardening/[connectionId]/route.ts",
  "frameworks/route.ts",
  "frameworks/[frameworkId]/report/route.ts",
]

/** Files that read no cluster or node, with what they read instead. */
const NO_CLUSTER_READ: Record<string, string> = {
  "profiles/route.ts": "the tenant's own compliance profiles (rows keyed by tenant)",
  "profiles/[profileId]/route.ts": "one of the tenant's own profiles",
  "profiles/[profileId]/activate/route.ts": "the tenant's active profile",
  "policies/route.ts": "the tenant's own security policies",
  "login-lockouts/route.ts": "login lockouts of ProxCenter accounts, no PVE call",
}

const COMPLIANCE = fileURLToPath(new URL("../../app/api/v1/compliance/", import.meta.url))

function routeFilesOnDisk(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === "route.ts") found.push(relative(COMPLIANCE, full).split(sep).join("/"))
    }
  }
  walk(COMPLIANCE)
  return found.sort()
}

const MODULES = import.meta.glob("../../app/api/v1/compliance/**/route.ts")
const load = (file: string) => MODULES[`../../app/api/v1/compliance/${file}`]() as Promise<Record<string, any>>

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
const SIDE_EFFECTS = ["verifyConnectionOwnership", "getConnectionById", "getSessionPrisma", "collectHardeningData", "renderPdf", "fetch"] as const

const IAAS_SESSION = { ok: true, principal: { kind: "session", userId: "u1", tenantId: "tenant-iaas", connectionIds: null } }
const IAAS_SCOPE = { kind: "iaas", vdcScope: { connectionIds: new Set(["conn-1"]), nodesByConnection: new Map([["conn-1", new Set(["pve1"])]]) } }
const PROVIDER = { ok: true, principal: { kind: "session", userId: "u1", tenantId: "default", connectionIds: null } }
const MSP = { ok: true, principal: { kind: "session", userId: "u2", tenantId: "tenant-msp", connectionIds: null } }

const deniedCases = async () => {
  const cases: Array<{ file: string; method: string }> = []
  for (const file of DENIED_FILES) {
    const mod = await load(file)
    for (const m of METHODS) if (typeof mod[m] === "function") cases.push({ file, method: m })
  }
  return cases
}

const call = async (c: { file: string; method: string }) => {
  const mod = await load(c.file)
  return callRoute(mod[c.method], {
    method: c.method as any,
    params: { connectionId: "conn-1", frameworkId: "cis-controls-v8-1" },
    searchParams: { connectionId: "conn-1", node: "pve1" },
  })
}

const arrange = (principal: unknown, scope: unknown) => {
  vi.clearAllMocks()
  h.prismaCalls.length = 0
  vi.stubGlobal("fetch", h.fetch)
  h.checkPermission.mockResolvedValue(null)
  h.requireEnterprise.mockResolvedValue(null)
  h.verifyConnectionOwnership.mockResolvedValue(null)
  h.getPrincipal.mockResolvedValue(principal)
  h.scope.mockResolvedValue(scope)
}

beforeEach(() => arrange(IAAS_SESSION, IAAS_SCOPE))

describe("compliance routes: every file is classified for IaaS tenants", () => {
  it("each route file on disk sits in exactly one class", () => {
    const onDisk = routeFilesOnDisk()
    expect(onDisk.length).toBeGreaterThanOrEqual(8)
    for (const file of onDisk) {
      const classes = [DENIED_FILES.includes(file) && "denied", file in NO_CLUSTER_READ && "no-cluster-read"].filter(Boolean)
      expect(classes, file).toHaveLength(1)
    }
    for (const file of [...DENIED_FILES, ...Object.keys(NO_CLUSTER_READ)]) expect(onDisk, file).toContain(file)
  })

  it("each denied file asks the guard in every handler it exports", async () => {
    for (const file of DENIED_FILES) {
      const source = readFileSync(join(COMPLIANCE, file), "utf8")
      const mod = await load(file)
      const handlers = METHODS.filter(m => typeof mod[m] === "function").length
      expect(source.match(/await denyIaasTenant\(\)/g)?.length ?? 0, file).toBeGreaterThanOrEqual(handlers)
    }
  })
})

describe("denied compliance routes refuse an IaaS tenant", () => {
  it("404 Not found, no PVE, SSH, database or renderer call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const c of await deniedCases()) {
      arrange(IAAS_SESSION, IAAS_SCOPE)
      const res = await call(c)
      const label = `${c.method} ${c.file}`
      expect(res.status, label).toBe(404)
      expect(await res.json(), label).toEqual({ error: "Not found" })
      for (const k of SIDE_EFFECTS) expect(h[k], `${label}: ${k}`).not.toHaveBeenCalled()
      expect(h.prismaCalls, label).toEqual([])
    }
  })

  it("the API token of an IaaS tenant and an unresolvable tenant are refused the same way", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const variants: Array<[string, () => void]> = [
      ["token", () => h.getPrincipal.mockResolvedValue({ ok: true, principal: { kind: "token", tokenId: "t1", tenantId: "tenant-iaas", connectionIds: null } })],
      ["scope lookup error", () => h.scope.mockRejectedValue(new Error("lookup failed"))],
      ["no tenant on the principal", () => h.getPrincipal.mockResolvedValue({ ok: true, principal: { kind: "session", userId: "u1", tenantId: null } })],
    ]
    for (const [variant, tweak] of variants) {
      for (const c of await deniedCases()) {
        arrange(IAAS_SESSION, IAAS_SCOPE)
        tweak()
        const res = await call(c)
        expect(res.status, `${variant}: ${c.method} ${c.file}`).toBe(404)
        expect(h.collectHardeningData).not.toHaveBeenCalled()
        expect(h.getConnectionById).not.toHaveBeenCalled()
      }
    }
  })

  it("a principal rejection is handed back as is", async () => {
    h.getPrincipal.mockResolvedValue({ ok: false, rejection: { status: 401, body: { error: "Not authenticated" } } })
    const res = await call({ file: "hardening/[connectionId]/route.ts", method: "GET" })
    expect(res.status).toBe(401)
    expect(h.collectHardeningData).not.toHaveBeenCalled()
  })
})

describe("denied compliance routes let the provider and an MSP through", () => {
  it.each([
    ["provider session", PROVIDER, { kind: "provider" }],
    ["msp session", MSP, { kind: "msp", connectionIds: new Set(["conn-1"]) }],
  ])("%s: every denied handler goes past the guard to its own ownership check", async (_label, principal, scope) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const c of await deniedCases()) {
      arrange(principal, scope)
      h.verifyConnectionOwnership.mockResolvedValue(new Response(JSON.stringify({ error: "Connection not found" }), { status: 404 }))
      const res = await call(c)
      const label = `${c.method} ${c.file}`
      expect(h.verifyConnectionOwnership, label).toHaveBeenCalledWith("conn-1")
      expect(await res.json(), label).toEqual({ error: "Connection not found" })
    }
  })
})
