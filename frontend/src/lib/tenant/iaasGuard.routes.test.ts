import { beforeEach, describe, expect, it, vi } from "vitest"

import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"

import { callRoute } from "@/__tests__/setup/route-test"

// roadmap#189. Every route keyed by a PVE connection is reachable by an IaaS
// tenant through its vDC binding, so each one is classified here. A route
// that reads or acts on the cluster or a node as a whole answers 404
// { error: "Not found" } to an IaaS tenant with NO call to PVE, SSH, the
// database, the orchestrator or the network. A new route file fails the
// first test until it is classified.
const h = vi.hoisted(() => {
  const prismaCalls: string[] = []
  const state = { tenantEnabled: true }
  const prisma = new Proxy({}, {
    get: (_t, model) => new Proxy({}, {
      get: (_m, op) => (..._a: unknown[]) => {
        prismaCalls.push(`${String(model)}.${String(op)}`)
        return Promise.resolve(String(model) === "tenant" ? { enabled: state.tenantEnabled } : null)
      },
    }),
  })
  return {
    prismaCalls,
    state,
    prisma,
    getPrincipal: vi.fn(),
    scope: vi.fn(),
    checkPermission: vi.fn(),
    getConnectionById: vi.fn(),
    pveFetch: vi.fn(),
    executeSSH: vi.fn(),
    getSessionPrisma: vi.fn(),
    orchestratorFetch: vi.fn(),
    getOrchestratorClient: vi.fn(),
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
  getSessionPrisma: (...a: any[]) => h.getSessionPrisma(...a),
  getCurrentTenantId: async () => "tenant-iaas",
}))
vi.mock("@/lib/db/prisma", () => ({ prisma: h.prisma }))
vi.mock("@/lib/rbac", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  checkPermission: (...a: any[]) => h.checkPermission(...a),
  checkPermissions: (...a: any[]) => h.checkPermission(...a),
}))
vi.mock("@/lib/connections/getConnection", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  getConnectionById: (...a: any[]) => h.getConnectionById(...a),
}))
vi.mock("@/lib/proxmox/client", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  pveFetch: (...a: any[]) => h.pveFetch(...a),
}))
vi.mock("@/lib/ssh/exec", () => ({ executeSSH: (...a: any[]) => h.executeSSH(...a) }))
vi.mock("@/lib/orchestrator/client", () => ({
  orchestratorFetch: (...a: any[]) => h.orchestratorFetch(...a),
  getOrchestratorClient: (...a: any[]) => h.getOrchestratorClient(...a),
}))
vi.mock("@/lib/audit", () => ({ audit: (...a: any[]) => h.audit(...a) }))
vi.mock("@/lib/audit/withAudit", () => ({ withAudit: (_o: unknown, handler: unknown) => handler }))
vi.mock("@/lib/api-tokens/routeGuard", () => ({ withPublicApiGuard: (_id: unknown, handler: unknown) => handler }))

/** Paths relative to src/app/api/v1/connections. */
const DENIED_FILES = [
  "[id]/check/route.ts",
  "[id]/cluster/route.ts",
  "[id]/cluster/config/route.ts",
  "[id]/cluster/metrics/server/route.ts",
  "[id]/cluster/metrics/server/[serverId]/route.ts",
  "[id]/cluster/notifications/endpoints/[type]/[name]/route.ts",
  "[id]/cluster/notifications/matchers/route.ts",
  "[id]/cluster/notifications/matchers/[name]/route.ts",
  "[id]/cluster/notifications/targets/route.ts",
  "[id]/fingerprint/route.ts",
  "[id]/firewall/aliases/route.ts",
  "[id]/firewall/groups/route.ts",
  "[id]/firewall/ipset/route.ts",
  "[id]/firewall/options/route.ts",
  "[id]/firewall/rules/route.ts",
  "[id]/guests/cluster/route.ts",
  "[id]/ha/route.ts",
  "[id]/ha/affinity-rules/route.ts",
  "[id]/ha/affinity-rules/[ruleId]/route.ts",
  "[id]/ha/auto-ha/route.ts",
  "[id]/ha/auto-ha/sync/route.ts",
  "[id]/ha/groups/route.ts",
  "[id]/ha/groups/[groupId]/route.ts",
  "[id]/nodes/trends/route.ts",
  "[id]/nodes/[node]/apt/route.ts",
  "[id]/nodes/[node]/apt/repositories/route.ts",
  "[id]/nodes/[node]/apt/upgrade/route.ts",
  "[id]/nodes/[node]/check-sshfs/route.ts",
  "[id]/nodes/[node]/disks/route.ts",
  "[id]/nodes/[node]/hardware/pci/route.ts",
  "[id]/nodes/[node]/hardware/usb/route.ts",
  "[id]/nodes/[node]/local-vms/route.ts",
  "[id]/nodes/[node]/maintenance/route.ts",
  "[id]/nodes/[node]/network/route.ts",
  "[id]/nodes/[node]/network/[iface]/route.ts",
  "[id]/nodes/[node]/notes/route.ts",
  "[id]/nodes/[node]/replication/route.ts",
  "[id]/nodes/[node]/replication/[jobId]/route.ts",
  "[id]/nodes/[node]/replication/[jobId]/schedule_now/route.ts",
  "[id]/nodes/[node]/report/route.ts",
  "[id]/nodes/[node]/sensors/route.ts",
  "[id]/nodes/[node]/subscription/route.ts",
  "[id]/nodes/[node]/syslog/route.ts",
  "[id]/nodes/[node]/system/route.ts",
  "[id]/nodes/[node]/terminal/route.ts",
  "[id]/nodes/[node]/updates/route.ts",
  "[id]/nodes/[node]/upgrade/route.ts",
  "[id]/nodes/[node]/upgrade/reboot/route.ts",
  "[id]/replicable-vms/route.ts",
  "[id]/replication-storages/route.ts",
  "[id]/test-ssh/route.ts",
  "[id]/version/route.ts",
]

/** Files whose reads an IaaS tenant keeps (narrowed) and whose writes it never makes. */
const DENIED_METHODS: Record<string, string[]> = {
  "[id]/cluster/options/route.ts": ["PUT"],
  "[id]/nodes/[node]/aplinfo/route.ts": ["POST"],
  "[id]/nodes/[node]/status/route.ts": ["POST"],
  "[id]/pools/route.ts": ["POST", "PUT", "DELETE"],
}

/**
 * Reads the tenant screens need, narrowed to the tenant's share in the route
 * through lib/connections/iaasView (see iaasView.routes.test.ts).
 */
const IAAS_VIEW = [
  "route.ts",
  "[id]/route.ts",
  "[id]/cluster/mapping/[kind]/route.ts",
  "[id]/cluster/options/route.ts",
  "[id]/nodes/route.ts",
  "[id]/nodes/[node]/status/route.ts",
  "[id]/pools/route.ts",
  "[id]/rrd/route.ts",
  "[id]/rrd/batch/route.ts",
  "[id]/storage/route.ts",
]

/** Routes that already confine an IaaS tenant to its vDC, and how. */
const VDC_SCOPED: Record<string, string> = {
  "[id]/backup-jobs/route.ts": "jobs and storages narrowed to the vDC pools and nodes",
  "[id]/backup-jobs/[jobId]/route.ts": "job must cover the vDC pools only",
  "[id]/backup-jobs/[jobId]/guests/route.ts": "refused to a vDC tenant",
  "[id]/backup-jobs/runs/route.ts": "runs narrowed to the vDC pools",
  "[id]/backup-jobs/runs/[node]/[upid]/route.ts": "task detail only for the tenant's own runs",
  "[id]/cluster/nextid/route.ts": "VMID picked inside the tenant's range",
  "[id]/diagnostics/route.ts": "provider or owner only",
  "[id]/file-restore/route.ts": "guest file restore target resolved inside the vDC (roadmap#33)",
  "[id]/file-restore/preview/route.ts": "guest file restore target resolved inside the vDC (roadmap#33)",
  "[id]/file-restore/download/route.ts": "guest file restore target resolved inside the vDC (roadmap#33)",
  "[id]/guests/trends/route.ts": "guest visibility of the session",
  "[id]/ha/[sid]/route.ts": "guest scope of the HA resource",
  "[id]/network-choices/route.ts": "vDC VNets and shared bridges",
  "[id]/networks/route.ts": "vDC masking scope",
  "[id]/nodes/[node]/aplinfo/route.ts": "GET is the public Proxmox appliance catalog; POST denied above",
  "[id]/nodes/[node]/cpu-models/route.ts": "vDC compute policy of the node",
  "[id]/nodes/[node]/machines/route.ts": "vDC of the node",
  "[id]/nodes/[node]/restore/route.ts": "vDC storage and guest scope",
  "[id]/nodes/[node]/storage/[storage]/content/route.ts": "vDC nodes and storages",
  "[id]/nodes/[node]/storage/[storage]/content/[volid]/route.ts": "vDC storage write guard",
  "[id]/nodes/[node]/storage/[storage]/download-url/route.ts": "vDC storage write guard",
  "[id]/nodes/[node]/storage/[storage]/upload/route.ts": "vDC storage write guard",
  "[id]/nodes/[node]/storages/route.ts": "vDC nodes and storages",
  "[id]/nodes/[node]/vzdump/route.ts": "guest scope of every vmid",
  "[id]/owner/route.ts": "provider only",
  "[id]/resources/route.ts": "guest visibility of the session",
  "[id]/snapshots/route.ts": "guest visibility of the session",
  "[id]/storage/[storage]/route.ts": "owner of the cluster only",
  "[id]/tag-access/route.ts": "tag policy of the caller's guests",
}

/** Prefixes of whole subtrees with their own guard. */
const SUBTREE_GUARDS: Array<[RegExp, string]> = [
  [/^\[id\]\/guests\/\[type\]\//, "guest routes: guest scope of the vDC (lib/vdc/guestGuard)"],
  [/(^|\/)ceph\//, "Ceph: denyIaasTenantCeph (lib/ceph/tenantGuard)"],
  [/^\[id\]\/detect-ceph\//, "Ceph: denyIaasTenantCeph (lib/ceph/tenantGuard)"],
  [/^\[id\]\/sdn\//, "SDN: the tenant's own VNets and zones only (lib/vdc/sdnReadScope, roadmap#81), zones without peers"],
]

const CONNECTIONS = fileURLToPath(new URL("../../app/api/v1/connections/", import.meta.url))

function routeFilesOnDisk(): string[] {
  const found: string[] = []
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === "route.ts") found.push(relative(CONNECTIONS, full).split(sep).join("/"))
    }
  }
  walk(CONNECTIONS)
  return found.sort()
}

const MODULES = import.meta.glob("../../app/api/v1/connections/**/route.ts")
const load = (file: string) => MODULES[`../../app/api/v1/connections/${file}`]() as Promise<Record<string, any>>

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const
const PARAMS = {
  id: "conn-1", node: "pve1", jobId: "job-1", upid: "UPID:pve1:1", serverId: "srv-1", type: "gotify", name: "n1",
  ruleId: "r1", groupId: "g1", iface: "vmbr0", ipam: "pve", vnet: "v1", kind: "pci",
}
const SIDE_EFFECTS = [
  "getConnectionById", "pveFetch", "executeSSH", "getSessionPrisma", "orchestratorFetch", "getOrchestratorClient", "audit", "fetch",
] as const

const deniedCases = async () => {
  const cases: Array<{ file: string; method: string }> = []
  for (const file of DENIED_FILES) {
    const mod = await load(file)
    for (const m of METHODS) if (typeof mod[m] === "function") cases.push({ file, method: m })
  }
  for (const [file, methods] of Object.entries(DENIED_METHODS)) for (const m of methods) cases.push({ file, method: m })
  return cases
}

const IAAS_SESSION = { ok: true, principal: { kind: "session", userId: "u1", tenantId: "tenant-iaas", connectionIds: null } }
const IAAS_SCOPE = { kind: "iaas", vdcScope: { connectionIds: new Set(["conn-1"]), nodesByConnection: new Map([["conn-1", new Set(["pve1"])]]) } }

beforeEach(() => {
  vi.clearAllMocks()
  h.prismaCalls.length = 0
  vi.stubGlobal("fetch", h.fetch)
  h.checkPermission.mockResolvedValue(null)
  h.getPrincipal.mockResolvedValue(IAAS_SESSION)
  h.scope.mockResolvedValue(IAAS_SCOPE)
})

describe("connection routes: every file is classified for IaaS tenants", () => {
  it("each route file on disk sits in exactly one class", () => {
    const classOf = (file: string) => {
      const classes = [
        DENIED_FILES.includes(file) && "denied",
        IAAS_VIEW.includes(file) && "view",
        file in VDC_SCOPED && "scoped",
        SUBTREE_GUARDS.some(([re]) => re.test(file)) && "subtree",
      ].filter(Boolean)
      return classes
    }
    const onDisk = routeFilesOnDisk()
    expect(onDisk.length).toBeGreaterThan(130)
    for (const file of onDisk) expect(classOf(file), file).toHaveLength(1)
    for (const file of [...DENIED_FILES, ...IAAS_VIEW, ...Object.keys(VDC_SCOPED), ...Object.keys(DENIED_METHODS)]) {
      expect(onDisk, file).toContain(file)
    }
  })

  it("each denied file asks the guard in every handler it exports (directly or through providerPveRead)", async () => {
    for (const file of DENIED_FILES) {
      const source = readFileSync(join(CONNECTIONS, file), "utf8")
      const mod = await load(file)
      const handlers = METHODS.filter(m => typeof mod[m] === "function").length
      // A handler built by providerPveRead (lib/connections) asks the gate itself.
      const guards = (source.match(/await denyIaasTenant\(\)/g)?.length ?? 0) + (source.match(/= providerPveRead\(/g)?.length ?? 0)
      expect(guards, file).toBeGreaterThanOrEqual(handlers)
    }
  })
})

describe("denied connection routes refuse an IaaS tenant", () => {
  it("404 Not found, no PVE, SSH, database, orchestrator or network call", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const c of await deniedCases()) {
      vi.clearAllMocks()
      h.prismaCalls.length = 0
      h.getPrincipal.mockResolvedValue(IAAS_SESSION)
      h.scope.mockResolvedValue(IAAS_SCOPE)
      const mod = await load(c.file)
      const res = await callRoute(mod[c.method], { method: c.method as any, params: PARAMS, body: c.method === "GET" ? undefined : {} })
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
    for (const [variant, arrange] of variants) {
      for (const c of await deniedCases()) {
        vi.clearAllMocks()
        h.getPrincipal.mockResolvedValue(IAAS_SESSION)
        h.scope.mockResolvedValue(IAAS_SCOPE)
        arrange()
        const mod = await load(c.file)
        const res = await callRoute(mod[c.method], { method: c.method as any, params: PARAMS, body: c.method === "GET" ? undefined : {} })
        expect(res.status, `${variant}: ${c.method} ${c.file}`).toBe(404)
        expect(h.pveFetch).not.toHaveBeenCalled()
        expect(h.getConnectionById).not.toHaveBeenCalled()
      }
    }
  })

  it("a principal rejection is handed back as is", async () => {
    h.getPrincipal.mockResolvedValue({ ok: false, rejection: { status: 401, body: { error: "Not authenticated" } } })
    const mod = await load("[id]/nodes/[node]/syslog/route.ts")
    const res = await callRoute(mod.GET, { method: "GET", params: PARAMS })
    expect(res.status).toBe(401)
    expect(h.pveFetch).not.toHaveBeenCalled()
  })
})

describe("denied connection routes let the provider and an MSP through", () => {
  const PROVIDER = { ok: true, principal: { kind: "session", userId: "u1", tenantId: "default", connectionIds: null } }
  const MSP = { ok: true, principal: { kind: "session", userId: "u2", tenantId: "tenant-msp", connectionIds: null } }

  it.each([
    ["provider session", PROVIDER, { kind: "provider" }],
    ["msp session", MSP, { kind: "msp", connectionIds: new Set(["conn-1"]) }],
  ])("%s: every denied handler goes past the guard to its own work", async (_label, principal, scope) => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "warn").mockImplementation(() => {})
    for (const c of await deniedCases()) {
      vi.clearAllMocks()
      h.checkPermission.mockResolvedValue(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }))
      h.getPrincipal.mockResolvedValue(principal)
      h.scope.mockResolvedValue(scope)
      const mod = await load(c.file)
      const res = await callRoute(mod[c.method], { method: c.method as any, params: PARAMS, body: c.method === "GET" ? undefined : {} })
      const body = await res.clone().json().catch(() => null)
      expect(body?.error === "Not found" && res.status === 404, `${c.method} ${c.file} answered the guard's 404`).toBe(false)
    }
  })

  it("a disabled MSP tenant's session is refused", async () => {
    h.getPrincipal.mockResolvedValue(MSP)
    h.scope.mockResolvedValue({ kind: "msp", connectionIds: new Set(["conn-1"]) })
    h.state.tenantEnabled = false
    try {
      const mod = await load("[id]/nodes/[node]/syslog/route.ts")
      const res = await callRoute(mod.GET, { method: "GET", params: PARAMS })
      expect(res.status).toBe(404)
      expect(h.pveFetch).not.toHaveBeenCalled()
    } finally {
      h.state.tenantEnabled = true
    }
  })
})
