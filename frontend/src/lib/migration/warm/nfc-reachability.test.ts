import { describe, expect, it, vi, beforeEach } from "vitest"

const h = vi.hoisted(() => ({ executeSSH: vi.fn() }))
vi.mock("@/lib/ssh/exec", async (io) => {
  const actual = await io<typeof import("@/lib/ssh/exec")>()
  return { ...actual, executeSSH: h.executeSSH }
})

import {
  buildPortProbeCmd, checkNfcReachability, describeUnreachable, isValidCopyAddress, parsePortProbe,
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
