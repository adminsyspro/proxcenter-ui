import { describe, expect, it } from "vitest"

import { applyVdcFilter, type VdcScope } from "./scope"

// roadmap#189: the vDC mask of the inventory (route, SSE stream, assistant
// snapshot) also removes the provider's addressing, cluster and node alike.
const scope = {
  nodesByConnection: new Map([["c1", new Set(["pve2"])]]),
  poolsByConnection: new Map([["c1", new Set(["vdc-acme"])]]),
} as unknown as VdcScope

const cluster = () => ({
  id: "c1",
  name: "PVE-PROD",
  sshEnabled: true,
  baseUrl: "https://10.0.0.1:8006",
  latitude: 45.7,
  nodes: [
    { node: "pve1", ip: "10.0.0.1", guests: [] },
    {
      node: "pve2", ip: "10.0.0.2", ips: ["10.0.0.2", "10.9.0.2"], ssl_fingerprint: "AA", status: "online", pveVersion: "9.2",
      guests: [{ vmid: 1, pool: "vdc-acme" }, { vmid: 2, pool: "vdc-globex" }],
    },
  ],
})

describe("applyVdcFilter addressing", () => {
  it("a vDC tenant gets its nodes and guests without node or cluster addresses", () => {
    const out = applyVdcFilter(cluster(), scope)
    expect(out).not.toHaveProperty("sshEnabled")
    expect(out).not.toHaveProperty("baseUrl")
    expect(out.latitude).toBe(45.7)
    expect(out.nodes).toEqual([{ node: "pve2", status: "online", pveVersion: "9.2", guests: [{ vmid: 1, pool: "vdc-acme" }] }])
  })

  it("a cluster without any of its vDCs is emptied and loses its addressing too", () => {
    const out = applyVdcFilter({ ...cluster(), id: "c9" }, scope)
    expect(out.nodes).toEqual([])
    expect(out).not.toHaveProperty("baseUrl")
  })

  it("no scope (provider, msp): the cluster is returned untouched", () => {
    const c = cluster()
    expect(applyVdcFilter(c, null)).toBe(c)
  })
})
