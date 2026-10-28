import { describe, expect, it, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({ executeSSH: vi.fn() }))
vi.mock("@/lib/ssh/exec", async (io) => {
  const actual = await io<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: h.executeSSH }
})

import {
  bareHost, buildPortProbeCmd, buildVcenterProbeCmd, checkNfcReachability, describeUnreachable, isValidCopyAddress, parsePortProbe, parseVcenterProbe,
} from "./nfc-reachability"

describe("isValidCopyAddress", () => {
  it("accepts IPv4, IPv6 and host names", () => {
    expect(isValidCopyAddress("10.42.53.21")).toBe(true)
    expect(isValidCopyAddress("fd00::21")).toBe(true)
    expect(isValidCopyAddress("esxi-01.lab.local")).toBe(true)
  })
  it("rejects shell metacharacters, blanks and non-strings", () => {
    expect(isValidCopyAddress("10.42.0.21; rm -rf /")).toBe(false)
    expect(isValidCopyAddress("")).toBe(false)
    expect(isValidCopyAddress(undefined)).toBe(false)
    expect(isValidCopyAddress("a b")).toBe(false)
  })
})

describe("buildPortProbeCmd", () => {
  it("probes each port through /dev/tcp with a bounded timeout and a marker line", () => {
    const cmd = buildPortProbeCmd("10.42.53.21", [902, 443])
    expect(cmd).toContain("timeout 5 bash -c 'exec 3<>/dev/tcp/10.42.53.21/902'")
    expect(cmd).toContain('echo "port-902=open"')
    expect(cmd).toContain('echo "port-443=closed"')
  })
  it("drops ports outside the TCP range", () => {
    expect(buildPortProbeCmd("h", [0, 70000, 902])).not.toContain("port-0")
    expect(buildPortProbeCmd("h", [0, 70000, 902])).toContain("port-902")
  })
  it("refuses an address the inner bash -c would interpret", () => {
    // The address sits inside the `bash -c '...'` argument, where the outer escape no longer protects it.
    expect(() => buildPortProbeCmd("10.0.0.1/902; touch /tmp/pwned", [902])).toThrow(/Invalid copy address/)
    expect(() => buildPortProbeCmd("$(id)", [902])).toThrow(/Invalid copy address/)
    expect(() => buildPortProbeCmd("", [902])).toThrow(/Invalid copy address/)
  })
})

describe("parsePortProbe", () => {
  it("reads the marker lines and treats a missing port as closed", () => {
    expect(parsePortProbe("port-902=open\nport-443=closed\n", [902, 443])).toEqual({ 902: true, 443: false })
    expect(parsePortProbe("", [902])).toEqual({ 902: false })
    expect(parsePortProbe(undefined, [902])).toEqual({ 902: false })
  })
})

describe("checkNfcReachability", () => {
  beforeEach(() => h.executeSSH.mockReset())

  it("is ok when every port answers", async () => {
    h.executeSSH.mockResolvedValue({ success: true, output: "port-902=open\nport-443=open\n" })
    const r = await checkNfcReachability("c1", "10.42.0.101", "10.42.53.21")
    expect(r).toEqual({ address: "10.42.53.21", ports: { 902: true, 443: true }, ok: true })
    expect(h.executeSSH.mock.calls[0][2]).toContain("/dev/tcp/10.42.53.21/902")
  })

  it("reports the closed port and keeps the result when the shell exit is non-zero", async () => {
    h.executeSSH.mockResolvedValue({ success: false, output: "port-902=closed\nport-443=open\n", error: "exit 1" })
    const r = await checkNfcReachability("c1", "10.42.0.101", "10.42.53.21")
    expect(r.ok).toBe(false)
    expect(r.ports).toEqual({ 902: false, 443: true })
    expect(describeUnreachable(r, "vmk2 on esxi-01")).toMatch(/cannot reach 10\.42\.53\.21 \(vmk2 on esxi-01\) on port 902\./)
  })

  it("surfaces an SSH failure as an error instead of a closed port", async () => {
    h.executeSSH.mockResolvedValue({ success: false, error: "ssh: connect refused" })
    const r = await checkNfcReachability("c1", "10.42.0.101", "10.42.53.21", [902])
    expect(r.ok).toBe(false)
    expect(r.error).toBe("ssh: connect refused")
    expect(describeUnreachable(r, "vmk2")).toMatch(/Could not probe/)
  })

  it("refuses an address that could not be interpolated safely", async () => {
    const r = await checkNfcReachability("c1", "10.42.0.101", "x; reboot")
    expect(r.ok).toBe(false)
    expect(r.error).toBe("invalid address")
    expect(h.executeSSH).not.toHaveBeenCalled()
  })
})

// roadmap#175: on a vCenter source the VDDK logs in to the vCenter, from the node.
describe("vCenter probe", () => {
  beforeEach(() => h.executeSSH.mockReset())

  it("resolves a name before probing 443, and skips the lookup for an IP", () => {
    const named = buildVcenterProbeCmd("vcenter.corp.local")
    expect(named).toContain("timeout 5 getent hosts 'vcenter.corp.local'")
    expect(named).toContain("timeout 5 bash -c 'exec 3<>/dev/tcp/vcenter.corp.local/443'")
    expect(named).toContain('echo "vcenter-443=open"')
    expect(buildVcenterProbeCmd("10.42.0.20")).not.toContain("getent")
    expect(buildVcenterProbeCmd("[fd00::20]")).toContain("/dev/tcp/fd00::20/443")
    expect(() => buildVcenterProbeCmd("vc/443; reboot")).toThrow(/Invalid vCenter address/)
  })

  it("strips only the brackets of an IPv6 URL hostname", () => {
    expect(bareHost("[fd00::20]")).toBe("fd00::20")
    expect(bareHost("vcenter.corp.local")).toBe("vcenter.corp.local")
  })

  it("parses resolution and port, a missing line meaning closed", () => {
    expect(parseVcenterProbe("vcenter-resolve=fail\nvcenter-443=closed\n", "vc.lab")).toEqual({ host: "vc.lab", resolved: false, open: false })
    expect(parseVcenterProbe("vcenter-443=open\n", "10.42.0.20")).toEqual({ host: "10.42.0.20", resolved: true, open: true })
    expect(parseVcenterProbe(undefined, "vc.lab")).toEqual({ host: "vc.lab", resolved: true, open: false })
  })

  it("probes the vCenter in the same SSH call and fails the verdict when 443 is closed there", async () => {
    h.executeSSH.mockResolvedValue({ success: true, output: "port-902=open\nvcenter-443=closed\n" })
    const r = await checkNfcReachability("c1", "10.42.0.101", "10.42.0.22", [902], "10.42.0.20")
    expect(r).toEqual({ address: "10.42.0.22", ports: { 902: true }, ok: false, vcenter: { host: "10.42.0.20", resolved: true, open: false } })
    expect(h.executeSSH).toHaveBeenCalledTimes(1)
    expect(h.executeSSH.mock.calls[0][2]).toContain("/dev/tcp/10.42.0.22/902")
    expect(h.executeSSH.mock.calls[0][2]).toContain("/dev/tcp/10.42.0.20/443")
    expect(describeUnreachable(r, "vmk0 10.42.0.22 on esxi2")).toBe("The Proxmox node cannot reach the vCenter 10.42.0.20 on port 443, where the VDDK on the node logs in: open the route and the firewall from the node to the vCenter.")
  })

  it("says the name does not resolve, and adds a closed adapter port after it", async () => {
    h.executeSSH.mockResolvedValue({ success: true, output: "port-902=closed\nvcenter-resolve=fail\nvcenter-443=closed\n" })
    const r = await checkNfcReachability("c1", "10.42.0.101", "10.42.0.22", [902], "vcenter.corp.local")
    expect(describeUnreachable(r, "vmk0")).toBe(
      "The Proxmox node cannot resolve the vCenter name vcenter.corp.local, which the VDDK on the node logs in to: add it to the node's DNS or /etc/hosts. "
      + "The Proxmox node cannot reach 10.42.0.22 (vmk0) on port 902. The copy goes through this VMkernel adapter: route the node to that network, open the ESXi firewall for it, or pick another adapter.")
  })

  it("is ok when both answer, and refuses a vCenter address it cannot interpolate", async () => {
    h.executeSSH.mockResolvedValue({ success: true, output: "port-902=open\nvcenter-resolve=ok\nvcenter-443=open\n" })
    expect((await checkNfcReachability("c1", "10.42.0.101", "10.42.0.22", [902], "vc.lab")).ok).toBe(true)
    h.executeSSH.mockClear()
    expect(await checkNfcReachability("c1", "10.42.0.101", "10.42.0.22", [902], "$(id)")).toMatchObject({ ok: false, error: "invalid vCenter address" })
    expect(h.executeSSH).not.toHaveBeenCalled()
  })
})
