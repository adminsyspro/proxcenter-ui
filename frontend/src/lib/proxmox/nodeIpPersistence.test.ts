import { describe, expect, it, vi } from "vitest"

import { decideNodeIp, orderedIps, persistNodeIps } from "./nodeIpPersistence"

describe("decideNodeIp", () => {
  const verified = { node: "pve1", ip: "10.42.0.101", verified: true }
  const guess = { node: "pve1", ip: "10.100.5.1", verified: false }
  const nothing = { node: "pve1", ip: null, verified: false }

  it("writes a verified address over anything", () => {
    expect(decideNodeIp(undefined, verified)).toEqual({ ip: "10.42.0.101", ipVerified: true, changed: true })
    expect(decideNodeIp({ ip: "10.100.5.1", ipVerified: false }, verified)).toEqual({ ip: "10.42.0.101", ipVerified: true, changed: true })
    expect(decideNodeIp({ ip: "10.42.0.101", ipVerified: true }, verified)).toEqual({ ip: "10.42.0.101", ipVerified: true, changed: false })
  })

  // roadmap#51: the guess came from a privilege-filtered interface list or
  // from the corosync link of a node that did not answer, both often outside
  // the network ProxCenter is on. The working address stays.
  it("never lets a guess replace a verified address", () => {
    expect(decideNodeIp({ ip: "10.42.0.101", ipVerified: true }, guess)).toEqual({ ip: "10.42.0.101", ipVerified: true, changed: false })
  })

  it("stores a guess over nothing or an older guess", () => {
    expect(decideNodeIp(undefined, guess)).toEqual({ ip: "10.100.5.1", ipVerified: false, changed: true })
    expect(decideNodeIp({ ip: null, ipVerified: true }, guess)).toEqual({ ip: "10.100.5.1", ipVerified: false, changed: true })
    expect(decideNodeIp({ ip: "10.100.5.9", ipVerified: false }, guess)).toEqual({ ip: "10.100.5.1", ipVerified: false, changed: true })
    expect(decideNodeIp({ ip: "10.100.5.1", ipVerified: false }, guess)).toEqual({ ip: "10.100.5.1", ipVerified: false, changed: false })
  })

  // #695: a transient failure must not null a known address.
  it("leaves the row alone when the discovery found no address", () => {
    expect(decideNodeIp({ ip: "10.42.0.101", ipVerified: true }, nothing)).toEqual({ ip: "10.42.0.101", ipVerified: true, changed: false })
    expect(decideNodeIp({ ip: "10.100.5.1", ipVerified: false }, nothing)).toEqual({ ip: "10.100.5.1", ipVerified: false, changed: false })
    expect(decideNodeIp(undefined, nothing)).toEqual({ ip: null, ipVerified: true, changed: false })
  })
})

describe("orderedIps", () => {
  it("lists verified addresses first and skips blanks", () => {
    expect(
      orderedIps([
        { node: "a", ip: "10.100.5.1", ipVerified: false },
        { node: "b", ip: null, ipVerified: true },
        { node: "c", ip: "10.42.0.103", ipVerified: true },
      ]),
    ).toEqual(["10.42.0.103", "10.100.5.1"])
  })
})

describe("persistNodeIps", () => {
  function fakeDb(rows: Array<{ node: string; ip: string | null; ipVerified: boolean }>) {
    return {
      managedHost: {
        findMany: vi.fn().mockResolvedValue(rows),
        upsert: vi.fn().mockResolvedValue({}),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      },
    }
  }
  const byNode = (db: ReturnType<typeof fakeDb>) =>
    new Map(db.managedHost.upsert.mock.calls.map(c => [c[0].where.connectionId_node.node, c[0]]))

  it("upserts each node by the decision, drops nodes that left, and returns what is on file", async () => {
    const db = fakeDb([
      { node: "pve1", ip: "10.42.0.101", ipVerified: true },
      { node: "gone", ip: "10.42.0.109", ipVerified: true },
    ])

    const result = await persistNodeIps(db, {
      connectionId: "c-1",
      tenantId: "msp-1",
      nodes: [
        { node: "pve1", ip: "10.100.5.1", verified: false },
        { node: "pve2", ip: "10.100.5.2", verified: false },
        { node: "pve3", ip: "10.42.0.103", verified: true },
      ],
    })

    const calls = byNode(db)
    expect(calls.get("pve1")!.update).toEqual({})
    expect(calls.get("pve2")!.update).toEqual({ ip: "10.100.5.2", ipVerified: false })
    expect(calls.get("pve2")!.create).toEqual({ connectionId: "c-1", node: "pve2", ip: "10.100.5.2", ipVerified: false, tenantId: "msp-1" })
    expect(calls.get("pve3")!.update).toEqual({ ip: "10.42.0.103", ipVerified: true })
    expect(db.managedHost.deleteMany).toHaveBeenCalledWith({ where: { connectionId: "c-1", node: { notIn: ["pve1", "pve2", "pve3"] } } })
    expect(result.ips).toEqual(["10.42.0.101", "10.42.0.103", "10.100.5.2"])
    expect(result.byNode.get("pve1")).toEqual({ node: "pve1", ip: "10.42.0.101", ipVerified: true })
  })

  it("omits tenantId from created rows when the caller gives none, and deletes nothing without nodes", async () => {
    const db = fakeDb([])

    await persistNodeIps(db, { connectionId: "c-1", nodes: [{ node: "pve1", ip: "10.42.0.101", verified: true }] })
    expect(byNode(db).get("pve1")!.create).toEqual({ connectionId: "c-1", node: "pve1", ip: "10.42.0.101", ipVerified: true })

    const empty = fakeDb([])
    await persistNodeIps(empty, { connectionId: "c-1", nodes: [] })
    expect(empty.managedHost.deleteMany).not.toHaveBeenCalled()
  })
})
