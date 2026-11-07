import { beforeEach, describe, expect, it, vi } from "vitest"

import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { callRoute } from "@/__tests__/setup/route-test"

// The firewall and CVE routes are keyed by a PVE connection outside
// connections/, so an IaaS tenant reaches them through its vDC binding like
// the routes iaasGuard.routes.test.ts classifies. Same contract: a route that
// reads or acts on the datacenter or a node as a whole answers 404
// { error: "Not found" } to an IaaS tenant with no call to PVE, the
// orchestrator, the database or the network; a new route file fails the
// first test until it is classified.
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
  const orchestrator = { get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }
  return {
    prismaCalls,
    prisma,
    orchestrator,
    getPrincipal: vi.fn(),
    scope: vi.fn(),
    checkPermission: vi.fn(),
    verifyConnectionOwnership: vi.fn(),
    getConnectionById: vi.fn(),
    pveFetch: vi.fn(),
    pveDirect: vi.fn(),
    orchestratorOrPve: vi.fn(),
    getOrchestratorClient: vi.fn(() => orchestrator),
    guardSessionGuest: vi.fn(),
    tenantGuestVisibility: vi.fn(),
    audit: vi.fn(),
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
  verifyConnectionOwnership: (...a: any[]) => h.verifyConnectionOwnership(...a),
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
vi.mock("@/lib/proxmox/client", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  pveFetch: (...a: any[]) => h.pveFetch(...a),
}))
vi.mock("@/lib/firewall/pveDirect", () => new Proxy({}, {
  get: (_t, fn) => (fn === "then" ? undefined : (...a: unknown[]) => h.pveDirect(String(fn), ...a)),
}))
vi.mock("@/lib/firewall/withPveFallback", () => ({
  orchestratorOrPve: (...a: any[]) => h.orchestratorOrPve(...a),
}))
vi.mock("@/lib/orchestrator/client", () => ({
  getOrchestratorClient: () => h.getOrchestratorClient(),
  orchestratorFetch: (...a: any[]) => h.orchestrator.get(...a),
}))
vi.mock("@/lib/orchestrator/headers", () => ({ orchestratorHeaders: async () => ({}) }))
vi.mock("@/lib/vdc/guestGuard", () => ({ guardSessionGuest: (...a: any[]) => h.guardSessionGuest(...a) }))
vi.mock("@/lib/vdc/guestScope", () => ({ tenantGuestVisibility: (...a: any[]) => h.tenantGuestVisibility(...a) }))
vi.mock("@/lib/audit", () => ({ audit: (...a: any[]) => h.audit(...a) }))
vi.mock("@/lib/audit/withAudit", () => ({ withAudit: (_o: unknown, handler: unknown) => handler }))
vi.mock("@/lib/api-tokens/routeGuard", () => ({ withPublicApiGuard: (_id: unknown, handler: unknown) => handler }))

/** Paths relative to src/app/api/v1. Every handler of these files is refused. */
const DENIED_FILES = [
  "cve/[connectionId]/route.ts",
  "firewall/route.ts",
  "firewall/aliases/[connectionId]/[name]/route.ts",
  "firewall/cluster/[connectionId]/route.ts",
  "firewall/cluster/[connectionId]/rules/route.ts",
  "firewall/cluster/[connectionId]/rules/[pos]/route.ts",
  "firewall/groups/[connectionId]/[groupName]/route.ts",
  "firewall/groups/[connectionId]/[groupName]/rules/route.ts",
  "firewall/groups/[connectionId]/[groupName]/rules/[pos]/route.ts",
  "firewall/ipsets/[connectionId]/[ipsetName]/route.ts",
  "firewall/ipsets/[connectionId]/[ipsetName]/entries/route.ts",
  "firewall/ipsets/[connectionId]/[ipsetName]/entries/[cidr]/route.ts",
  "firewall/microseg/[connectionId]/analyze/route.ts",
  "firewall/microseg/[connectionId]/generate-base/route.ts",
  "firewall/microseg/[connectionId]/vms/route.ts",
  "firewall/nodes/[connectionId]/[node]/route.ts",
  "firewall/nodes/[connectionId]/[node]/rules/route.ts",
  "firewall/nodes/[connectionId]/[node]/rules/[pos]/route.ts",
]

/**
 * Datacenter firewall objects a guest rule references by name: the list is
 * narrowed to the names for an IaaS tenant, the writes are refused.
 */
const NAMES_VIEW: Record<string, { key: "name" | "group"; denied: string[] }> = {
  "firewall/aliases/[connectionId]/route.ts": { key: "name", denied: ["POST"] },
  "firewall/groups/[connectionId]/route.ts": { key: "group", denied: ["POST"] },
  "firewall/ipsets/[connectionId]/route.ts": { key: "name", denied: ["POST"] },
}

/** The log of one guest stays open (guest scope); node, cluster and group logs are refused. */
const LOGS = "firewall/logs/[connectionId]/route.ts"

/** Prefixes of whole subtrees with their own guard. */
const SUBTREE_GUARDS: Array<[RegExp, string]> = [
  [/^firewall\/vms\//, "guest firewall: guest scope of the vDC (lib/vdc/guestGuard)"],
  [/^firewall\/microseg\/\[connectionId\]\/vm\//, "guest microsegmentation: guest scope of the vDC (lib/vdc/guestGuard)"],
]

const API = fileURLToPath(new URL("../../app/api/v1/", import.meta.url))

function routeFilesOnDisk(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === "route.ts") found.push(relative(API, full).split(sep).join("/"))
    }
  }
  walk(join(API, "firewall"))
  walk(join(API, "cve"))
  return found.sort()
}

const MODULES = {
  ...import.meta.glob("../../app/api/v1/firewall/**/route.ts"),
  ...import.meta.glob("../../app/api/v1/cve/**/route.ts"),
}
const load = (file: string) => MODULES[`../../app/api/v1/${file}`]() as Promise<Record<string, any>>

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
const PARAMS = { connectionId: "conn-1", node: "pve1", pos: "0", groupName: "web", name: "dns1", ipsetName: "admins", cidr: "192.0.2.1" }
const SIDE_EFFECTS = [
  "verifyConnectionOwnership", "getConnectionById", "pveFetch", "pveDirect", "orchestratorOrPve", "getOrchestratorClient", "audit", "fetch",
] as const

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
  for (const [file, { denied }] of Object.entries(NAMES_VIEW)) for (const m of denied) cases.push({ file, method: m })
  for (const scope of ["node", "cluster", "group"]) cases.push({ file: `${LOGS}?scope=${scope}`, method: "GET" })
  return cases
}

const call = async (c: { file: string; method: string }) => {
  const [file, query] = c.file.split("?")
  const mod = await load(file)
  const searchParams = Object.fromEntries(new URLSearchParams(query ?? ""))
  return callRoute(mod[c.method], {
    method: c.method as any,
    params: PARAMS,
    // firewall/route.ts takes the connection from the query string.
    searchParams: { ...searchParams, connectionId: "conn-1", node: "pve1", group: "web" },
    body: c.method === "GET" ? undefined : {},
  })
}

const arrange = (principal: unknown, scope: unknown) => {
  vi.clearAllMocks()
  h.prismaCalls.length = 0
  vi.stubGlobal("fetch", h.fetch)
  h.getOrchestratorClient.mockImplementation(() => h.orchestrator)
  h.checkPermission.mockResolvedValue(null)
  h.verifyConnectionOwnership.mockResolvedValue(null)
  h.guardSessionGuest.mockResolvedValue(null)
  h.getPrincipal.mockResolvedValue(principal)
  h.scope.mockResolvedValue(scope)
}

beforeEach(() => arrange(IAAS_SESSION, IAAS_SCOPE))

describe("firewall and CVE routes: every file is classified for IaaS tenants", () => {
  it("each route file on disk sits in exactly one class", () => {
    const onDisk = routeFilesOnDisk()
    expect(onDisk.length).toBeGreaterThan(25)
    for (const file of onDisk) {
      const classes = [
        DENIED_FILES.includes(file) && "denied",
        file in NAMES_VIEW && "names",
        file === LOGS && "logs",
        SUBTREE_GUARDS.some(([re]) => re.test(file)) && "subtree",
      ].filter(Boolean)
      expect(classes, file).toHaveLength(1)
    }
    for (const file of [...DENIED_FILES, ...Object.keys(NAMES_VIEW), LOGS]) expect(onDisk, file).toContain(file)
  })

  it("each denied file asks the guard in every handler it exports", async () => {
    for (const file of DENIED_FILES) {
      const source = readFileSync(join(API, file), "utf8")
      const mod = await load(file)
      const handlers = METHODS.filter(m => typeof mod[m] === "function").length
      expect(source.match(/await denyIaasTenant\(\)/g)?.length ?? 0, file).toBeGreaterThanOrEqual(handlers)
    }
  })
})

describe("denied firewall and CVE routes refuse an IaaS tenant", () => {
  it("404 Not found, no PVE, orchestrator, database or network call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const c of await deniedCases()) {
      arrange(IAAS_SESSION, IAAS_SCOPE)
      const res = await call(c)
      const label = `${c.method} ${c.file}`
      expect(res.status, label).toBe(404)
      expect(await res.json(), label).toEqual({ error: "Not found" })
      for (const k of SIDE_EFFECTS) expect(h[k], `${label}: ${k}`).not.toHaveBeenCalled()
      expect(h.orchestrator.get, label).not.toHaveBeenCalled()
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
        expect(h.orchestratorOrPve).not.toHaveBeenCalled()
        expect(h.fetch).not.toHaveBeenCalled()
      }
    }
  })

  it("a principal rejection is handed back as is", async () => {
    h.getPrincipal.mockResolvedValue({ ok: false, rejection: { status: 401, body: { error: "Not authenticated" } } })
    const res = await call({ file: "firewall/cluster/[connectionId]/route.ts", method: "GET" })
    expect(res.status).toBe(401)
    expect(h.orchestratorOrPve).not.toHaveBeenCalled()
  })
})

describe("denied firewall and CVE routes let the provider and an MSP through", () => {
  it.each([
    ["provider session", PROVIDER, { kind: "provider" }],
    ["msp session", MSP, { kind: "msp", connectionIds: new Set(["conn-1"]) }],
  ])("%s: every denied handler goes past the guard to its own checks", async (_label, principal, scope) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const c of await deniedCases()) {
      arrange(principal, scope)
      h.checkPermission.mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }))
      const res = await call(c)
      const label = `${c.method} ${c.file}`
      expect(res.status, label).toBe(403)
      expect(h.verifyConnectionOwnership, label).toHaveBeenCalledWith("conn-1")
    }
  })
})

describe("aliases, IP sets and security groups as an IaaS tenant sees them", () => {
  const ROWS: Record<string, unknown[]> = {
    name: [
      { name: "dns1", cidr: "192.0.2.53", comment: "Primary DNS", digest: "d1" },
      { name: "admins", comment: "Admin workstations", members: [{ cidr: "192.0.2.10" }] },
      { cidr: "192.0.2.99" },
    ],
    group: [{ group: "web", comment: "Web tier", digest: "d2", rules: [{ action: "ACCEPT", dport: "443" }] }],
  }

  it.each(Object.entries(NAMES_VIEW))("%s: names only for an IaaS tenant", async (file, { key }) => {
    h.orchestratorOrPve.mockResolvedValue(ROWS[key])
    const res = await call({ file, method: "GET" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual(key === "group" ? [{ group: "web" }] : [{ name: "dns1" }, { name: "admins" }])
  })

  it.each(Object.entries(NAMES_VIEW))("%s: the full objects for the provider", async (file, { key }) => {
    arrange(PROVIDER, { kind: "provider" })
    h.orchestratorOrPve.mockResolvedValue(ROWS[key])
    const res = await call({ file, method: "GET" })
    expect(await res.json()).toEqual(ROWS[key])
  })

  it("an unresolvable tenant gets 404 before anything is read", async () => {
    h.scope.mockRejectedValue(new Error("lookup failed"))
    const res = await call({ file: "firewall/groups/[connectionId]/route.ts", method: "GET" })
    expect(res.status).toBe(404)
    expect(h.orchestratorOrPve).not.toHaveBeenCalled()
  })
})

describe("firewall log of a guest", () => {
  it("an IaaS tenant goes past the guard to the guest scope check", async () => {
    h.guardSessionGuest.mockResolvedValue(new Response(JSON.stringify({ error: "Not found" }), { status: 404 }))
    const res = await callRoute((await load(LOGS)).GET, {
      method: "GET",
      params: PARAMS,
      searchParams: { scope: "vm", node: "pve1", vmType: "qemu", vmid: "100" },
    })
    expect(res.status).toBe(404)
    expect(h.verifyConnectionOwnership).toHaveBeenCalledWith("conn-1")
    expect(h.guardSessionGuest).toHaveBeenCalledWith(expect.objectContaining({ connectionId: "conn-1", node: "pve1", vmid: "100" }))
    expect(h.orchestrator.get).not.toHaveBeenCalled()
  })
})

const GUEST = "firewall/microseg/[connectionId]/vm/[node]/[vmType]/[vmid]"
const GUEST_PARAMS = { connectionId: "conn-1", node: "pve3", vmType: "lxc", vmid: "106" }

describe("isolation simulation of a guest", () => {
  const SIMULATION = {
    vmid: 106,
    affected_vms: [
      { vmid: 107, name: "own-db", node: "pve2", network: "net-web" },
      { vmid: 7201, name: "acme-web-01", node: "pve3", network: "net-web" },
    ],
  }
  const simulate = async () =>
    callRoute((await load(`${GUEST}/simulate/route.ts`)).GET, { method: "GET", params: GUEST_PARAMS })

  it("an IaaS tenant sees only its own guests among the affected ones", async () => {
    h.orchestrator.get.mockResolvedValue({ data: structuredClone(SIMULATION) })
    h.tenantGuestVisibility.mockResolvedValue({ all: false, has: (_t: string | null, vmid: string | number) => String(vmid) === "107" })
    const res = await simulate()
    expect(res.status).toBe(200)
    expect((await res.json()).affected_vms).toEqual([SIMULATION.affected_vms[0]])
    expect(h.tenantGuestVisibility).toHaveBeenCalledWith("tenant-iaas", undefined, "conn-1", { infra: IAAS_SCOPE })
  })

  it("nothing unverified: the visibility lookup's refusal is handed back", async () => {
    h.orchestrator.get.mockResolvedValue({ data: structuredClone(SIMULATION) })
    h.tenantGuestVisibility.mockResolvedValue(new (await import("next/server")).NextResponse(null, { status: 503 }))
    expect((await simulate()).status).toBe(503)
  })

  it("the provider gets the simulation as the orchestrator built it", async () => {
    arrange(PROVIDER, { kind: "provider" })
    h.orchestrator.get.mockResolvedValue({ data: structuredClone(SIMULATION) })
    expect(await (await simulate()).json()).toEqual(SIMULATION)
    expect(h.tenantGuestVisibility).not.toHaveBeenCalled()
  })
})

describe("isolating its own guest from an IaaS tenant session", () => {
  const isolate = async (body: Record<string, unknown>) =>
    callRoute((await load(`${GUEST}/isolate/route.ts`)).POST, { method: "POST", params: GUEST_PARAMS, body })
  const REFUSED = { error: "Cluster-level object not available to a vDC tenant" }

  beforeEach(() => {
    h.orchestratorOrPve.mockResolvedValue([{ group: "sg-web" }, { group: "sg-base-web" }])
    h.orchestrator.post.mockResolvedValue({ data: { success: true } })
  })

  it.each(["apply_base_sgs", "Apply_Base_SGs", "apply_baſe_sgs"])("%s: 403, the orchestrator is not reached", async key => {
    const res = await isolate({ enable_firewall: true, [key]: true })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(REFUSED)
    expect(h.orchestrator.post).not.toHaveBeenCalled()
  })

  it("a group that does not exist yet (it would be created): 403", async () => {
    const res = await isolate({ additional_sgs: ["sg-web", "sg-base-dmz"] })
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual(REFUSED)
    expect(h.orchestrator.post).not.toHaveBeenCalled()
  })

  it("existing groups are applied, with only the known fields forwarded", async () => {
    const res = await isolate({ enable_firewall: true, additional_sgs: ["sg-web", "sg-base-web"], apply_base_sgs: false, extra: 1 })
    expect(res.status).toBe(200)
    expect(h.orchestrator.post).toHaveBeenCalledWith(
      "/firewall/microseg/conn-1/vm/pve3/lxc/106/isolate",
      { enable_firewall: true, additional_sgs: ["sg-web", "sg-base-web"], apply_base_sgs: false },
    )
  })

  it("a mistyped body: 400", async () => {
    expect((await isolate({ additional_sgs: "sg-web" })).status).toBe(400)
    expect(h.orchestrator.post).not.toHaveBeenCalled()
  })

  it("the provider keeps apply_base_sgs and its raw body", async () => {
    arrange(PROVIDER, { kind: "provider" })
    h.orchestrator.post.mockResolvedValue({ data: { success: true } })
    const body = { apply_base_sgs: true, additional_sgs: ["sg-base-dmz"] }
    expect((await isolate(body)).status).toBe(200)
    expect(h.orchestrator.post).toHaveBeenCalledWith("/firewall/microseg/conn-1/vm/pve3/lxc/106/isolate", body)
    expect(h.orchestratorOrPve).not.toHaveBeenCalled()
  })
})
