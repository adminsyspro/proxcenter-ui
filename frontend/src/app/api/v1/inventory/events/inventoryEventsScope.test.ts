import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../../__tests__/setup/route-test"

// Hoist mocks so vi.mock factories can reference them
const { getInfraMock, subscribeMock, tenantConnectionIdsMock } = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  subscribeMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
}))

// Keep real maskingScope; only stub getTenantInfrastructureScope
vi.mock("@/lib/tenant/infraScope", async (orig) => ({
  ...(await orig<typeof import("@/lib/tenant/infraScope")>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock("@/lib/tenant", () => ({
  getCurrentTenantId: async () => "t1",
  getTenantConnectionIds: (...a: any[]) => tenantConnectionIdsMock(...a),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { VM_VIEW: "vm.view" },
}))

vi.mock("@/lib/demo/demo-api", () => ({
  demoResponse: vi.fn().mockReturnValue(null),
}))

// Mock subscribe to immediately call the registered handler with our test event,
// then return a no-op unsubscribe fn.
vi.mock("@/lib/cache/inventoryPoller", () => ({
  subscribe: (...a: any[]) => subscribeMock(...a),
}))

// Stub old vdc/scope so the module import doesn't blow up if something else
// transitively imports it during test setup
vi.mock("@/lib/vdc/scope", () => ({
  getVdcScope: vi.fn().mockResolvedValue(null),
}))

// Helper: collect the raw SSE bytes from the response stream into a string.
// Reads until it sees vm:* or node:* OR until maxChunks are consumed.
// Pass stopAfterConnected=true when you only expect the initial "connected" event
// and no vm/node events follow (avoids indefinite blocking on open streams).
async function collectSseText(res: Response, opts: { stopAfterConnected?: boolean } = {}): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) return ""
  const decoder = new TextDecoder()
  let result = ""
  const MAX = 40
  for (let i = 0; i < MAX; i++) {
    const { done, value } = await reader.read()
    if (done) break
    result += decoder.decode(value, { stream: true })
    // If a vm/node event has arrived, we have enough to assert on
    if (result.includes("event: vm:") || result.includes("event: node:")) break
    // Caller says no vm/node events are expected; stop once we've seen the initial connected event
    if (opts.stopAfterConnected && result.includes("event: connected")) break
  }
  reader.releaseLock()
  return result
}

// Test event: a vm:update on connection c1 with pool "pool-a"
const VM_EVENT = {
  event: "vm:update" as const,
  connId: "c1",
  vmid: 100,
  node: "node1",
  type: "qemu",
  status: "running",
  pool: "pool-a",
}

beforeEach(() => {
  vi.clearAllMocks()
  tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))
  // Default: subscribe immediately calls the handler with the VM_EVENT and
  // returns a no-op unsubscribe.
  subscribeMock.mockImplementation((fn: (evs: any[]) => void) => {
    fn([VM_EVENT])
    return () => {}
  })
})

describe("GET /api/v1/inventory/events scope routing", () => {
  it("provider: vm:* event on owned connection passes through WITHOUT pool masking", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("text/event-stream")

    const text = await collectSseText(res)
    // The vm:update event must appear in the stream
    expect(text).toContain("event: vm:update")
    expect(text).toContain('"connId":"c1"')
  })

  it("msp: vm:* event on owned connection passes through WITHOUT pool masking", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const text = await collectSseText(res)
    // MSP sees full cluster; pool guard is inactive
    expect(text).toContain("event: vm:update")
    expect(text).toContain('"connId":"c1"')
  })

  it("iaas: vm:* event is DROPPED when the event pool is not in the vDC scope", async () => {
    const vdcScope = {
      connectionIds: new Set(["c1"]),
      pbsConnectionIds: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      // pool-b is the only allowed pool; event has pool-a -> must be dropped
      poolsByConnection: new Map([["c1", new Set(["pool-b"])]]),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    // Stop reading after the initial connected event -- no vm event will follow
    const text = await collectSseText(res, { stopAfterConnected: true })
    // Only the connected event should be present; no vm:update
    expect(text).toContain("event: connected")
    expect(text).not.toContain("event: vm:update")
  })

  it("iaas: vm:* event PASSES when the event pool is in the vDC scope", async () => {
    const vdcScope = {
      connectionIds: new Set(["c1"]),
      pbsConnectionIds: new Set<string>(),
      nodesByConnection: new Map<string, Set<string>>(),
      // pool-a is allowed
      poolsByConnection: new Map([["c1", new Set(["pool-a"])]]),
    }
    getInfraMock.mockResolvedValue({ kind: "iaas", vdcScope })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const text = await collectSseText(res)
    expect(text).toContain("event: vm:update")
    expect(text).toContain('"connId":"c1"')
  })

  it("route no longer calls getVdcScope directly (uses getTenantInfrastructureScope)", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    const { getVdcScope } = await import("@/lib/vdc/scope")

    const { GET } = await import("./route")
    await callRoute(GET, { method: "GET" })

    expect(getInfraMock).toHaveBeenCalled()
    expect(getVdcScope).not.toHaveBeenCalled()
  })
})
