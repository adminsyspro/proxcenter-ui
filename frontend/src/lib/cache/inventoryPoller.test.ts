import { beforeEach, describe, expect, it, vi } from "vitest"

import type { InventoryEvent } from "./inventoryPoller"

/**
 * The poller must carry the raw PVE `tags` string on every vm:* event, exactly
 * where `pool` is already carried, so the SSE delta gate can match tag grants
 * without a DB round-trip per event (issue #633).
 */

const { findManyMock, pveFetchMock } = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    connection: {
      findMany: (...a: any[]) => findManyMock(...a),
      findUnique: vi.fn().mockResolvedValue({ tenantId: "t1" }),
    },
  },
}))

vi.mock("@/lib/connections/getConnection", () => ({
  getConnectionById: vi.fn().mockResolvedValue({ baseUrl: "https://pve.local", apiToken: "tok" }),
}))

vi.mock("@/lib/proxmox/client", () => ({
  pveFetch: (...a: any[]) => pveFetchMock(...a),
}))

// Auto-HA disabled: getSetting returns nothing for auto_ha:<connId>
vi.mock("@/lib/db/settings", () => ({
  getSetting: vi.fn().mockResolvedValue(null),
}))

vi.mock("@/lib/proxmox/discoverNodeIps", () => ({
  discoverNodeIps: vi.fn().mockResolvedValue(undefined),
}))

// Healthy connection: no periodic IP re-discovery
vi.mock("@/lib/cache/nodeIpCache", () => ({
  getFailureCount: () => 0,
  getNodeIps: () => ["10.0.0.1"],
}))

type Poller = typeof import("./inventoryPoller")

let poller: Poller

/** Let the un-awaited pollAll() chain settle. */
async function settle() {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * Bootstrap the poller with `first`, then poll again with `second`, returning
 * the events emitted by that second cycle only (the bootstrap poll emits none).
 */
async function pollTwice(first: any[], second: any[]): Promise<InventoryEvent[]> {
  const received: InventoryEvent[] = []
  pveFetchMock.mockResolvedValue(first)
  const unsubscribe = poller.subscribe(events => received.push(...events))
  await settle()
  expect(received).toEqual([])

  pveFetchMock.mockResolvedValue(second)
  poller.triggerPoll()
  await settle()
  unsubscribe()
  return received
}

beforeEach(async () => {
  vi.clearAllMocks()
  // Fresh module state: prevState / firstPollComplete are module-level.
  vi.resetModules()
  findManyMock.mockResolvedValue([{ id: "connA", name: "A", tenantId: "t1" }])
  poller = await import("./inventoryPoller")
})

describe("inventoryPoller tag threading", () => {
  it("carries tags on vm:added for a newly seen guest", async () => {
    const events = await pollTwice(
      [],
      [{ type: "qemu", vmid: 100, node: "n1", status: "running", pool: "poolA", tags: "prod;web" }],
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: "vm:added", vmid: 100, pool: "poolA", tags: "prod;web" })
  })

  it("carries tags on vm:update", async () => {
    const events = await pollTwice(
      [{ type: "qemu", vmid: 100, node: "n1", status: "stopped", pool: "poolA", tags: "prod" }],
      [{ type: "qemu", vmid: 100, node: "n1", status: "running", pool: "poolA", tags: "prod" }],
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: "vm:update", vmid: 100, pool: "poolA", tags: "prod" })
  })

  it("carries the last known tags on vm:removed when a guest disappears", async () => {
    const events = await pollTwice(
      [{ type: "qemu", vmid: 100, node: "n1", status: "running", pool: "poolA", tags: "prod" }],
      [],
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: "vm:removed", vmid: 100, pool: "poolA", tags: "prod" })
  })

  it("carries tags on both halves of a relocation", async () => {
    const events = await pollTwice(
      [{ type: "qemu", vmid: 100, node: "n1", status: "running", pool: "poolA", tags: "prod" }],
      [{ type: "qemu", vmid: 100, node: "n2", status: "running", pool: "poolB", tags: "prod,web" }],
    )

    expect(events).toHaveLength(2)
    expect(events[0]).toMatchObject({ event: "vm:removed", node: "n1", pool: "poolA", tags: "prod" })
    expect(events[1]).toMatchObject({ event: "vm:added", node: "n2", pool: "poolB", tags: "prod,web" })
  })

  it("leaves node:update untouched (no tags on hosts)", async () => {
    const events = await pollTwice(
      [{ type: "node", node: "n1", status: "online", cpu: 0.1 }],
      [{ type: "node", node: "n1", status: "offline", cpu: 0.1 }],
    )

    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ event: "node:update", node: "n1", status: "offline" })
    expect(events[0]).not.toHaveProperty("tags")
  })
})

/**
 * The guest lock rides on vm:update, so the tree shows a backup or snapshot
 * lock and clears it without reading the whole inventory again (#125).
 * Proxmox omits `lock` when there is none: the release goes out as null.
 */
describe("inventoryPoller guest lock", () => {
  const vm = (over: object = {}) => ({ type: "qemu", vmid: 100, node: "n1", status: "running", ...over })

  it("sends the lock a guest takes", async () => {
    const events = await pollTwice([vm()], [vm({ lock: "backup" })])

    expect(events).toEqual([expect.objectContaining({ event: "vm:update", vmid: 100, lock: "backup" })])
  })

  it("sends null when the lock is released", async () => {
    const events = await pollTwice([vm({ lock: "snapshot" })], [vm()])

    expect(events).toEqual([expect.objectContaining({ event: "vm:update", vmid: 100, lock: null })])
  })

  it("sends nothing while the lock stays the same", async () => {
    expect(await pollTwice([vm({ lock: "backup" })], [vm({ lock: "backup" })])).toEqual([])
  })
})

/**
 * A DR replica lands on its target cluster as a brand new guest, so Auto-HA
 * handed it to the CRM with state "started". That overrides the onboot: 0 the
 * replica config carries on purpose and undoes every `qm stop` a test failover
 * cleanup issues, leaving a second writer on an image the next incremental
 * sync imports into. The orchestrator tags replicas; Auto-HA must skip them.
 */
describe("inventoryPoller Auto-HA", () => {
  async function haCallsFor(guest: any) {
    const { getSetting } = await import("@/lib/db/settings")

    ;(getSetting as any).mockResolvedValue({ enabled: true, state: "started" })
    await pollTwice([], [guest])

    return pveFetchMock.mock.calls.filter(call => call[1] === "/cluster/ha/resources")
  }

  it("enables HA on a guest somebody really did add", async () => {
    const calls = await haCallsFor({ type: "qemu", vmid: 100, node: "n1", status: "running", tags: "prod" })

    expect(calls).toHaveLength(1)
    expect(calls[0][2].body).toContain("sid=vm%3A100")
  })

  it("never enables HA on a DR replica", async () => {
    const calls = await haCallsFor({ type: "qemu", vmid: 9100, node: "n1", status: "stopped", tags: "prod;proxcenter-replica" })

    expect(calls).toEqual([])
  })

  it("matches the tag exactly, not as a substring", async () => {
    const calls = await haCallsFor({ type: "qemu", vmid: 101, node: "n1", status: "running", tags: "proxcenter-replicated" })

    expect(calls).toHaveLength(1)
  })
})

/**
 * POST /api/v1/inventory/poll after every VM action and the 15 s tick used to
 * start cycles on top of each other (#126): one more /cluster/resources read
 * per trigger, and a cycle that read Proxmox first could finish last and send
 * the older state.
 */
describe("inventoryPoller cycles", () => {
  const vm = (status: string) => ({ type: "qemu", vmid: 100, node: "n1", status })
  const resourceReads = () => pveFetchMock.mock.calls.filter(call => call[1] === "/cluster/resources").length

  /** The next /cluster/resources read hangs until the returned function resolves it. */
  function holdNextRead(): (value: any[]) => void {
    let release!: (value: any[]) => void
    pveFetchMock.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    return value => release(value)
  }

  async function bootstrap(received: InventoryEvent[]) {
    pveFetchMock.mockResolvedValue([vm("stopped")])
    const unsubscribe = poller.subscribe(events => received.push(...events))
    await settle()
    return unsubscribe
  }

  it("answers any number of triggers during a cycle with a single follow-up", async () => {
    const unsubscribe = await bootstrap([])
    const release = holdNextRead()

    poller.triggerPoll()
    await settle()
    for (let i = 0; i < 5; i++) poller.triggerPoll()
    await settle()
    expect(resourceReads()).toBe(2)

    release([vm("stopped")])
    await settle()
    expect(resourceReads()).toBe(3)

    await settle()
    expect(resourceReads()).toBe(3)
    unsubscribe()
  })

  it("never sends the state a slower, older cycle read", async () => {
    const received: InventoryEvent[] = []
    const unsubscribe = await bootstrap(received)

    // A cycle reads the guest stopped, then the user starts it and the action
    // triggers again while that read is still out.
    const release = holdNextRead()
    poller.triggerPoll()
    await settle()
    pveFetchMock.mockResolvedValue([vm("running")])
    poller.triggerPoll()
    await settle()

    release([vm("stopped")])
    await settle()

    expect(received).toEqual([expect.objectContaining({ event: "vm:update", vmid: 100, status: "running" })])
    unsubscribe()
  })

  it("skips the interval tick while a cycle runs", async () => {
    vi.useFakeTimers({ toFake: ["setInterval"] })
    try {
      const release = holdNextRead()
      const unsubscribe = poller.subscribe(() => {})
      await settle()

      vi.advanceTimersByTime(15_000)
      await settle()
      expect(resourceReads()).toBe(1)

      release([vm("stopped")])
      await settle()
      expect(resourceReads()).toBe(1)

      pveFetchMock.mockResolvedValue([vm("stopped")])
      vi.advanceTimersByTime(15_000)
      await settle()
      expect(resourceReads()).toBe(2)
      unsubscribe()
    } finally {
      vi.useRealTimers()
    }
  })
})
