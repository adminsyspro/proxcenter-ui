import { describe, expect, it } from "vitest"

import type { VdcScope } from "@/lib/vdc/scope"

import {
  iaasClusterOptionsView,
  iaasConnectionView,
  iaasInventoryClusterView,
  iaasInventoryNodeView,
  iaasMappingsView,
  iaasNodeAllowed,
  iaasNodeStatusView,
  iaasNodeView,
  iaasPoolsView,
  iaasSdnZoneView,
  iaasStorageView,
} from "./iaasView"

// roadmap#189: what an IaaS tenant may read of the provider cluster its vDC sits on.
const scope = {
  nodesByConnection: new Map([["c1", new Set(["pve2", "pve3"])]]),
  poolsByConnection: new Map([["c1", new Set(["vdc-acme"])]]),
} as unknown as VdcScope

describe("iaasConnectionView", () => {
  it("keeps the name and type, drops the address, the nodes, SSH and the location", () => {
    const view = iaasConnectionView({
      id: "c1", name: "PVE-PROD", type: "pve", subType: null, tenantId: "default",
      baseUrl: "https://10.0.0.1:8006", behindProxy: false, insecureTLS: true, hasCeph: true, cephExporterPort: 9926,
      hosts: [{ node: "pve1", ip: "10.0.0.1" }], sshEnabled: true, sshUser: "root", sshPort: 22, sshUseSudo: false,
      sshConfigured: true, apiUser: null, replicationNetwork: "10.9.0.0/24", fingerprint: "AA:BB", latitude: 45.7,
      longitude: 4.8, locationLabel: "Lyon", country: "FR", createdAt: "t0", updatedAt: "t1",
    })
    expect(view).toEqual({ id: "c1", name: "PVE-PROD", type: "pve", subType: null, createdAt: "t0", updatedAt: "t1", hasCeph: false })
  })
})

describe("node views", () => {
  it("a /nodes row keeps the placement capacity and state only", () => {
    const view = iaasNodeView({
      node: "pve2", id: "node/pve2", type: "node", status: "online", hastate: "maintenance", cpu: 0.1, maxcpu: 8,
      mem: 1, maxmem: 2, disk: 3, maxdisk: 4, uptime: 5, ip: "10.0.0.2", ipVerified: true, ssl_fingerprint: "AA",
      sshAddress: "10.0.0.2", sshPort: 22, hostId: "h1", pveversion: "9.2", bridges: { native: ["vmbr0"] }, level: "c",
    })
    expect(view).toEqual({
      node: "pve2", id: "node/pve2", type: "node", status: "online", hastate: "maintenance", cpu: 0.1, maxcpu: 8,
      mem: 1, maxmem: 2, disk: 3, maxdisk: 4, uptime: 5,
    })
  })

  it("a node status keeps the CPU topology only", () => {
    expect(iaasNodeStatusView({
      cpuinfo: { cpus: 8, cores: 4, sockets: 2, model: "Xeon", flags: "fpu" }, pveversion: "9.2", kversion: "Linux 7", memory: { total: 1 },
    })).toEqual({ cpuinfo: { cpus: 8, cores: 4, sockets: 2 } })
    expect(iaasNodeStatusView(null)).toEqual({ cpuinfo: {} })
  })

  it("only the vDC nodes of the connection are allowed", () => {
    expect(iaasNodeAllowed(scope, "c1", "pve2")).toBe(true)
    expect(iaasNodeAllowed(scope, "c1", "pve1")).toBe(false)
    expect(iaasNodeAllowed(scope, "c2", "pve2")).toBe(false)
  })
})

describe("datacenter options, pools and storages", () => {
  it("options keep the tag style only, nothing when it is unset", () => {
    expect(iaasClusterOptionsView({ "tag-style": "shape=circle", keyboard: "fr", "allowed-tags": ["acme"], mac_prefix: "BC:24:11" }))
      .toEqual({ "tag-style": "shape=circle" })
    expect(iaasClusterOptionsView({ keyboard: "fr" })).toEqual({})
    expect(iaasClusterOptionsView(undefined)).toEqual({})
  })

  it("pools are narrowed to the tenant's vDC pools on that connection", () => {
    const pools = [{ poolid: "vdc-acme", comment: "a" }, { poolid: "vdc-globex", comment: "g" }, { poolid: 3 }, { comment: "no id" }]
    expect(iaasPoolsView(pools, scope, "c1")).toEqual([{ poolid: "vdc-acme", comment: "a" }])
    expect(iaasPoolsView(pools, scope, "c2")).toEqual([])
  })

  it("storage rows lose the backend addressing and keep the rest", () => {
    const view = iaasStorageView({
      storage: "pbs1", type: "pbs", datastore: "ds", used: 1, total: 2, path: "/mnt", server: "10.0.0.9",
      export: "/exp", monhost: "10.0.0.1", fingerprint: "AA",
    })
    expect(view).toEqual({
      storage: "pbs1", type: "pbs", datastore: "ds", used: 1, total: 2, path: null, server: null, export: null, monhost: null, fingerprint: null,
    })
  })
})

describe("iaasMappingsView", () => {
  it("keeps the mappings covering a vDC node, as node names only", () => {
    const view = iaasMappingsView([
      { id: "gpu", description: "A5000", map: ["node=pve2,path=0000:01:00.0,id=10de:2231", "node=pve1,path=0000:02:00.0", "node=pve2,path=0000:03:00.0"], checks: [{ message: "ok" }] },
      { id: "other", map: ["node=pve1,path=0000:04:00.0"] },
      { id: "nomap" },
      { id: "usb", map: ["id=1234:5678,node=pve3"] },
    ], scope, "c1")
    expect(view).toEqual([
      { id: "gpu", description: "A5000", checks: [{ message: "ok" }], map: ["node=pve2"] },
      { id: "usb", map: ["node=pve3"] },
    ])
  })
})

describe("SDN zones and inventory", () => {
  it("a zone keeps its name, type and state, never the VXLAN peers or controller", () => {
    expect(iaasSdnZoneView({ zone: "z1", type: "vxlan", state: "new", mtu: 1450, peers: "10.0.0.1,10.0.0.2", controller: "evpn", exitnodes: "pve1", pending: { peers: "x" }, digest: "d" }))
      .toEqual({ zone: "z1", type: "vxlan", state: "new", mtu: 1450, digest: "d" })
  })

  it("an inventory cluster loses its addressing and SSH settings, keeps the location", () => {
    expect(iaasInventoryClusterView({ id: "c1", name: "PVE", baseUrl: "https://x", hosts: [], sshEnabled: true, behindProxy: false, insecureTLS: true, latitude: 1, locationLabel: "Lyon", nodes: [] }))
      .toEqual({ id: "c1", name: "PVE", latitude: 1, locationLabel: "Lyon", nodes: [] })
  })

  it("an inventory node loses its addresses, certificate and SSH endpoint, keeps the rest", () => {
    expect(iaasInventoryNodeView({ node: "pve2", status: "online", cpu: 0.2, ip: "10.0.0.2", ips: ["10.0.0.2"], ipVerified: true, ssl_fingerprint: "AA", sshAddress: "x", sshPort: 22, hostId: "h", pveVersion: "9.2" }))
      .toEqual({ node: "pve2", status: "online", cpu: 0.2, pveVersion: "9.2" })
  })
})
