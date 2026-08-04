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
