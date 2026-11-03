import { beforeEach, describe, expect, it, vi } from "vitest"

import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { callRoute } from "@/__tests__/setup/route-test"

// An IaaS (vDC) tenant has no AI assistant: every AI route answers it 404
// before reading a setting or calling a model, the status says "off" so the
// widget never shows, and no reading of the resources page goes to a model.
// The real gate (lib/tenant/iaasGuard) runs; only the principal and the
// tenant scope are mocked.
const h = vi.hoisted(() => ({
  getPrincipal: vi.fn(),
  scope: vi.fn(),
  getSetting: vi.fn(),
  setSetting: vi.fn(),
  fetch: vi.fn(),
}))

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
}))
vi.mock("@/lib/db/prisma", () => ({
  prisma: new Proxy({}, { get: (_t, model) => new Proxy({}, { get: () => async () => (String(model) === "tenant" ? { enabled: true } : null) }) }),
}))
vi.mock("@/lib/rbac", async (orig) => ({ ...(await orig<Record<string, unknown>>()), checkPermission: async () => null }))
vi.mock("@/lib/auth/requireEnterprise", () => ({ requireFeature: async () => null, hasServerFeature: async () => true }))
vi.mock("@/lib/db/settings", () => ({
  getSetting: (...a: any[]) => h.getSetting(...a),
  setSetting: (...a: any[]) => h.setSetting(...a),
}))
vi.mock("@/lib/audit/withAudit", () => ({ withAudit: (_o: unknown, handler: unknown) => handler }))

const IAAS = { ok: true, principal: { kind: "session", userId: "u1", tenantId: "tenant-iaas", connectionIds: null } }
const PROVIDER = { ok: true, principal: { kind: "session", userId: "u1", tenantId: "default", connectionIds: null } }
const IAAS_SCOPE = { kind: "iaas", vdcScope: { connectionIds: new Set(["c1"]) } }

const V1 = fileURLToPath(new URL("../../app/api/v1/", import.meta.url))
const MODULES = import.meta.glob("../../app/api/v1/{ai,settings/ai,settings/ai-actions}/**/route.ts")
const load = (file: string) => MODULES[`../../app/api/v1/${file}`]() as Promise<Record<string, any>>

/** Every AI route file, relative to src/app/api/v1. */
function aiRouteFiles(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === "route.ts") found.push(relative(V1, full).split(sep).join("/"))
    }
  }
  for (const root of ["ai", "settings/ai", "settings/ai-actions"]) walk(join(V1, root))
  return [...new Set(found)].sort()
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
const STATUS = "ai/status/route.ts"

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal("fetch", h.fetch)
  h.getPrincipal.mockResolvedValue(IAAS)
  h.scope.mockResolvedValue(IAAS_SCOPE)
  h.getSetting.mockResolvedValue({ enabled: true, provider: "ollama", ollamaUrl: "http://llm:11434", ollamaModel: "m" })
})

describe("AI routes for an IaaS tenant", () => {
  it("every AI route file but the status asks the gate in each handler, directly or through openChatRequest", async () => {
    const files = aiRouteFiles()
    expect(files.length).toBeGreaterThanOrEqual(8)
    for (const file of files.filter(f => f !== STATUS)) {
      const source = readFileSync(join(V1, file), "utf8")
      const mod = await load(file)
      const handlers = METHODS.filter(m => typeof mod[m] === "function").length
      // The two chat routes ask it through their shared opening (lib/ai/chatRequest).
      const gates = (source.match(/await denyIaasTenant\(\)/g)?.length ?? 0) + (source.match(/await openChatRequest\(/g)?.length ?? 0)
      expect(gates, file).toBeGreaterThanOrEqual(handlers)
    }
  })

  it("404 Not found, no setting read or written, no model called", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const file of aiRouteFiles().filter(f => f !== STATUS)) {
      const mod = await load(file)
      for (const m of METHODS.filter(x => typeof mod[x] === "function")) {
        vi.clearAllMocks()
        h.getPrincipal.mockResolvedValue(IAAS)
        h.scope.mockResolvedValue(IAAS_SCOPE)
        const res = await callRoute(mod[m], { method: m, body: m === "GET" ? undefined : { messages: [{ role: "user", content: "hi" }] } })
        expect(res.status, `${m} ${file}`).toBe(404)
        expect(h.getSetting, `${m} ${file}`).not.toHaveBeenCalled()
        expect(h.setSetting, `${m} ${file}`).not.toHaveBeenCalled()
        expect(h.fetch, `${m} ${file}`).not.toHaveBeenCalled()
      }
    }
  })

  it("the status says off, whatever the tenant's own settings row holds", async () => {
    const mod = await load(STATUS)
    const res = await callRoute(mod.GET, { method: "GET" })
    expect(res.status).toBe(200)
    expect((await res.json()).data).toEqual({ enabled: false, provider: "ollama", model: null, actionsEnabled: false, actionKinds: [] })
    expect(h.getSetting).not.toHaveBeenCalled()
  })

  it("the provider's status still reads its own settings", async () => {
    h.getPrincipal.mockResolvedValue(PROVIDER)
    h.scope.mockResolvedValue({ kind: "provider" })
    const mod = await load(STATUS)
    const res = await callRoute(mod.GET, { method: "GET" })
    expect((await res.json()).data).toMatchObject({ enabled: true, model: "m" })
    expect(h.getSetting).toHaveBeenCalledWith("ai", "default")
  })
})

describe("resolveAiTarget", () => {
  it("no model for an IaaS tenant, nor for a tenant that cannot be resolved", async () => {
    const { resolveAiTarget } = await import("./complete")
    expect(await resolveAiTarget("tenant-iaas")).toBeNull()
    h.scope.mockRejectedValue(new Error("db down"))
    expect(await resolveAiTarget("tenant-x")).toBeNull()
    expect(h.getSetting).not.toHaveBeenCalled()
  })

  it("the provider and an MSP keep their model", async () => {
    const { resolveAiTarget } = await import("./complete")
    expect(await resolveAiTarget("default")).toMatchObject({ provider: "ollama", model: "m" })
    expect(h.scope).not.toHaveBeenCalled()
    h.scope.mockResolvedValue({ kind: "msp", connectionIds: new Set() })
    expect(await resolveAiTarget("tenant-msp")).toMatchObject({ provider: "ollama", model: "m" })
  })
})
