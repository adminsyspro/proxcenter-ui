import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  executeSSH: vi.fn(),
  session: { isVcenter: true, baseUrl: "https://vc", cookie: "c", insecureTLS: true, propertyCollector: "pc" } as any,
  soapLogin: vi.fn(),
  soapLogout: vi.fn(async () => {}),
  soapRequest: vi.fn(),
  soapExportVm: vi.fn(),
  soapWaitForNfcLease: vi.fn(),
  soapNfcLeaseAbort: vi.fn(async () => {}),
  endpoint: vi.fn(async (..._a: unknown[]): Promise<string> => "10.42.0.103"),
}))
vi.mock("@/lib/ssh/exec", async (io) => ({ ...(await io<typeof import("@/lib/ssh/exec")>()), executeSSH: h.executeSSH }))
vi.mock("@/lib/crypto/secret", () => ({ decryptSecret: vi.fn(() => "administrator@vsphere.local:pw") }))
vi.mock("@/lib/vmware/soap", async (io) => ({
  ...(await io<typeof import("@/lib/vmware/soap")>()),
  soapLogin: h.soapLogin,
  soapLogout: h.soapLogout,
  soapRequest: h.soapRequest,
  soapExportVm: h.soapExportVm,
  soapWaitForNfcLease: h.soapWaitForNfcLease,
  soapNfcLeaseAbort: h.soapNfcLeaseAbort,
}))
vi.mock("@/lib/connections/getConnection", () => ({ getConnectionById: vi.fn(async () => ({ baseUrl: "https://10.42.0.101:8006" })) }))
vi.mock("./pve-tasks", () => ({ getNodeSshEndpointForMigration: h.endpoint }))
vi.mock("@/lib/db/prisma", () => ({ prisma: {} }))

import {
  buildEndpointProbeCmd, checkColdBatchSourceReach, checkColdSourceReach, describeColdUnreachable, nfcEndpointsOf,
  parseEndpointProbe, probeNfcEndpoints, readExportEndpoints, soapGetVmPowerAndHost, BATCH_MAX_LEASES, MAX_ENDPOINTS,
} from "./cold-source-reach"

const dev = (url: string, disk = true) => ({ key: "k", url, fileSize: 0, disk, targetId: "disk-0.vmdk" })
const vmProps = (powerState: string, host = "host-16") =>
  `<returnval><propSet><name>runtime.host</name><val type="HostSystem">${host}</val></propSet><propSet><name>runtime.powerState</name><val type="VirtualMachinePowerState">${powerState}</val></propSet></returnval>`
const prisma = (conn: any = { baseUrl: "https://vc.lab/", apiTokenEnc: "enc", insecureTLS: true, type: "vmware" }) => ({ connection: { findUnique: vi.fn(async () => conn) } })
/** SSH answer of the probe: endpoint i open when `open[i]`. */
const probeAnswer = (open: boolean[], unresolved: number[] = []) => ({
  success: true,
  output: open.map((o, i) => `${unresolved.includes(i) ? `ep-${i}-resolve=fail\n` : ""}ep-${i}=${o ? "open" : "closed"}`).join("\n"),
})

beforeEach(() => {
  vi.clearAllMocks()
  h.session.isVcenter = true
  h.soapLogin.mockResolvedValue(h.session)
  h.soapRequest.mockResolvedValue({ text: vmProps("poweredOff") })
  h.soapExportVm.mockResolvedValue("lease-1")
  h.soapWaitForNfcLease.mockResolvedValue([dev("https://10.42.0.22/nfc/52c5/disk-0.vmdk")])
  h.executeSSH.mockResolvedValue(probeAnswer([true]))
})

describe("nfcEndpointsOf", () => {
  it("keeps the distinct host:port of the disk URLs, 443 by default", () => {
    expect(nfcEndpointsOf([
      dev("https://10.42.0.22/nfc/a/disk-0.vmdk"),
      dev("https://10.42.0.22/nfc/a/disk-1.vmdk"),
      dev("https://vc-proxy.example.com:8443/nfc/b/disk-2.vmdk"),
      dev("https://10.42.0.99/nfc/a/nvram", false),
    ])).toEqual([{ host: "10.42.0.22", port: 443 }, { host: "vc-proxy.example.com", port: 8443 }])
  })
  it("falls back to every URL when none is flagged as a disk, strips IPv6 brackets, skips garbage", () => {
    expect(nfcEndpointsOf([dev("http://[fd00::21]/nfc/x", false), dev("not a url", false), dev("https://a%20b/nfc", false)]))
      .toEqual([{ host: "fd00::21", port: 80 }])
  })
  it("caps the list", () => {
    const many = Array.from({ length: MAX_ENDPOINTS + 3 }, (_, i) => dev(`https://10.0.0.${i}/nfc/x`))
    expect(nfcEndpointsOf(many)).toHaveLength(MAX_ENDPOINTS)
  })
})

describe("buildEndpointProbeCmd / parseEndpointProbe", () => {
  it("resolves names, probes each endpoint with a bounded /dev/tcp and a marker line", () => {
    const cmd = buildEndpointProbeCmd([{ host: "10.42.0.22", port: 443 }, { host: "vc-proxy.example.com", port: 8443 }])
    expect(cmd).toContain("timeout 5 bash -c 'exec 3<>/dev/tcp/10.42.0.22/443'")
    expect(cmd).not.toContain("ep-0-resolve")
    expect(cmd).toMatch(/timeout 5 getent hosts '?vc-proxy\.example\.com'? >\/dev\/null/)
    expect(cmd).toContain("exec 3<>/dev/tcp/vc-proxy.example.com/8443")
    expect(cmd).toContain('echo "ep-1=closed"')
  })
  it("refuses a host or a port the inner bash -c would interpret", () => {
    expect(() => buildEndpointProbeCmd([{ host: "10.0.0.1/443; touch /tmp/x", port: 443 }])).toThrow(/Invalid NFC host/)
    expect(() => buildEndpointProbeCmd([{ host: "10.0.0.1", port: 0 }])).toThrow(/Invalid NFC port/)
    expect(() => buildEndpointProbeCmd([{ host: "10.0.0.1", port: 1.5 }])).toThrow(/Invalid NFC port/)
  })
  it("reads open, closed and unresolved per endpoint; a missing line is closed", () => {
    const eps = [{ host: "a", port: 443 }, { host: "b", port: 8443 }, { host: "c", port: 443 }]
    expect(parseEndpointProbe("ep-0=open\nep-1-resolve=fail\nep-1=closed", eps)).toEqual([
      { host: "a", port: 443, resolved: true, open: true },
      { host: "b", port: 8443, resolved: false, open: false },
      { host: "c", port: 443, resolved: true, open: false },
    ])
    expect(parseEndpointProbe(undefined, eps.slice(0, 1))).toEqual([{ host: "a", port: 443, resolved: true, open: false }])
  })
})

describe("probeNfcEndpoints", () => {
  it("runs one SSH session bounded by the probe count", async () => {
    h.executeSSH.mockResolvedValue(probeAnswer([true, false]))
    const r = await probeNfcEndpoints("tgt", "10.42.0.103", [{ host: "10.42.0.22", port: 443 }, { host: "10.42.0.23", port: 443 }])
    expect(r).toEqual({ endpoints: [{ host: "10.42.0.22", port: 443, resolved: true, open: true }, { host: "10.42.0.23", port: 443, resolved: true, open: false }] })
    expect(h.executeSSH).toHaveBeenCalledTimes(1)
    expect(h.executeSSH.mock.calls[0][3]).toBe((5 * 2 * 2 + 10) * 1000)
  })
  it("reports an SSH failure as an error, and does nothing without endpoints", async () => {
    h.executeSSH.mockResolvedValue({ success: false, error: "ssh down" })
    expect(await probeNfcEndpoints("tgt", "n", [{ host: "a", port: 443 }])).toEqual({ error: "ssh down" })
    h.executeSSH.mockResolvedValue({ success: false, output: "" })
    expect(await probeNfcEndpoints("tgt", "n", [{ host: "a", port: 443 }])).toEqual({ error: "probe failed" })
    expect(await probeNfcEndpoints("tgt", "n", [])).toEqual({ endpoints: [] })
  })
})

describe("describeColdUnreachable", () => {
  it("names the node and only the endpoints down, and says where the download runs", () => {
    const msg = describeColdUnreachable("pve3", [
      { host: "10.42.0.22", port: 443, resolved: true, open: true },
      { host: "vc-proxy.example.com", port: 8443, resolved: true, open: false },
      { host: "nope.example.com", port: 443, resolved: false, open: false },
    ])
    expect(msg).toContain("The Proxmox node pve3 cannot reach vc-proxy.example.com:8443, nope.example.com (name not resolved on the node)")
    expect(msg).not.toContain("10.42.0.22")
    expect(msg).toContain("runs on the Proxmox node, not on ProxCenter")
  })
})

describe("soapGetVmPowerAndHost / readExportEndpoints", () => {
  it("reads the power state and the host in one call, and refuses an unknown VM", async () => {
    expect(await soapGetVmPowerAndHost(h.session, "vm-1")).toEqual({ powerState: "poweredOff", host: "host-16" })
    h.soapRequest.mockResolvedValue({ text: "<fault>ManagedObjectNotFound</fault>" })
    await expect(soapGetVmPowerAndHost(h.session, "vm-1")).rejects.toThrow(/not found/)
  })
  it("aborts the test lease after reading it, and after a failure too", async () => {
    expect(await readExportEndpoints(h.session, "vm-1")).toEqual([{ host: "10.42.0.22", port: 443 }])
    expect(h.soapNfcLeaseAbort).toHaveBeenCalledWith(h.session, "lease-1")
    h.soapNfcLeaseAbort.mockClear()
    h.soapWaitForNfcLease.mockRejectedValue(new Error("NFC lease error: busy"))
    await expect(readExportEndpoints(h.session, "vm-1")).rejects.toThrow(/busy/)
    expect(h.soapNfcLeaseAbort).toHaveBeenCalledTimes(1)
  })
})

describe("checkColdSourceReach", () => {
  const args = (over: Partial<Parameters<typeof checkColdSourceReach>[0]> = {}) => ({ prisma: prisma(), sourceConnectionId: "src", sourceVmId: "vm-1", targetConnectionId: "tgt", node: "pve3", ...over })

  it("is ok when the node reaches every address of the test lease", async () => {
    expect(await checkColdSourceReach(args())).toEqual({ status: "ok", node: "pve3", endpoints: [{ host: "10.42.0.22", port: 443, resolved: true, open: true }] })
    expect(h.endpoint).toHaveBeenCalledWith({}, "tgt", "pve3", "https://10.42.0.101:8006")
    expect(h.soapLogin).toHaveBeenCalledWith("https://vc.lab", "administrator@vsphere.local", "pw", true)
    expect(h.soapLogout).toHaveBeenCalled()
  })
  it("blocks with the operator sentence when an address does not answer", async () => {
    h.executeSSH.mockResolvedValue(probeAnswer([false]))
    const r = await checkColdSourceReach(args())
    expect(r.status).toBe("blocked")
    expect(r).toMatchObject({ node: "pve3", message: expect.stringContaining("cannot reach 10.42.0.22:443") })
  })
  it("skips a running VM (no test lease) and a standalone ESXi source", async () => {
    h.soapRequest.mockResolvedValue({ text: vmProps("poweredOn") })
    expect(await checkColdSourceReach(args())).toEqual({ status: "skipped", reason: "poweredOn" })
    expect(h.soapExportVm).not.toHaveBeenCalled()
    h.session.isVcenter = false
    expect(await checkColdSourceReach(args())).toEqual({ status: "skipped", reason: "notVcenter" })
  })
  it("reports what kept the test from running, never as a block", async () => {
    expect(await checkColdSourceReach(args({ sourceVmId: "vm 1;" }))).toEqual({ status: "error", node: "pve3", error: "invalid VM id" })
    expect(await checkColdSourceReach(args({ prisma: prisma(null) }))).toEqual({ status: "error", node: "pve3", error: "VMware connection not found" })
    h.soapExportVm.mockRejectedValue(new Error("ExportVm failed: busy"))
    expect(await checkColdSourceReach(args())).toEqual({ status: "error", node: "pve3", error: "ExportVm failed: busy" })
    h.soapExportVm.mockResolvedValue("lease-1")
    h.soapWaitForNfcLease.mockResolvedValue([])
    expect(await checkColdSourceReach(args())).toEqual({ status: "error", node: "pve3", error: "the export lease listed no download URL" })
    h.soapWaitForNfcLease.mockResolvedValue([dev("https://10.42.0.22/nfc/x")])
    h.executeSSH.mockResolvedValue({ success: false, error: "ssh down" })
    expect(await checkColdSourceReach(args())).toEqual({ status: "error", node: "pve3", error: "ssh down" })
  })
})

describe("checkColdBatchSourceReach", () => {
  const vms = [{ sourceVmId: "vm-1", name: "web" }, { sourceVmId: "vm-2", name: "db" }, { sourceVmId: "vm-3", name: "app" }, { sourceVmId: "vm-4", name: "live" }]
  const hostOf: Record<string, string> = { "vm-1": "host-9", "vm-2": "host-9", "vm-3": "host-16", "vm-4": "host-16" }
  beforeEach(() => {
    h.soapRequest.mockImplementation(async (_u: string, body: string) => {
      const id = /type="VirtualMachine">([^<]+)</.exec(body)![1]
      return { text: vmProps(id === "vm-4" ? "poweredOn" : "poweredOff", hostOf[id]) }
    })
    h.soapExportVm.mockImplementation(async (_s: unknown, vm: string) => `lease-${vm}`)
    h.soapWaitForNfcLease.mockImplementation(async (_s: unknown, lease: string) =>
      [dev(`https://${hostOf[lease.slice("lease-".length)] === "host-9" ? "10.42.0.21" : "10.42.0.22"}/nfc/x/disk-0.vmdk`)])
  })
  const run = (nodes = ["pve2", "pve3"]) => checkColdBatchSourceReach({ prisma: prisma(), sourceConnectionId: "src", targetConnectionId: "tgt", vms, nodes })

  it("opens one test lease per source host and blocks the VMs of the host a node cannot reach", async () => {
    h.executeSSH.mockImplementation(async (_c: string, ip: string) => (ip === "ip-pve3" ? probeAnswer([true, false]) : probeAnswer([true, true])))
    h.endpoint.mockImplementation(async (...a: unknown[]) => `ip-${String(a[2])}`)
    const r = await run()
    expect(h.soapExportVm.mock.calls.map(c => c[1])).toEqual(["vm-1", "vm-3"])
    expect(h.soapNfcLeaseAbort).toHaveBeenCalledTimes(2)
    expect(h.executeSSH).toHaveBeenCalledTimes(2)
    expect(r.problems).toEqual([{ node: "pve3", endpoints: [{ host: "10.42.0.22", port: 443, resolved: true, open: false }], vms: ["app"], message: expect.stringContaining("pve3 cannot reach 10.42.0.22:443") }])
    expect(r.unchecked).toEqual(["live"])
    expect(r.errors).toEqual([])
  })
  it("keeps a node whose probe failed as advisory, and leaves out what it could not lease", async () => {
    h.endpoint.mockResolvedValue("ip")
    h.soapExportVm.mockImplementation(async (_s: unknown, vm: string) => { if (vm === "vm-3") throw new Error("busy"); return "lease" })
    h.executeSSH.mockResolvedValue({ success: false, error: "ssh down" })
    const r = await run(["pve3"])
    expect(r.problems).toEqual([])
    expect(r.errors).toEqual([{ node: "pve3", error: "ssh down" }])
    expect(r.unchecked.sort()).toEqual(["app", "live"])
  })
  it("leaves every VM unchecked on a standalone ESXi, an unreadable source or a failed login", async () => {
    h.session.isVcenter = false
    expect((await run()).unchecked).toEqual(["web", "db", "app", "live"])
    h.session.isVcenter = true
    h.soapLogin.mockRejectedValue(new Error("401"))
    expect((await run()).unchecked).toEqual(["web", "db", "app", "live"])
  })
  it("caps the test leases and skips invalid ids", async () => {
    const many = Array.from({ length: BATCH_MAX_LEASES + 2 }, (_, i) => ({ sourceVmId: `vm-h${i}`, name: `h${i}` }))
    h.soapRequest.mockImplementation(async (_u: string, body: string) => ({ text: vmProps("poweredOff", /type="VirtualMachine">vm-(h\d+)</.exec(body)![1]) }))
    h.soapWaitForNfcLease.mockResolvedValue([dev("https://10.42.0.22/nfc/x")])
    h.endpoint.mockResolvedValue("ip")
    h.executeSSH.mockResolvedValue(probeAnswer([true]))
    const r = await checkColdBatchSourceReach({ prisma: prisma(), sourceConnectionId: "src", targetConnectionId: "tgt", vms: [...many, { sourceVmId: "bad id", name: "bad" }], nodes: ["pve3"] })
    expect(h.soapExportVm).toHaveBeenCalledTimes(BATCH_MAX_LEASES)
    expect(r.unchecked).toEqual(expect.arrayContaining(["bad", `h${BATCH_MAX_LEASES}`, `h${BATCH_MAX_LEASES + 1}`]))
    expect(r.problems).toEqual([])
  })
})
