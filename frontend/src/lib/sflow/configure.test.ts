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
    expect(command).not.toMatch(/\bagent=/)
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

describe("parseConfigureOutput", () => {
  it("counts successful bridge markers and collects failed bridge names", () => {
    expect(parseConfigureOutput("SFLOW_OK:vmbr0\nSFLOW_OK:vmbr1\nSFLOW_FAILED:vmbr2\n")).toEqual({
      configured: 2,
      failedBridges: ["vmbr2"],
    })
  })

  it("returns zero configured bridges and no failures for empty output", () => {
    expect(parseConfigureOutput("")).toEqual({ configured: 0, failedBridges: [] })
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
