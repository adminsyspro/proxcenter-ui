import { beforeEach, describe, expect, it, vi } from "vitest"

import { callRoute } from "../../../../../__tests__/setup/route-test"

/**
 * Two groups live here, sharing the mock scaffolding below:
 *   - "scope routing" covers the tenant / vDC / infra-scope gate and reads the
 *     stream through collectSseText.
 *   - "tag/pool guest-derived delta gate" covers issue #633 and drives the
 *     captured subscriber directly (see emitThroughGate further down).
 */

// Hoist mocks so vi.mock factories can reference them
const {
  getInfraMock,
  subscribeMock,
  tenantConnectionIdsMock,
  getRbacInfraScopeMock,
  getRBACContextMock,
  loadGuestVisibilityCheckMock,
} = vi.hoisted(() => ({
  getInfraMock: vi.fn(),
  subscribeMock: vi.fn(),
  tenantConnectionIdsMock: vi.fn(),
  getRbacInfraScopeMock: vi.fn(),
  getRBACContextMock: vi.fn(),
  loadGuestVisibilityCheckMock: vi.fn(),
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

// Use real isConnectionVisible / mayHaveVisibleGuests from infraScope; mock only
// the DB-touching helpers
vi.mock("@/lib/rbac", async (orig) => {
  const real = await orig<typeof import("@/lib/rbac")>()
  return {
    ...real,
    checkPermission: vi.fn().mockResolvedValue(null),
    PERMISSIONS: { VM_VIEW: "vm.view" },
    getRBACContext: (...a: any[]) => getRBACContextMock(...a),
    getRbacInfraScope: (...a: any[]) => getRbacInfraScopeMock(...a),
    loadGuestVisibilityCheck: (...a: any[]) => loadGuestVisibilityCheckMock(...a),
  }
})

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
// The deltas of a poll cycle travel in ONE `batch` frame whose data is the
// JSON array of events, so the text is asserted on `"event":"vm:update"`
// (inside the array), not on an `event: vm:update` frame.
// Reads until it sees a batch frame OR until maxChunks are consumed.
// Pass stopAfterConnected=true when you only expect the initial "connected" event
// and no batch follows: one more read is then raced against a short timer, so a
// batch enqueued right after "connected" is still caught, and the stream is
// cancelled rather than left open.
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
    // If a batch has arrived, we have enough to assert on
    if (result.includes("event: batch")) break
    // Caller says no batch is expected; stop once we've seen the initial
    // connected event, after a look at whatever was queued right behind it
    if (opts.stopAfterConnected && result.includes("event: connected")) {
      const extra = await Promise.race([
        reader.read().then(r => (r.done ? "" : decoder.decode(r.value))),
        new Promise<string>(resolve => setTimeout(() => resolve(""), 30)),
      ])
      result += extra
      break
    }
  }
  await reader.cancel()
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
  // Default: admin context — no RBAC pruning.
  getRBACContextMock.mockResolvedValue({ userId: "u1", isAdmin: true, tenantId: "t1" })
  getRbacInfraScopeMock.mockResolvedValue(null)
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
    // The vm:update event must appear in the stream, inside the cycle's batch
    expect(text).toContain("event: batch")
    expect(text).toContain('"event":"vm:update"')
    expect(text).toContain('"connId":"c1"')
  })

  it("msp: vm:* event on owned connection passes through WITHOUT pool masking", async () => {
    getInfraMock.mockResolvedValue({ kind: "msp", connectionIds: new Set(["c1"]) })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const text = await collectSseText(res)
    // MSP sees full cluster; pool guard is inactive
    expect(text).toContain("event: batch")
    expect(text).toContain('"event":"vm:update"')
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
    expect(text).not.toContain("event: batch")
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
    expect(text).toContain("event: batch")
    expect(text).toContain('"event":"vm:update"')
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

  it("RBAC scope: vm:* event is DROPPED when connection not in user scope", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    // Non-admin user whose scope only covers connection c2, not c1
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set(["c2"]),
      nodesByConnection: new Map(),
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const text = await collectSseText(res, { stopAfterConnected: true })
    expect(text).toContain("event: connected")
    // VM_EVENT is on c1 which is not in the scope -> must be dropped
    expect(text).not.toContain("event: batch")
  })

  it("RBAC scope: vm:* event PASSES when connection is in user scope", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    // Non-admin user whose scope covers connection c1
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set(["c1"]),
      nodesByConnection: new Map(),
    })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const text = await collectSseText(res)
    expect(text).toContain("event: batch")
    expect(text).toContain('"event":"vm:update"')
    expect(text).toContain('"connId":"c1"')
  })

  it("RBAC scope: admin context passes all events regardless of scope", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    // Admin: getRbacInfraScope should not even be called; isAdmin=true => rbacScope=null
    getRBACContextMock.mockResolvedValue({ userId: "u1", isAdmin: true, tenantId: "t1" })

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const text = await collectSseText(res)
    expect(text).toContain("event: batch")
    expect(text).toContain('"event":"vm:update"')
    // Scope lookup must not be called for admins
    expect(getRbacInfraScopeMock).not.toHaveBeenCalled()
  })

  it("RBAC scope: node:update is DROPPED when node not in user scope", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    // User can see c1 but only node2, not node1
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["c1", new Set(["node2"])]]),
    })

    const NODE_EVENT = {
      event: "node:update" as const,
      connId: "c1",
      node: "node1",
      status: "online",
    }
    subscribeMock.mockImplementation((fn: (evs: any[]) => void) => {
      fn([NODE_EVENT])
      return () => {}
    })
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const text = await collectSseText(res, { stopAfterConnected: true })
    expect(text).not.toContain("event: batch")
  })

  it("RBAC node-scope: vm:update is DROPPED when node not in user scope (leak fix)", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    // User can see c1 but only node2; VM_EVENT is on node1 -> must be dropped
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["c1", new Set(["node2"])]]),
    })
    // VM_EVENT.node = "node1" which is NOT granted
    subscribeMock.mockImplementation((fn: (evs: any[]) => void) => {
      fn([VM_EVENT])
      return () => {}
    })
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const text = await collectSseText(res, { stopAfterConnected: true })
    expect(text).toContain("event: connected")
    expect(text).not.toContain("event: batch")
  })

  it("RBAC node-scope: vm:update PASSES when node is in user scope", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    // User can see c1 node1; VM_EVENT is on node1 -> must pass
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["c1", new Set(["node1"])]]),
    })
    // VM_EVENT.node = "node1" which IS granted; no pool masking (kind: provider)
    subscribeMock.mockImplementation((fn: (evs: any[]) => void) => {
      fn([VM_EVENT])
      return () => {}
    })
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const text = await collectSseText(res)
    expect(text).toContain("event: batch")
    expect(text).toContain('"event":"vm:update"')
    expect(text).toContain('"connId":"c1"')
  })

  it("RBAC scope: node:update PASSES when node is in user scope", async () => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    // User can see c1 node1
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["c1", new Set(["node1"])]]),
    })

    const NODE_EVENT = {
      event: "node:update" as const,
      connId: "c1",
      node: "node1",
      status: "online",
    }
    subscribeMock.mockImplementation((fn: (evs: any[]) => void) => {
      fn([NODE_EVENT])
      return () => {}
    })
    tenantConnectionIdsMock.mockResolvedValue(new Set(["c1"]))

    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    expect(res.status).toBe(200)

    const text = await collectSseText(res)
    expect(text).toContain("event: batch")
    expect(text).toContain('"event":"node:update"')
    expect(text).toContain('"node":"node1"')
  })
})

// ---------------------------------------------------------------------------
// Issue #633: guest-derived (tag/pool) perimeter on the live delta stream.
//
// The route holds the SSE connection open forever, so these cases never await
// the whole body: `subscribe` is mocked to CAPTURE the subscriber callback, the
// handler is invoked, and the callback is then driven with a batch of events so
// we can read back exactly what the gate let through. Stricter than
// collectSseText above, which stops at the first frame in stopAfterConnected
// mode and would therefore miss a leak enqueued right after "connected".
// ---------------------------------------------------------------------------

type SentEvent = { event: string; data: any }

const gateDecoder = new TextDecoder()

/** Split one SSE chunk into its `event:` / `data:` pairs. */
function parseSse(chunk: string): SentEvent[] {
  return chunk
    .split("\n\n")
    .map(block => block.trim())
    .filter(Boolean)
    .map(block => {
      const lines = block.split("\n")
      const eventLine = lines.find(l => l.startsWith("event: ")) ?? ""
      const dataLine = lines.find(l => l.startsWith("data: "))
      return {
        event: eventLine.slice("event: ".length),
        data: dataLine ? JSON.parse(dataLine.slice("data: ".length)) : {},
      }
    })
}

/**
 * Drain everything already queued on an open stream. The stream never ends, so
 * a read that finds nothing is raced against a short timer. The losing read is
 * abandoned, which is safe only because the caller cancels right after.
 */
async function drainQueued(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<SentEvent[]> {
  const out: SentEvent[] = []
  for (;;) {
    const next = await Promise.race([
      reader.read().then(r => (r.done ? null : gateDecoder.decode(r.value))),
      new Promise<undefined>(resolve => setTimeout(() => resolve(undefined), 30)),
    ])
    if (next === undefined || next === null) break
    out.push(...parseSse(next))
  }
  return out
}

/**
 * Open the SSE route, push each of `cycles` through the subscriber as one poll
 * cycle, and return the frames the route sent (the initial `connected` frame
 * excluded): at most one `batch` frame per cycle, holding the forwarded events.
 */
async function emitFramesThroughGate(cycles: any[][]): Promise<SentEvent[]> {
  let captured: ((evs: any[]) => void) | null = null
  subscribeMock.mockImplementation((fn: (evs: any[]) => void) => {
    captured = fn
    return () => {}
  })

  const { GET } = await import("./route")
  const res = await callRoute(GET, { method: "GET" })
  expect(res.status).toBe(200)
  expect(res.headers.get("content-type")).toContain("text/event-stream")

  const reader = res.body!.getReader()
  // The `connected` frame is enqueued synchronously by start(), so this read
  // never blocks and leaves no pending read behind.
  const connected = parseSse(gateDecoder.decode((await reader.read()).value!))
  expect(connected[0].event).toBe("connected")

  expect(captured).toBeTypeOf("function")
  for (const events of cycles) captured!(events)

  const sent = await drainQueued(reader)
  // Cancelling unsubscribes and clears the heartbeat interval.
  await reader.cancel()
  return sent
}

/**
 * Push `events` through the gate as one cycle and return the events it
 * forwarded, one entry per event under its own `event` name, so the
 * assertions read as they did when each delta was its own frame.
 */
async function emitThroughGate(events: any[]): Promise<SentEvent[]> {
  const frames = await emitFramesThroughGate([events])
  for (const frame of frames) expect(frame.event).toBe("batch")
  return frames.flatMap(frame => (frame.data as any[]).map(d => ({ event: d.event, data: d })))
}

const VM_PROD = {
  event: "vm:update" as const,
  connId: "connA",
  node: "n1",
  type: "qemu",
  vmid: "100",
  status: "running",
  tags: "prod",
}

const VM_STAGING = {
  event: "vm:update" as const,
  connId: "connA",
  node: "n1",
  type: "qemu",
  vmid: "101",
  status: "running",
  tags: "staging",
}

/** Predicate standing in for a `tag=prod` grant. */
function prodOnly() {
  return vi.fn((guest: any) => String(guest.tags ?? "").split(/[;,]/).includes("prod"))
}

describe("GET /api/v1/inventory/events tag/pool guest-derived delta gate", () => {
  beforeEach(() => {
    tenantConnectionIdsMock.mockResolvedValue(new Set(["connA"]))
    getInfraMock.mockResolvedValue({ kind: "provider" })
  })

  it("tag-scoped user receives vm events for guests the predicate accepts", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map(),
      guestDerived: true,
    })
    const check = prodOnly()
    loadGuestVisibilityCheckMock.mockResolvedValue(check)

    const sent = await emitThroughGate([VM_PROD, VM_STAGING])

    expect(sent.map(e => e.data.vmid)).toEqual(["100"])
    // The gate must hand the guest metadata (tags included) to the predicate,
    // which is exactly what the poller now carries on vm:* events.
    expect(check).toHaveBeenCalledWith(expect.objectContaining({ vmid: "100", tags: "prod" }))
  })

  it("tag-scoped user receives vm:added and vm:removed for accepted guests too", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map(),
      guestDerived: true,
    })
    loadGuestVisibilityCheckMock.mockResolvedValue(prodOnly())

    const sent = await emitThroughGate([
      { ...VM_PROD, event: "vm:added" },
      { ...VM_STAGING, event: "vm:added" },
      { ...VM_PROD, event: "vm:removed" },
      { ...VM_STAGING, event: "vm:removed" },
    ])

    expect(sent.map(e => `${e.event}:${e.data.vmid}`)).toEqual(["vm:added:100", "vm:removed:100"])
  })

  it("tag-scoped user receives no node:update without a node grant", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map(),
      guestDerived: true,
    })
    loadGuestVisibilityCheckMock.mockResolvedValue(prodOnly())

    const sent = await emitThroughGate([
      { event: "node:update", connId: "connA", node: "n1", status: "online" },
    ])

    expect(sent).toEqual([])
  })

  it("tag-scoped user with an extra node grant still gets that node:update", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["connA", new Set(["n1"])]]),
      guestDerived: true,
    })
    loadGuestVisibilityCheckMock.mockResolvedValue(prodOnly())

    const sent = await emitThroughGate([
      { event: "node:update", connId: "connA", node: "n1", status: "online" },
      { event: "node:update", connId: "connA", node: "n2", status: "online" },
      // Not tagged prod, but sitting on a granted node: the node grant wins.
      { ...VM_STAGING, node: "n1" },
    ])

    expect(sent.map(e => `${e.event}:${e.data.node}`)).toEqual([
      "node:update:n1",
      "vm:update:n1",
    ])
  })

  it("node-scoped user is unaffected: granted node passes, other node dropped", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u3", isAdmin: false, tenantId: "t1" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map([["connA", new Set(["n1"])]]),
      guestDerived: false,
    })

    const sent = await emitThroughGate([
      { ...VM_PROD, tags: undefined },
      { event: "vm:update", connId: "connA", node: "n2", type: "qemu", vmid: "200", status: "running" },
      { event: "node:update", connId: "connA", node: "n1", status: "online" },
    ])

    expect(sent.map(e => e.data.vmid ?? e.data.node)).toEqual(["100", "n1"])
    // No guest-derived grant => no predicate load at all.
    expect(loadGuestVisibilityCheckMock).not.toHaveBeenCalled()
  })

  it("connection-scoped user is unaffected: every node of the connection passes", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u4", isAdmin: false, tenantId: "t1" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set(["connA"]),
      nodesByConnection: new Map(),
      guestDerived: false,
    })

    const sent = await emitThroughGate([
      VM_STAGING,
      { event: "node:update", connId: "connA", node: "n7", status: "online" },
    ])

    expect(sent.map(e => e.event)).toEqual(["vm:update", "node:update"])
    expect(loadGuestVisibilityCheckMock).not.toHaveBeenCalled()
  })

  it("admin (null scope) receives everything", async () => {
    const sent = await emitThroughGate([
      { event: "vm:update", connId: "connA", node: "n9", type: "qemu", vmid: "900", status: "running" },
    ])

    expect(sent).toHaveLength(1)
    expect(getRbacInfraScopeMock).not.toHaveBeenCalled()
    expect(loadGuestVisibilityCheckMock).not.toHaveBeenCalled()
  })

  it("an event from a connection outside the tenant is always dropped", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map(),
      guestDerived: true,
    })
    loadGuestVisibilityCheckMock.mockResolvedValue(vi.fn().mockReturnValue(true))

    const sent = await emitThroughGate([{ ...VM_PROD, connId: "connOther" }])

    expect(sent).toEqual([])
  })

  it("a guest-derived scope whose predicate rejects everything receives nothing", async () => {
    getRBACContextMock.mockResolvedValue({ userId: "u2", isAdmin: false, tenantId: "t1" })
    getRbacInfraScopeMock.mockResolvedValue({
      fullConnections: new Set<string>(),
      nodesByConnection: new Map(),
      guestDerived: true,
    })
    loadGuestVisibilityCheckMock.mockResolvedValue(vi.fn().mockReturnValue(false))

    const sent = await emitThroughGate([VM_PROD, VM_STAGING])

    expect(sent).toEqual([])
  })
})

// One poll cycle goes out as one frame, holding only what the gate let through.
describe("GET /api/v1/inventory/events one batch per poll cycle", () => {
  beforeEach(() => {
    tenantConnectionIdsMock.mockResolvedValue(new Set(["connA"]))
    getInfraMock.mockResolvedValue({ kind: "provider" })
  })

  it("sends the survivors of a cycle as a single batch frame, in their order", async () => {
    const frames = await emitFramesThroughGate([[
      VM_PROD,
      // Outside the tenant: filtered out of the batch, not sent on its own.
      { ...VM_STAGING, connId: "connOther" },
      { event: "node:update", connId: "connA", node: "n1", status: "online" },
      { ...VM_PROD, event: "vm:removed" },
    ]])

    expect(frames).toHaveLength(1)
    expect(frames[0].event).toBe("batch")
    expect(frames[0].data.map((d: any) => `${d.event}:${d.vmid ?? d.node}`)).toEqual([
      "vm:update:100",
      "node:update:n1",
      "vm:removed:100",
    ])
  })

  it("sends one frame per cycle", async () => {
    const frames = await emitFramesThroughGate([[VM_PROD], [VM_STAGING, VM_PROD]])

    expect(frames.map(f => f.event)).toEqual(["batch", "batch"])
    expect(frames.map(f => f.data.length)).toEqual([1, 2])
  })

  it("sends nothing for a cycle whose every delta is filtered out, or that is empty", async () => {
    expect(await emitFramesThroughGate([[{ ...VM_PROD, connId: "connOther" }]])).toEqual([])
    expect(await emitFramesThroughGate([[]])).toEqual([])
  })
})

// A consumer that stops reading without closing its connection
// never fires cancel(), so the route has to release it on its own.
describe("GET /api/v1/inventory/events consumer lifecycle", () => {
  let handler: ((evs: any[]) => void) | null
  let unsubscribe: ReturnType<typeof vi.fn>

  // One poll cycle: ~640 KiB of vm:update deltas by default, about a cycle on
  // a large estate. Two left unread exceed MAX_UNREAD_BYTES (1 MiB).
  const burst = (events = 2000) =>
    Array.from({ length: events }, (_, i) => ({ ...VM_EVENT, vmid: i, name: "x".repeat(200) }))

  const decoder = new TextDecoder()

  /** The events of the next frame, which has to be a batch. */
  async function readBatch(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<any[]> {
    const text = decoder.decode((await reader.read()).value)
    expect(text.startsWith("event: batch\ndata: ")).toBe(true)
    return JSON.parse(text.slice("event: batch\ndata: ".length))
  }

  beforeEach(() => {
    getInfraMock.mockResolvedValue({ kind: "provider" })
    handler = null
    unsubscribe = vi.fn()
    subscribeMock.mockImplementation((fn: (evs: any[]) => void) => {
      handler = fn
      return unsubscribe
    })
  })

  it("drops a consumer that left more than the bound unread, at the next delivery", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })

    // The first cycle finds nothing unread, the second ~640 KiB: both are
    // enqueued, and together they leave ~1.3 MiB unread.
    handler!(burst())
    handler!(burst())
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()

    // The third finds more than the bound unread and drops the consumer.
    handler!(burst())
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Dropping an SSE consumer"))

    // The queue is discarded: the body errors instead of replaying megabytes.
    await expect(res.body!.getReader().read()).rejects.toThrow("SSE consumer stopped reading")
    warn.mockRestore()
  })

  it("keeps a consumer handed one delivery larger than the bound, and lets it read the whole of it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    const reader = res.body!.getReader()
    expect(decoder.decode((await reader.read()).value)).toContain("event: connected")

    // ~1.3 MiB in one message, past MAX_UNREAD_BYTES on its own.
    handler!(burst(4000))
    expect(unsubscribe).not.toHaveBeenCalled()
    expect(warn).not.toHaveBeenCalled()

    // It arrives whole, and once drained the next cycle is taken as usual.
    expect(await readBatch(reader)).toHaveLength(4000)
    handler!(burst())
    expect(await readBatch(reader)).toHaveLength(2000)
    expect(unsubscribe).not.toHaveBeenCalled()

    await reader.cancel()
    warn.mockRestore()
  })

  it("drops a consumer that left one oversized delivery unread, at the next delivery", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })

    handler!(burst(4000))
    expect(unsubscribe).not.toHaveBeenCalled()

    // Still unread a cycle later: the queue is bounded to MAX_UNREAD_BYTES plus
    // one delivery, however small the next one is.
    handler!([VM_EVENT])
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("Dropping an SSE consumer"))
    await expect(res.body!.getReader().read()).rejects.toThrow("SSE consumer stopped reading")
    warn.mockRestore()
  })

  it("keeps a consumer that reads, however much it receives", async () => {
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })
    const reader = res.body!.getReader()
    expect(decoder.decode((await reader.read()).value)).toContain("event: connected")

    for (let i = 0; i < 40; i++) {
      handler!(burst())
      expect(await readBatch(reader)).toHaveLength(2000)
    }
    expect(unsubscribe).not.toHaveBeenCalled()
    reader.releaseLock()
  })

  it("unsubscribes when the request is aborted, even if cancel() never fires", async () => {
    const { NextRequest } = await import("next/server")
    const ac = new AbortController()
    const { GET } = await import("./route")
    await GET(new NextRequest("http://test.local/api/v1/inventory/events", { signal: ac.signal }))

    expect(unsubscribe).not.toHaveBeenCalled()
    ac.abort()
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    // Idempotent with the later paths.
    handler!(burst())
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })
  it("tears down once even when the drop happens inside subscribe() and cancel() follows", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    subscribeMock.mockImplementation((fn: (evs: any[]) => void) => {
      handler = fn
      for (let i = 0; i < 3; i++) fn(burst())
      return unsubscribe
    })
    const { GET } = await import("./route")
    const res = await callRoute(GET, { method: "GET" })

    // Dropped before subscribe() returned: the route still unsubscribes.
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    await res.body!.cancel().catch(() => {})
    expect(unsubscribe).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it("tears down right away when the request is already aborted", async () => {
    const { NextRequest } = await import("next/server")
    const ac = new AbortController()
    ac.abort()
    const { GET } = await import("./route")
    const res = await GET(new NextRequest("http://test.local/api/v1/inventory/events", { signal: ac.signal }))

    expect(unsubscribe).toHaveBeenCalledTimes(1)
    await res.body!.cancel()
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("tears down when an event cannot be serialised", async () => {
    const { GET } = await import("./route")
    await callRoute(GET, { method: "GET" })

    handler!([{ ...VM_EVENT, mem: BigInt(1) }])
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("sends a heartbeat every 30 seconds and stops it on cancel", async () => {
    vi.useFakeTimers()
    try {
      const { GET } = await import("./route")
      const res = await callRoute(GET, { method: "GET" })
      const reader = res.body!.getReader()
      const decoder = new TextDecoder()

      expect(decoder.decode((await reader.read()).value)).toContain("event: connected")
      vi.advanceTimersByTime(30_000)
      expect(decoder.decode((await reader.read()).value)).toContain("event: heartbeat")

      await reader.cancel()
      expect(unsubscribe).toHaveBeenCalledTimes(1)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
