import { beforeEach, describe, expect, it, vi } from "vitest"

const { executeSSHMock, shellEscapeMock } = vi.hoisted(() => ({
  executeSSHMock: vi.fn(),
  shellEscapeMock: vi.fn(),
}))

vi.mock("@/lib/ssh/exec", () => ({
  executeSSH: executeSSHMock,
  shellEscape: shellEscapeMock,
}))

import {
  applySFlowOnNode,
  buildSFlowConfigureCommand,
  collectorHost,
  parseConfigureOutput,
  type SFlowDesiredConfig,
} from "./configure"

const config: SFlowDesiredConfig = {
  collectorTarget: "udp:collector.example:6343",
  samplingRate: 4096,
  pollingInterval: 30,
}

beforeEach(() => {
  vi.clearAllMocks()
  shellEscapeMock.mockImplementation((value: string) => `'${value}'`)
})

describe("buildSFlowConfigureCommand", () => {
  it("keeps the SSH allowlist prefix and safe replacement semantics", () => {
    const command = buildSFlowConfigureCommand(config)

    expect(command.startsWith("for br in $(ovs-vsctl list-br)")).toBe(true)
    expect(command).not.toMatch(/\bclear\b/)
  })

  it("interpolates the sampling and polling values", () => {
    const command = buildSFlowConfigureCommand(config)

    expect(command).toContain("sampling=4096")
    expect(command).toContain("polling=30")
  })

  // Regression guard for the defect that made this feature never work at all.
  // `targets` is an OVSDB set of strings: ovs-vsctl rejects a bare host:port
  // with `unexpected ":" parsing set of 1 or more strings`. Shell quoting is
  // not enough, because the shell strips its own quotes before ovs-vsctl sees
  // the value. What must survive is a pair of LITERAL double quotes.
  // Measured against OVS 3.5.0.
  it("delivers the target to ovs-vsctl wrapped in literal double quotes", () => {
    const command = buildSFlowConfigureCommand(config)

    // shellEscape is mocked to the real single-quote behaviour, so this is the
    // exact argument the shell hands to ovs-vsctl once it strips them.
    expect(command).toContain(`target='"udp:collector.example:6343"'`)
  })

  it("passes the collector target through shellEscape", () => {
    shellEscapeMock.mockReturnValue("'escaped collector target'")

    const command = buildSFlowConfigureCommand(config)

    expect(shellEscapeMock).toHaveBeenCalledWith(`"${config.collectorTarget}"`)
    expect(command).toContain("target='escaped collector target'")
  })
})

// #1066: left unset, ovs-vswitchd reports the source address of its route to
// the collector, which on a multi-homed node is not the address the table and
// the port map key the node on.
describe("agent address", () => {
  it("pins the agent to the node address when it is an IPv4 literal", () => {
    expect(buildSFlowConfigureCommand(config, "10.0.0.11")).toContain(`agent='"10.0.0.11"'`)
  })

  it("pins an IPv6 node address with the literal quotes its colons need", () => {
    expect(buildSFlowConfigureCommand(config, "fd00::11")).toContain(`agent='"fd00::11"'`)
  })

  it("leaves the agent to Open vSwitch for a hostname or no address at all", () => {
    expect(buildSFlowConfigureCommand(config, "pve1.example")).not.toMatch(/\bagent=/)
    expect(buildSFlowConfigureCommand(config)).not.toMatch(/\bagent=/)
  })
})

describe("collector reachability check", () => {
  it("asks the node to resolve the collector host and route to it", () => {
    const command = buildSFlowConfigureCommand({ ...config, collectorTarget: "10.0.0.250:6343" })

    expect(command).toContain(`getent ahosts '10.0.0.250'`)
    expect(command).toContain("SFLOW_UNRESOLVED")
    expect(command).toContain('SFLOW_ROUTE:$(ip route get "$addr"')
  })

  it.each([
    ["10.0.0.250:6343", "10.0.0.250"],
    ["collector.example:6343", "collector.example"],
    ["[fd00::250]:6343", "fd00::250"],
    ["fd00::250", "fd00::250"],
    ["collector.example", "collector.example"],
  ])("extracts the host of %s", (target, host) => {
    expect(collectorHost(target)).toBe(host)
  })
})

describe("parseConfigureOutput", () => {
  it("counts successful bridge markers and collects failed bridge names", () => {
    expect(parseConfigureOutput("SFLOW_OK:vmbr0\nSFLOW_OK:vmbr1\nSFLOW_FAILED:vmbr2\n")).toEqual({
      configured: 2,
      failedBridges: ["vmbr2"],
      collectorResolved: null,
      routeSource: null,
    })
  })

  it("returns zero configured bridges and no failures for empty output", () => {
    expect(parseConfigureOutput("")).toEqual({ configured: 0, failedBridges: [], collectorResolved: null, routeSource: null })
  })

  it("handles mixed output and preserves all failed bridge names", () => {
    const output = [
      "ovs-vsctl diagnostic output",
      "SFLOW_FAILED:vmbr-broken",
      "SFLOW_OK:vmbr-working",
      "SFLOW_FAILED:vmbr-other",
    ].join("\n")

    expect(parseConfigureOutput(output)).toEqual({
      configured: 1,
      failedBridges: ["vmbr-broken", "vmbr-other"],
      collectorResolved: null,
      routeSource: null,
    })
  })

  it("reads the source address of the route to the collector", () => {
    expect(parseConfigureOutput("SFLOW_OK:vmbr0\nSFLOW_ROUTE:10.0.0.11\n")).toMatchObject({
      collectorResolved: true,
      routeSource: "10.0.0.11",
    })
  })

  it("tells an unresolvable collector apart from an unroutable one", () => {
    expect(parseConfigureOutput("SFLOW_OK:vmbr0\nSFLOW_UNRESOLVED\n")).toMatchObject({ collectorResolved: false })
    expect(parseConfigureOutput("SFLOW_OK:vmbr0\nSFLOW_ROUTE:\n")).toMatchObject({
      collectorResolved: true,
      routeSource: "",
    })
  })
})

describe("applySFlowOnNode", () => {
  it("succeeds when every bridge is configured", async () => {
    executeSSHMock.mockResolvedValue({
      success: true,
      output: "SFLOW_OK:vmbr0\nSFLOW_OK:vmbr1\n",
    })

    await expect(applySFlowOnNode("connection-1", "10.0.0.1", config)).resolves.toEqual({
      success: true,
      bridgesConfigured: 2,
      failedBridges: [],
    })
    expect(executeSSHMock).toHaveBeenCalledWith(
      "connection-1",
      "10.0.0.1",
      expect.stringMatching(/^for br in \$\(ovs-vsctl list-br\)/),
    )
  })

  it("reports partial failures with the failed bridge names", async () => {
    executeSSHMock.mockResolvedValue({
      success: true,
      output: "SFLOW_OK:vmbr0\nSFLOW_FAILED:vmbr1\nSFLOW_FAILED:vmbr2\n",
    })

    await expect(applySFlowOnNode("connection-1", "10.0.0.1", config)).resolves.toEqual({
      success: false,
      bridgesConfigured: 1,
      failedBridges: ["vmbr1", "vmbr2"],
      error: "sFlow could not be set on vmbr1, vmbr2",
    })
  })

  it("treats empty output as nothing to configure instead of success", async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: "" })

    const result = await applySFlowOnNode("connection-1", "10.0.0.1", config)

    expect(result).toEqual({
      success: false,
      bridgesConfigured: 0,
      failedBridges: [],
      error: "no OVS bridge on this node, nothing to configure",
    })
    expect(result.error).toContain("nothing to configure")
  })

  it("passes the node address through to the agent column", async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: "SFLOW_OK:vmbr0\nSFLOW_ROUTE:10.0.0.11\n" })

    await applySFlowOnNode("connection-1", "10.0.0.1", config, "10.0.0.11")

    expect(executeSSHMock.mock.calls[0][2]).toContain(`agent='"10.0.0.11"'`)
  })

  // #1066: ovs-vsctl answers success either way, ovs-vswitchd then only logs
  // an error and sends nothing. The node must not be reported as configured.
  it("fails a node that cannot resolve the collector, bridges configured or not", async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: "SFLOW_OK:vmbr0\nSFLOW_UNRESOLVED\n" })

    const result = await applySFlowOnNode("connection-1", "10.0.0.1", { ...config, collectorTarget: "proxcenter.example:6343" })

    expect(result).toMatchObject({ success: false, bridgesConfigured: 1, failedBridges: [] })
    expect(result.error).toContain("cannot resolve the collector proxcenter.example")
  })

  it("fails a node with no route to the collector", async () => {
    executeSSHMock.mockResolvedValue({ success: true, output: "SFLOW_OK:vmbr0\nSFLOW_ROUTE:\n" })

    const result = await applySFlowOnNode("connection-1", "10.0.0.1", { ...config, collectorTarget: "10.9.9.9:6343" })

    expect(result).toMatchObject({ success: false, bridgesConfigured: 1 })
    expect(result.error).toContain("no route to the collector 10.9.9.9")
  })

  it("returns the SSH error when the command fails without a marker", async () => {
    executeSSHMock.mockResolvedValue({ success: false, error: "connection refused" })

    await expect(applySFlowOnNode("connection-1", "10.0.0.1", config)).resolves.toEqual({
      success: false,
      bridgesConfigured: 0,
      failedBridges: [],
      error: "connection refused",
    })
  })
})
