import { describe, expect, it } from "vitest"

import {
  formatElapsed,
  summarizeTelemetry,
  telemetryChip,
  telemetryOf,
  type AgentTelemetry,
  type TelemetryHealth,
} from "./telemetryState"

function verdict(state: AgentTelemetry["state"], overrides: Partial<AgentTelemetry> = {}): AgentTelemetry {
  return {
    connection_id: "conn-dr", connection_name: "PVE-DR", node: "pve2-dr", agent_ip: "10.42.0.112",
    target: "100.110.158.84:16343", polling_interval: 30, sampling_rate: 512, configured_at: "2026-10-14T09:00:00Z",
    state, seconds_since_seen: 12, seconds_silent: 12, timeout_seconds: 120, grace_seconds: 300,
    flow_rate: 0, sample_count: 0, datagram_count: 40, counter_count: 40, detail: "Receiving",
    ...overrides,
  }
}

const ovsConfigured = { hasOvs: true, sflowConfigured: true }

describe("telemetryChip", () => {
  // The whole point of roadmap#52: configuration alone is no longer green.
  it("paints a configured node without a verdict as neutral, not active", () => {
    const chip = telemetryChip(ovsConfigured, undefined, true)
    expect(chip).toMatchObject({ kind: "configured", color: "default", variant: "outlined", labelKey: "telemetryConfigured" })
  })

  it("follows the orchestrator verdict once there is one", () => {
    expect(telemetryChip(ovsConfigured, verdict("receiving"), true)).toMatchObject({ kind: "receiving", color: "success", variant: "filled" })
    expect(telemetryChip(ovsConfigured, verdict("missing"), true)).toMatchObject({ kind: "missing", color: "error", variant: "filled" })
    expect(telemetryChip(ovsConfigured, verdict("awaiting"), true)).toMatchObject({ kind: "awaiting", color: "info", variant: "outlined" })
    expect(telemetryChip(ovsConfigured, verdict("identity_unknown"), true)).toMatchObject({ kind: "identity_unknown", color: "warning" })
    expect(telemetryChip(ovsConfigured, verdict("host_offline"), true)).toMatchObject({ kind: "host_offline", color: "default" })
  })

  it("keeps the configuration states ahead of any verdict", () => {
    expect(telemetryChip({ hasOvs: false, sflowConfigured: false }, verdict("receiving"), true).kind).toBe("no_ovs")
    expect(telemetryChip({ hasOvs: true, sflowConfigured: false }, verdict("receiving"), true)).toMatchObject({ kind: "not_configured", labelKey: "notConfigured", color: "warning" })
  })

  it("says the collector is unavailable rather than trusting a stale verdict", () => {
    expect(telemetryChip(ovsConfigured, verdict("receiving"), false).kind).toBe("collector_unavailable")
    expect(telemetryChip(ovsConfigured, undefined, false).kind).toBe("collector_unavailable")
  })
})

describe("telemetryOf", () => {
  const health: TelemetryHealth = {
    evaluated_at: "", collector_enabled: true, alerts_enabled: true, timeout_seconds: 0, grace_seconds: 300,
    unmatched_agents: [],
    agents: [verdict("receiving"), verdict("missing", { node: "pve3-dr", agent_ip: "10.42.0.113" }), verdict("awaiting", { connection_id: "conn-prod", node: "pve2-dr" })],
  }

  it("keys on connection and node, never on the address alone", () => {
    expect(telemetryOf(health, { connectionId: "conn-dr", node: "pve3-dr" })?.state).toBe("missing")
    expect(telemetryOf(health, { connectionId: "conn-prod", node: "pve2-dr" })?.state).toBe("awaiting")
    expect(telemetryOf(health, { connectionId: "conn-dr", node: "pve9-dr" })).toBeUndefined()
    expect(telemetryOf(null, { connectionId: "conn-dr", node: "pve2-dr" })).toBeUndefined()
  })
})

describe("summarizeTelemetry", () => {
  it("counts the rows per state", () => {
    expect(summarizeTelemetry([verdict("receiving"), verdict("receiving"), verdict("missing")])).toEqual({ receiving: 2, missing: 1 })
    expect(summarizeTelemetry(undefined)).toEqual({})
  })
})

describe("formatElapsed", () => {
  it.each([
    [0, "0 s"],
    [45, "45 s"],
    [60, "1 min"],
    [419, "6 min"],
    [3600, "1 h"],
    [3720, "1 h 2 min"],
    [86400, "1 d"],
    [90000, "1 d 1 h"],
  ])("formats %d seconds as %s", (seconds, expected) => {
    expect(formatElapsed(seconds)).toBe(expected)
  })

  it("reads an unknown or negative age as never", () => {
    expect(formatElapsed(-1)).toBeNull()
    expect(formatElapsed(null)).toBeNull()
    expect(formatElapsed(undefined)).toBeNull()
    expect(formatElapsed(Number.NaN)).toBeNull()
  })
})
