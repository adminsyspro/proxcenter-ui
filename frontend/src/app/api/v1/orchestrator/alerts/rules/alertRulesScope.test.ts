import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute, readJson } from "../../../../../../__tests__/setup/route-test"

// ---------------------------------------------------------------------------
// Hoist mocks so vi.mock factories can reference them
// ---------------------------------------------------------------------------
const {
  getInfraMock,
  getCurrentTenantIdMock,
  getTenantConnectionIdsMock,
  orchestratorFetchMock,
  getSessionPrismaMock,
  connectionFindManyMock,
  rbacScopeMock,
} = vi.hoisted(() => {
  const connectionFindManyMock = vi.fn()
  const getSessionPrismaMock = vi.fn().mockResolvedValue({
    connection: { findMany: connectionFindManyMock },
  })
  return {
    getInfraMock: vi.fn(),
    getCurrentTenantIdMock: vi.fn(),
    getTenantConnectionIdsMock: vi.fn(),
    orchestratorFetchMock: vi.fn(),
    getSessionPrismaMock,
    connectionFindManyMock,
    rbacScopeMock: vi.fn(),
  }
})

// Keep real maskingScope; only mock getTenantInfrastructureScope
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: (...a: any[]) => getCurrentTenantIdMock(...a),
  getTenantConnectionIds: (...a: any[]) => getTenantConnectionIdsMock(...a),
  getSessionPrisma: (...a: any[]) => getSessionPrismaMock(...a),
  DEFAULT_TENANT_ID: "default",
}))

vi.mock("@/lib/orchestrator/client", () => ({
  orchestratorFetch: (...a: any[]) => orchestratorFetchMock(...a),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  getCurrentRbacInfraScope: (...a: any[]) => rbacScopeMock(...a),
  PERMISSIONS: { CONNECTION_VIEW: "connection.view" },
}))

vi.mock("@/lib/demo/demo-api", () => ({
  demoResponse: vi.fn().mockReturnValue(null),
}))

// injectVdcNodeScope is a no-op in the MSP case (empty vDC scope).
// Mock it to avoid hitting getVdcScope in tests where it is irrelevant.
vi.mock("@/lib/alerts/ruleScope", () => ({
  injectVdcNodeScope: vi.fn().mockResolvedValue(undefined),
}))

// setRuleOwner / ruleVisibleToTenant -- not the subject of these tests
vi.mock("@/lib/alerts/ruleOwners", () => ({
  setRuleOwner: vi.fn().mockResolvedValue(undefined),
  ruleVisibleToTenant: vi.fn().mockResolvedValue(true),
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MSP_TENANT_ID = "msp-tenant-1"
const PVE_CONN_ID = "conn-pve-1"
const PBS_CONN_ID = "conn-pbs-1"

/**
 * A minimal POST body that intentionally omits connection_id so the
 * auto-fill path is exercised.
 */
function makeBody(overrides: Record<string, unknown> = {}) {
  return { name: "Test rule", ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Restore the default getSessionPrisma return value after clearAllMocks.
  connectionFindManyMock.mockResolvedValue([])
  getSessionPrismaMock.mockResolvedValue({
    connection: { findMany: connectionFindManyMock },
  })
  // Default: orchestrator creates the rule successfully
  orchestratorFetchMock.mockResolvedValue({ id: "rule-1", name: "Test rule" })
  rbacScopeMock.mockReset().mockResolvedValue(null)
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /api/v1/orchestrator/alerts/rules -- MSP autofill scope", () => {
  it("msp tenant with ONE owned PVE connection: auto-fills connection_id and creates the rule (NOT a 400)", async () => {
    getCurrentTenantIdMock.mockResolvedValue(MSP_TENANT_ID)
    // infra.connectionIds includes only the PVE connection (clean case)
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set([PVE_CONN_ID]) })
    // getSessionPrisma().connection.findMany({where:{type:'pve'}}) returns the PVE row
    connectionFindManyMock.mockResolvedValue([{ id: PVE_CONN_ID }])
    // connection validation: the autofilled id must pass
    getTenantConnectionIdsMock.mockResolvedValue(new Set([PVE_CONN_ID]))

    const { POST } = await import("./route")
    const res = await callRoute(POST, { body: makeBody() })
    const json = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(json?.id).toBe("rule-1")

    // The orchestrator was called with the autofilled PVE connection_id
    expect(orchestratorFetchMock).toHaveBeenCalledTimes(1)
    const [path, opts] = orchestratorFetchMock.mock.calls[0]
    expect(path).toBe("/alerts/rules")
    expect(opts?.body?.connection_id).toBe(PVE_CONN_ID)
  })

  it("msp tenant with ONE PVE + ONE PBS: auto-fills to the PVE id (NOT a 'Multiple clusters' 400)", async () => {
    // This is the regression the fix targets. Before the fix, infra.connectionIds
    // = Set([PVE, PBS]) -> pveIds.length === 2 -> 400. After the fix, findMany
    // filters to type:'pve' -> only 1 row -> autofilled correctly.
    getCurrentTenantIdMock.mockResolvedValue(MSP_TENANT_ID)
    getInfraMock.mockResolvedValue({
      kind: "msp",
      connectionIds: new Set([PVE_CONN_ID, PBS_CONN_ID]),
    })
    // findMany({where:{type:'pve'}}) returns only the PVE row
    connectionFindManyMock.mockResolvedValue([{ id: PVE_CONN_ID }])
    getTenantConnectionIdsMock.mockResolvedValue(new Set([PVE_CONN_ID, PBS_CONN_ID]))

    const { POST } = await import("./route")
    const res = await callRoute(POST, { body: makeBody() })
    const json = await readJson<any>(res)

    // Must NOT be a 400 -- the fix filters PBS out
    expect(res.status).toBe(200)
    expect(json?.id).toBe("rule-1")

    const [path, opts] = orchestratorFetchMock.mock.calls[0]
    expect(path).toBe("/alerts/rules")
    expect(opts?.body?.connection_id).toBe(PVE_CONN_ID)
  })

  it("msp tenant owning only a PBS (no PVE): returns 400 'No cluster available'", async () => {
    getCurrentTenantIdMock.mockResolvedValue(MSP_TENANT_ID)
    getInfraMock.mockResolvedValue({
      kind: "msp",
      connectionIds: new Set([PBS_CONN_ID]),
    })
    // findMany({where:{type:'pve'}}) returns nothing
    connectionFindManyMock.mockResolvedValue([])
    getTenantConnectionIdsMock.mockResolvedValue(new Set([PBS_CONN_ID]))

    const { POST } = await import("./route")
    const res = await callRoute(POST, { body: makeBody() })
    const json = await readJson<any>(res)

    expect(res.status).toBe(400)
    expect(json?.error).toMatch(/No cluster available/)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it("msp tenant with ZERO owned connections: returns 400 'No cluster available'", async () => {
    getCurrentTenantIdMock.mockResolvedValue(MSP_TENANT_ID)
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set() })
    connectionFindManyMock.mockResolvedValue([])
    getTenantConnectionIdsMock.mockResolvedValue(new Set())

    const { POST } = await import("./route")
    const res = await callRoute(POST, { body: makeBody() })
    const json = await readJson<any>(res)

    expect(res.status).toBe(400)
    expect(json?.error).toMatch(/No cluster available/)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it("msp tenant with TWO owned PVE connections, no connection_id: returns 400 'specify connection_id explicitly'", async () => {
    getCurrentTenantIdMock.mockResolvedValue(MSP_TENANT_ID)
    getInfraMock.mockResolvedValue({
      kind: "msp",
      connectionIds: new Set(["conn-pve-1", "conn-pve-2"]),
    })
    // Both connections are PVE -- ambiguous, must 400
    connectionFindManyMock.mockResolvedValue([{ id: "conn-pve-1" }, { id: "conn-pve-2" }])
    getTenantConnectionIdsMock.mockResolvedValue(new Set(["conn-pve-1", "conn-pve-2"]))

    const { POST } = await import("./route")
    const res = await callRoute(POST, { body: makeBody() })
    const json = await readJson<any>(res)

    expect(res.status).toBe(400)
    expect(json?.error).toMatch(/specify connection_id explicitly/)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  it("provider tenant (isVdcTenant false): autofill skipped, no infra-based 400 even without connection_id", async () => {
    // DEFAULT_TENANT_ID == "default", so isVdcTenant = false -> skip autofill
    getCurrentTenantIdMock.mockResolvedValue("default")
    // getTenantConnectionIds returns the body's (absent) connection_id path --
    // body has no connection_id so the downstream validation is also skipped.
    getTenantConnectionIdsMock.mockResolvedValue(new Set())

    const { POST } = await import("./route")
    const res = await callRoute(POST, { body: makeBody() })

    // The autofill block is skipped entirely; no infra 400 fires.
    // The route proceeds to orchestratorFetch.
    expect(res.status).toBe(200)
    // getTenantInfrastructureScope must NOT have been called for the provider
    expect(getInfraMock).not.toHaveBeenCalled()
    // getSessionPrisma must NOT have been called for the provider
    expect(getSessionPrismaMock).not.toHaveBeenCalled()
    expect(orchestratorFetchMock).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// GET -- vDC scope filtering
// ---------------------------------------------------------------------------

describe("GET /api/v1/orchestrator/alerts/rules -- vDC view context filtering", () => {
  // No connection_id -> tenant-global rule, always visible once ownership
  // passes (ruleVisibleToTenant is mocked to always return true here).
  const RULE_GLOBAL = { id: "r-global", name: "Global rule" }
  const RULE_C1 = { id: "r-c1", name: "Rule on c1", connection_id: PVE_CONN_ID }
  const RULE_C2 = { id: "r-c2", name: "Rule on c2 (other vDC)", connection_id: "conn-pve-2" }

  beforeEach(() => {
    orchestratorFetchMock.mockResolvedValue([RULE_GLOBAL, RULE_C1, RULE_C2])
  })

  it("provider: sees every rule regardless of connection_id (no vDC masking)", async () => {
    getCurrentTenantIdMock.mockResolvedValue("default")
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    const body = await readJson<any[]>(res)

    expect(body.map((r) => r.id)).toEqual(["r-global", "r-c1", "r-c2"])
  })

  it("msp: sees every owned-ownership rule regardless of connection_id (no vDC masking)", async () => {
    getCurrentTenantIdMock.mockResolvedValue(MSP_TENANT_ID)
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set([PVE_CONN_ID, "conn-pve-2"]) })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    const body = await readJson<any[]>(res)

    expect(body.map((r) => r.id)).toEqual(["r-global", "r-c1", "r-c2"])
  })

  it("iaas: keeps the global rule and the narrowed-connection rule, excludes the rule on a connection present only in the union (another vDC on a shared cluster)", async () => {
    getCurrentTenantIdMock.mockResolvedValue("iaas-tenant-1")
    const vdcScope = {
      connectionIds: new Set([PVE_CONN_ID]),
      pbsConnectionIds: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      poolsByConnection: new Map<string, Set<string>>(),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    const body = await readJson<any[]>(res)

    const ids = body.map((r) => r.id)
    expect(ids).toContain("r-global")
    expect(ids).toContain("r-c1")
    expect(ids).not.toContain("r-c2")
  })
})

describe("GET /api/v1/orchestrator/alerts/rules -- RBAC infra scope filtering", () => {
  const RULES = [
    { id: "r1", connection_id: "c1" },
    { id: "r2", connection_id: "c2" },
    { id: "r3" },
  ]

  beforeEach(() => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    getCurrentTenantIdMock.mockResolvedValue("default")
    getTenantConnectionIdsMock.mockResolvedValue(new Set(["c1", "c2"]))
    orchestratorFetchMock.mockResolvedValue(RULES)
  })

  it("returns every rule for an unrestricted admin", async () => {
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    const body = await readJson<any[]>(res)

    expect(res.status).toBe(200)
    expect(body.map((rule) => rule.id)).toEqual(["r1", "r2", "r3"])
    expect(rbacScopeMock).toHaveBeenCalledWith("connection.view")
  })

  it("keeps connection-level and global rules for a node-scoped user", async () => {
    rbacScopeMock.mockResolvedValue({
      fullConnections: new Set(),
      nodesByConnection: new Map([["c1", new Set(["n1"])]]),
      guestDerived: false,
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    const body = await readJson<any[]>(res)

    expect(res.status).toBe(200)
    expect(body.map((rule) => rule.id)).toEqual(["r1", "r3"])
  })

  it("keeps granted connection and global rules for a connection-scoped user", async () => {
    rbacScopeMock.mockResolvedValue({
      fullConnections: new Set(["c2"]),
      nodesByConnection: new Map(),
      guestDerived: false,
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    const body = await readJson<any[]>(res)

    expect(res.status).toBe(200)
    expect(body.map((rule) => rule.id)).toEqual(["r2", "r3"])
  })
})
