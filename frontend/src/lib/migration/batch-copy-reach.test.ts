import { describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ conn: null as any, ifaces: {} as Record<string, any>, reach: {} as Record<string, any> }))
vi.mock("@/lib/tenant", () => ({ getTenantPrisma: vi.fn(() => ({ connection: { findUnique: vi.fn(async () => h.conn) } })) }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "administrator@vsphere.local:pw") }))
vi.mock("@/lib/vmware/soap", () => ({ soapLogin: vi.fn(async () => ({ isVcenter: true })), soapLogout: vi.fn(async () => {}) }))
vi.mock("@/lib/vmware/vmkernel", () => ({
  soapGetVmCopyInterfaces: vi.fn(async (_s: any, id: string) => { if (!h.ifaces[id]) throw new Error("VM not found"); return h.ifaces[id] }),
}))
vi.mock("@/lib/migration/warm/nfc-reachability", () => ({
  runWarmCopyReachability: vi.fn(async (_c: string, node: string, address: string) => h.reach[`${node}|${address}`] ?? { address, ports: { 902: true }, ok: true }),
}))

import { checkBatchCopyNetwork, pairKey, planCopyNodes, probeCopyPairs, readBatchCopyTargets, type VmCopyTarget } from "./batch-copy-reach"
import { runWarmCopyReachability } from "@/lib/migration/warm/nfc-reachability"

const host21 = { hostName: "10.42.0.21", defaultDevice: "vmk2", vnics: [{ device: "vmk0", address: "10.42.0.21" }, { device: "vmk1", address: "192.168.1.103" }, { device: "vmk2", address: "10.42.53.21" }] }
const host22 = { hostName: "10.42.0.22", defaultDevice: "vmk0", vnics: [{ device: "vmk0", address: "10.42.0.22" }] }
const t = (host: string, device: string, address: string): VmCopyTarget => ({ ok: true, host, device, address, direct: false })
const ok = { address: "", ports: { 902: true }, ok: true }
const closed = { address: "", ports: { 902: false }, ok: false }
const vms = [{ sourceVmId: "v1", name: "r53-src-1" }, { sourceVmId: "v2", name: "r53-src-2" }, { sourceVmId: "v3", name: "r53-src-3" }]

describe("planCopyNodes (roadmap#53)", () => {
  const targets = new Map<string, VmCopyTarget>([["v1", t("10.42.0.21", "vmk2", "10.42.53.21")], ["v2", t("10.42.0.21", "vmk2", "10.42.53.21")], ["v3", t("10.42.0.22", "vmk0", "10.42.0.22")]])
  // pve1 alone is on the copy subnet; every node reaches management.
  const reach = new Map([
    [pairKey("pve1", "10.42.53.21", false), ok], [pairKey("pve2", "10.42.53.21", false), closed], [pairKey("pve3", "10.42.53.21", false), closed],
    [pairKey("pve1", "10.42.0.22", false), ok], [pairKey("pve2", "10.42.0.22", false), ok], [pairKey("pve3", "10.42.0.22", false), ok],
  ])

  it("Auto: places each VM only on the nodes that reach its adapter, balanced, and says which were left out", () => {
    const plan = planCopyNodes({ vms, candidates: ["pve1", "pve2", "pve3"], auto: true, targets, reach })
    expect(plan.assignment).toEqual({ v1: "pve1", v2: "pve1", v3: "pve2" })
    expect(plan.problems).toEqual([])
    expect(plan.infos).toEqual([
      { vm: "r53-src-1", nodes: ["pve1"], excluded: ["pve2", "pve3"] },
      { vm: "r53-src-2", nodes: ["pve1"], excluded: ["pve2", "pve3"] },
    ])
  })

  it("Auto: plain round-robin when every node reaches everything", () => {
    const all = new Map([...reach.keys()].map(k => [k, ok]))
    expect(planCopyNodes({ vms, candidates: ["pve1", "pve2", "pve3"], auto: true, targets, reach: all }).assignment).toEqual({ v1: "pve1", v2: "pve2", v3: "pve3" })
  })

  it("Auto: blocks a VM no node can reach", () => {
    const plan = planCopyNodes({ vms: [vms[0]], candidates: ["pve2", "pve3"], auto: true, targets, reach })
    expect(plan.assignment).toEqual({ v1: null })
    expect(plan.problems).toEqual([expect.objectContaining({ kind: "noNode", message: "No target node can reach the copy network of r53-src-1: vmk2 10.42.53.21 (host 10.42.0.21)" })])
  })

  it("explicit node: one problem per unreachable (node, adapter), naming its VMs", () => {
    const plan = planCopyNodes({ vms, candidates: ["pve3"], auto: false, targets, reach })
    expect(plan.assignment).toEqual({ v1: "pve3", v2: "pve3", v3: "pve3" })
    expect(plan.problems).toEqual([expect.objectContaining({ kind: "unreachable", node: "pve3", vms: ["r53-src-1", "r53-src-2"], message: "pve3 cannot reach vmk2 10.42.53.21 (host 10.42.0.21) on port 902" })])
  })

  it("explicit per-VM nodes (the server re-check of a batch request)", () => {
    const plan = planCopyNodes({ vms, candidates: ["pve1", "pve2"], auto: false, requested: { v1: "pve1", v2: "pve2", v3: "pve2" }, targets, reach })
    expect(plan.problems.map(p => p.message)).toEqual(["pve2 cannot reach vmk2 10.42.53.21 (host 10.42.0.21) on port 902"])
  })

  // roadmap#175: the node must also reach the vCenter the VDDK logs in to.
  const vcDown = { address: "", ports: { 902: true }, ok: false, vcenter: { host: "vc.lab", resolved: true, open: false } }
  const vcUnresolved = { address: "", ports: { 902: true }, ok: false, vcenter: { host: "vc.lab", resolved: false, open: false } }

  it("explicit node: names the vCenter a node cannot reach or resolve", () => {
    const one = new Map<string, VmCopyTarget>([["v3", t("10.42.0.22", "vmk0", "10.42.0.22")]])
    const down = planCopyNodes({ vms: [vms[2]], candidates: ["pve3"], auto: false, targets: one, reach: new Map([[pairKey("pve3", "10.42.0.22", false), vcDown]]) })
    expect(down.problems).toEqual([expect.objectContaining({ kind: "unreachable", vcenter: vcDown.vcenter, ports: [], message: "pve3 cannot reach the vCenter vc.lab on port 443" })])
    const unresolved = planCopyNodes({ vms: [vms[2]], candidates: ["pve3"], auto: false, targets: one, reach: new Map([[pairKey("pve3", "10.42.0.22", false), vcUnresolved]]) })
    expect(unresolved.problems[0].message).toBe("pve3 cannot resolve the vCenter name vc.lab")
  })

  it("Auto: excludes the nodes that cannot reach the vCenter, and blames the vCenter when none can", () => {
    const one = new Map<string, VmCopyTarget>([["v3", t("10.42.0.22", "vmk0", "10.42.0.22")]])
    const some = planCopyNodes({ vms: [vms[2]], candidates: ["pve1", "pve2"], auto: true, targets: one, reach: new Map([[pairKey("pve1", "10.42.0.22", false), vcDown], [pairKey("pve2", "10.42.0.22", false), ok]]) })
    expect(some).toMatchObject({ assignment: { v3: "pve2" }, problems: [], infos: [{ vm: "r53-src-3", nodes: ["pve2"], excluded: ["pve1"] }] })
    const none = planCopyNodes({ vms: [vms[2]], candidates: ["pve1", "pve2"], auto: true, targets: one, reach: new Map([[pairKey("pve1", "10.42.0.22", false), vcDown], [pairKey("pve2", "10.42.0.22", false), vcDown]]) })
    expect(none.problems).toEqual([expect.objectContaining({ kind: "noNode", vcenter: vcDown.vcenter, message: "No target node can reach the vCenter vc.lab on port 443, needed to copy r53-src-3" })])
    const mixed = planCopyNodes({ vms: [vms[2]], candidates: ["pve1", "pve2"], auto: true, targets: one, reach: new Map([[pairKey("pve1", "10.42.0.22", false), vcUnresolved], [pairKey("pve2", "10.42.0.22", false), closed]]) })
    expect(mixed.problems[0]).not.toHaveProperty("vcenter")
  })

  it("leaves a VM whose adapter could not be read where it was asked, unchecked", () => {
    const partial = new Map<string, VmCopyTarget>([["v1", { ok: false, error: "VM not found" }]])
    const plan = planCopyNodes({ vms: [vms[0]], candidates: ["pve2"], auto: false, targets: partial, reach })
    expect(plan).toMatchObject({ assignment: { v1: "pve2" }, problems: [], unchecked: ["v1"] })
  })
})

describe("reading and probing", () => {
  it("reads the pinned or default adapter of each VM's host", async () => {
    h.conn = { type: "vmware", baseUrl: "https://vc/", apiTokenEnc: "e", insecureTLS: true }
    h.ifaces = { v1: host21, v3: host22 }
    const m = await readBatchCopyTargets("default", "vc", ["v1", "v3", "gone"])
    expect(m.get("v1")).toEqual({ ok: true, host: "10.42.0.21", device: "vmk2", address: "10.42.53.21", direct: false, vcenterHost: "vc" })
    expect(m.get("v3")).toEqual({ ok: true, host: "10.42.0.22", device: "vmk0", address: "10.42.0.22", direct: false, vcenterHost: "vc" })
    expect(m.get("gone")).toMatchObject({ ok: false })
    expect((await readBatchCopyTargets("default", "vc", ["v1"], "vmk1")).get("v1")).toMatchObject({ device: "vmk1", address: "192.168.1.103" })
    expect((await readBatchCopyTargets("default", "vc", ["v3"], "vmk9")).get("v3")).toMatchObject({ ok: false })
    h.conn = { type: "xcpng", baseUrl: "https://x", apiTokenEnc: "e", insecureTLS: true }
    expect((await readBatchCopyTargets("default", "x", ["v1"])).get("v1")).toMatchObject({ ok: false })
  })

  it("probes each distinct (node, address) once", async () => {
    vi.mocked(runWarmCopyReachability).mockClear()
    const m = await probeCopyPairs("pve", [{ node: "pve1", address: "a", direct: false }, { node: "pve1", address: "a", direct: false }, { node: "pve2", address: "a", direct: false }])
    expect(runWarmCopyReachability).toHaveBeenCalledTimes(2)
    expect(m.size).toBe(2)
  })

  it("hands the vCenter to the probe (roadmap#175)", async () => {
    vi.mocked(runWarmCopyReachability).mockClear()
    await probeCopyPairs("pve", [{ node: "pve1", address: "a", direct: false, vcenterHost: "vc.lab" }])
    expect(runWarmCopyReachability).toHaveBeenCalledWith("pve", "pve1", "a", false, "vc.lab")
  })

  it("puts it together: pinned vSAN adapter, reachable from no node", async () => {
    h.conn = { type: "vmware", baseUrl: "https://esxi", apiTokenEnc: "e", insecureTLS: true }
    h.ifaces = { v1: host21, v2: host21 }
    h.reach = { "pve1|192.168.1.103": closed, "pve2|192.168.1.103": closed }
    const plan = await checkBatchCopyNetwork({ tenantId: "default", sourceConnectionId: "esxi", targetConnectionId: "pve", pinnedDevice: "vmk1", vms: vms.slice(0, 2), candidates: ["pve1", "pve2"], auto: true })
    expect(plan.problems.map(p => p.kind)).toEqual(["noNode", "noNode"])
    h.reach = {}
  })
})
