import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  settingUpsertMock,
  settingFindManyMock,
  settingFindUniqueMock,
  connectionFindManyMock,
  executeSSHMock,
  applySFlowOnNodeMock,
  isConnectionLicenseExcludedMock,
  reportExpectedAgentsMock,
} = vi.hoisted(() => ({
  settingUpsertMock: vi.fn(),
  settingFindManyMock: vi.fn(),
  settingFindUniqueMock: vi.fn(),
  connectionFindManyMock: vi.fn(),
  executeSSHMock: vi.fn(),
  applySFlowOnNodeMock: vi.fn(),
  isConnectionLicenseExcludedMock: vi.fn(async (_id: string) => false),
  reportExpectedAgentsMock: vi.fn(),
}))

const { orchestratorFetchMock, collectGuestMACsMock, probeHostMock } = vi.hoisted(() => ({
  orchestratorFetchMock: vi.fn(),
  collectGuestMACsMock: vi.fn(async () => ({ "bc:24:11:00:00:01": 101 })),
  probeHostMock: vi.fn(async (_c: string, _n: string, node: string) => ({ node, hasOvs: node !== "pve3", portMapError: node === "pve2" ? "push failed" : "" })),
}))

vi.mock("@/lib/orchestrator", () => ({
  orchestratorFetch: orchestratorFetchMock,
}))

vi.mock("@/lib/sflow/probe", () => ({
  collectGuestMACs: collectGuestMACsMock,
  probeHost: probeHostMock,
}))

vi.mock("@/lib/license/exclusions", () => ({
  isConnectionLicenseExcluded: isConnectionLicenseExcludedMock,
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    setting: {
      upsert: settingUpsertMock,
      findMany: settingFindManyMock,
      findUnique: settingFindUniqueMock,
    },
    connection: {
      findMany: connectionFindManyMock,
    },
  },
}))

vi.mock("@/lib/ssh/exec", () => ({
  executeSSH: executeSSHMock,
}))

vi.mock("@/lib/sflow/configure", () => ({
  applySFlowOnNode: applySFlowOnNodeMock,
  SFLOW_PROBE_COMMAND: "sflow-probe-command",
}))

vi.mock("@/lib/sflow/expectedAgents", () => ({
  reportExpectedAgents: reportExpectedAgentsMock,
}))

import {
  PORTMAP_FIRST_DELAY_MS,
  reconcileSFlow,
  refreshPortMaps,
  saveDesiredSFlowConfig,
  SFLOW_DESIRED_CONFIG_KEY,
  startPortMapRefresher,
  startSFlowReconciler,
} from "./reconciler"

const desiredConfig = {
  collectorTarget: "udp:collector.example:6343",
  samplingRate: 4096,
  pollingInterval: 30,
}

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "connection-1",
    tenantId: "tenant-1",
    sshKeyEnc: "encrypted-key",
    sshPassEnc: null,
    hosts: [{ enabled: true, ip: "10.0.0.1" }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  settingUpsertMock.mockResolvedValue({})
  settingFindManyMock.mockResolvedValue([])
  connectionFindManyMock.mockResolvedValue([])
  executeSSHMock.mockResolvedValue({ success: true, output: "1\n" })
  reportExpectedAgentsMock.mockResolvedValue(true)
  applySFlowOnNodeMock.mockResolvedValue({
    success: true,
    bridgesConfigured: 1,
    failedBridges: [],
  })
})

describe("saveDesiredSFlowConfig", () => {
  it("upserts using the setting and tenant composite key", async () => {
    await saveDesiredSFlowConfig("tenant-1", desiredConfig)

    expect(settingUpsertMock).toHaveBeenCalledWith({
      where: {
        key_tenantId: {
          key: SFLOW_DESIRED_CONFIG_KEY,
          tenantId: "tenant-1",
        },
      },
      create: {
        key: SFLOW_DESIRED_CONFIG_KEY,
        tenantId: "tenant-1",
        value: desiredConfig,
      },
      update: {
        value: desiredConfig,
        updatedAt: expect.any(Date),
      },
    })
  })
})

describe("reconcileSFlow", () => {
  it("returns an all-zero report when no tenant has stored configuration", async () => {
    await expect(reconcileSFlow()).resolves.toEqual({ checked: 0, reapplied: 0, failed: 0 })
    expect(connectionFindManyMock).not.toHaveBeenCalled()
  })

  it("skips malformed stored settings", async () => {
    settingFindManyMock.mockResolvedValue([
      {
        tenantId: "tenant-1",
        value: { samplingRate: 4096, pollingInterval: 30 },
      },
      {
        tenantId: "tenant-1",
        value: { ...desiredConfig, samplingRate: 1.5 },
      },
      {
        tenantId: "tenant-1",
        value: { ...desiredConfig, pollingInterval: 2.5 },
      },
    ])
    connectionFindManyMock.mockResolvedValue([connection()])

    await expect(reconcileSFlow()).resolves.toEqual({ checked: 0, reapplied: 0, failed: 0 })
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(applySFlowOnNodeMock).not.toHaveBeenCalled()
  })

  it("only considers connections belonging to the setting tenant", async () => {
    settingFindManyMock.mockResolvedValue([{ tenantId: "tenant-1", value: desiredConfig }])
    connectionFindManyMock.mockResolvedValue([
      connection({ id: "wrong-tenant", tenantId: "tenant-2" }),
      connection({ id: "right-tenant" }),
    ])

    await expect(reconcileSFlow()).resolves.toEqual({ checked: 1, reapplied: 0, failed: 0 })
    expect(executeSSHMock).toHaveBeenCalledTimes(1)
    // The probe only reads, so it may run on a cluster outside the license (roadmap#58).
    expect(executeSSHMock).toHaveBeenCalledWith("right-tenant", expect.objectContaining({ host: "10.0.0.1", port: 22 }), "sflow-probe-command", undefined, { readOnly: true })
  })

  it("leaves a cluster outside the license alone: neither probed nor re-applied (roadmap#58)", async () => {
    // executeSSH would refuse the re-apply there; skipping the connection
    // keeps that refusal from aborting the pass for every other cluster.
    settingFindManyMock.mockResolvedValue([{ tenantId: "tenant-1", value: desiredConfig }])
    connectionFindManyMock.mockResolvedValue([connection({ id: "excluded" }), connection({ id: "licensed" })])
    isConnectionLicenseExcludedMock.mockImplementation(async (id: string) => id === "excluded")
    executeSSHMock.mockResolvedValue({ success: true, output: "0\n" })
    applySFlowOnNodeMock.mockResolvedValue({ success: true, bridgesConfigured: 1, failedBridges: [] })

    await expect(reconcileSFlow()).resolves.toEqual({ checked: 1, reapplied: 1, failed: 0 })
    expect(executeSSHMock).toHaveBeenCalledTimes(1)
    expect(executeSSHMock.mock.calls[0][0]).toBe("licensed")
    expect(applySFlowOnNodeMock).toHaveBeenCalledTimes(1)
    expect(applySFlowOnNodeMock.mock.calls[0][0]).toBe("licensed")
  })

  it("skips connections without SSH credentials and unusable hosts", async () => {
    settingFindManyMock.mockResolvedValue([{ tenantId: "tenant-1", value: desiredConfig }])
    connectionFindManyMock.mockResolvedValue([
      connection({ id: "no-credentials", sshKeyEnc: null, sshPassEnc: null }),
      connection({ id: "disabled", hosts: [{ enabled: false, ip: "10.0.0.2" }] }),
      connection({ id: "no-ip", hosts: [{ enabled: true, ip: null }] }),
    ])

    await expect(reconcileSFlow()).resolves.toEqual({ checked: 0, reapplied: 0, failed: 0 })
    expect(executeSSHMock).not.toHaveBeenCalled()
    expect(applySFlowOnNodeMock).not.toHaveBeenCalled()
  })

  it("treats a failed probe as unreachable and never reconfigures it", async () => {
    settingFindManyMock.mockResolvedValue([{ tenantId: "tenant-1", value: desiredConfig }])
    connectionFindManyMock.mockResolvedValue([connection()])
    executeSSHMock.mockResolvedValue({ success: false, error: "SSH timeout" })

    await expect(reconcileSFlow()).resolves.toEqual({ checked: 0, reapplied: 0, failed: 0 })
    expect(applySFlowOnNodeMock).not.toHaveBeenCalled()
  })

  it("leaves a node with a positive probe count alone", async () => {
    settingFindManyMock.mockResolvedValue([{ tenantId: "tenant-1", value: desiredConfig }])
    connectionFindManyMock.mockResolvedValue([connection()])
    executeSSHMock.mockResolvedValue({ success: true, output: "2\n" })

    await expect(reconcileSFlow()).resolves.toEqual({ checked: 1, reapplied: 0, failed: 0 })
    expect(applySFlowOnNodeMock).not.toHaveBeenCalled()
  })

  it("re-applies a node whose probe count is zero", async () => {
    settingFindManyMock.mockResolvedValue([{ tenantId: "tenant-1", value: desiredConfig }])
    connectionFindManyMock.mockResolvedValue([connection()])
    executeSSHMock.mockResolvedValue({ success: true, output: "0\n" })

    await expect(reconcileSFlow()).resolves.toEqual({ checked: 1, reapplied: 1, failed: 0 })
    expect(applySFlowOnNodeMock).toHaveBeenCalledWith("connection-1", expect.objectContaining({ host: "10.0.0.1", port: 22 }), desiredConfig, "10.0.0.1")
  })

  it("reaches each node on its own SSH address and port, else the connection port", async () => {
    settingFindManyMock.mockResolvedValue([{ tenantId: "tenant-1", value: desiredConfig }])
    connectionFindManyMock.mockResolvedValue([connection({
      sshPort: 2222,
      hosts: [
        { enabled: true, ip: "10.0.0.1", sshAddress: "203.0.113.10", sshPort: 2201 },
        { enabled: true, ip: "10.0.0.2", sshAddress: "203.0.113.10", sshPort: 2202 },
        { enabled: true, ip: "10.0.0.3", sshAddress: null, sshPort: null },
      ],
    })])
    executeSSHMock.mockResolvedValue({ success: true, output: "0\n" })

    await reconcileSFlow()

    expect(executeSSHMock.mock.calls.map(c => c[1])).toEqual([
      { host: "203.0.113.10", port: 2201, source: "override" },
      { host: "203.0.113.10", port: 2202, source: "override" },
      { host: "10.0.0.3", port: 2222, source: "proxmox" },
    ])
    expect(applySFlowOnNodeMock.mock.calls.map(c => c[1].port)).toEqual([2201, 2202, 2222])
  })

  // roadmap#52: with the page closed, this pass is what keeps the
  // orchestrator's inventory of expected agents current.
  it("reports every node it reached to the orchestrator, and only complete clusters as such", async () => {
    settingFindManyMock.mockResolvedValue([{ tenantId: "tenant-1", value: desiredConfig }])
    connectionFindManyMock.mockResolvedValue([
      connection({ name: "DR", hosts: [
        { node: "pve1-dr", enabled: true, ip: "10.0.0.1" },
        { node: "pve2-dr", enabled: true, ip: "10.0.0.2" },
        { node: "pve3-dr", enabled: true, ip: "10.0.0.3" },
        { node: "pve4-dr", enabled: true, ip: "10.0.0.4" },
      ] }),
      connection({ id: "connection-2", name: "PROD", hosts: [{ node: "pve1", enabled: true, ip: "10.0.1.1" }, { node: "pve2", enabled: true, ip: "10.0.1.2" }] }),
    ])
    executeSSHMock.mockImplementation(async (_c: string, target: { host: string }) => {
      switch (target.host) {
        case "10.0.0.1": return { success: true, output: "1\n" } // still configured
        case "10.0.0.2": return { success: true, output: "0\n" } // lost it, re-applied below
        case "10.0.0.3": return { success: true, output: "0\n" } // no OVS at all
        case "10.0.0.4": return { success: true, output: "0\n" } // bridges set, collector unreachable
        case "10.0.1.1": return { success: true, output: "1\n" }
        default: return { success: false, error: "unreachable" } // 10.0.1.2 down
      }
    })
    applySFlowOnNodeMock.mockImplementation(async (_c: string, target: { host: string }) => {
      switch (target.host) {
        case "10.0.0.2": return { success: true, bridgesConfigured: 1, failedBridges: [] }
        case "10.0.0.3": return { success: false, bridgesConfigured: 0, failedBridges: [], error: "no OVS bridge" }
        default: return { success: false, bridgesConfigured: 1, failedBridges: [], error: "no route to the collector" }
      }
    })

    await expect(reconcileSFlow()).resolves.toEqual({ checked: 5, reapplied: 1, failed: 1 })

    expect(reportExpectedAgentsMock).toHaveBeenCalledTimes(1)
    const update = reportExpectedAgentsMock.mock.calls[0][0]
    // DR answered in full, PROD had a node down: only DR may be trusted as complete.
    expect(update.connection_ids).toEqual(["connection-1"])
    expect(update.agents).toEqual([
      expect.objectContaining({ connection_id: "connection-1", connection_name: "DR", node: "pve1-dr", agent_ip: "10.0.0.1", configured: true, reconfigured: false, target: desiredConfig.collectorTarget, polling_interval: 30, sampling_rate: 4096 }),
      expect.objectContaining({ node: "pve2-dr", configured: true, reconfigured: true }),
      expect.objectContaining({ node: "pve3-dr", configured: false }),
      expect.objectContaining({ node: "pve4-dr", configured: true, reconfigured: false }),
      expect.objectContaining({ connection_id: "connection-2", node: "pve1", configured: true }),
    ])
  })

  it("does not count a node with no OVS bridge as a failure", async () => {
    settingFindManyMock.mockResolvedValue([{ tenantId: "tenant-1", value: desiredConfig }])
    connectionFindManyMock.mockResolvedValue([connection()])
    executeSSHMock.mockResolvedValue({ success: true, output: "0\n" })
    applySFlowOnNodeMock.mockResolvedValue({
      success: false,
      bridgesConfigured: 0,
      failedBridges: [],
      error: "no OVS bridge on this node, nothing to configure",
    })

    await expect(reconcileSFlow()).resolves.toEqual({ checked: 1, reapplied: 0, failed: 0 })
  })
})

describe("startSFlowReconciler", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("does not run before the first interval elapses", async () => {
    const reconcile = vi.fn().mockResolvedValue({ checked: 0, reapplied: 0, failed: 0 })
    const stop = startSFlowReconciler({ intervalMs: 1000, reconcile })

    await vi.advanceTimersByTimeAsync(999)
    expect(reconcile).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(reconcile).toHaveBeenCalledTimes(1)
    stop()
  })

  it("does not overlap a slow pass with later ticks", async () => {
    let resolvePass: (report: { checked: number; reapplied: number; failed: number }) => void
    const pending = new Promise<{ checked: number; reapplied: number; failed: number }>(resolve => {
      resolvePass = resolve
    })
    const reconcile = vi.fn().mockReturnValueOnce(pending).mockResolvedValue({
      checked: 0,
      reapplied: 0,
      failed: 0,
    })
    const stop = startSFlowReconciler({ intervalMs: 1000, reconcile })

    await vi.advanceTimersByTimeAsync(3000)
    expect(reconcile).toHaveBeenCalledTimes(1)

    resolvePass!({ checked: 0, reapplied: 0, failed: 0 })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(reconcile).toHaveBeenCalledTimes(2)
    stop()
  })

  it("contains a rejected pass inside the timer and continues", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const reconcile = vi.fn().mockRejectedValue(new Error("database unavailable"))
    const stop = startSFlowReconciler({ intervalMs: 1000, reconcile })

    try {
      await vi.advanceTimersByTimeAsync(3000)
      expect(reconcile).toHaveBeenCalledTimes(3)
      expect(errorSpy).toHaveBeenCalledTimes(3)
    } finally {
      stop()
      errorSpy.mockRestore()
    }
  })

  it("returns an idempotent stop function that prevents later passes", async () => {
    const reconcile = vi.fn().mockResolvedValue({ checked: 0, reapplied: 0, failed: 0 })
    const stop = startSFlowReconciler({ intervalMs: 1000, reconcile })

    await vi.advanceTimersByTimeAsync(2000)
    expect(reconcile).toHaveBeenCalledTimes(2)
    stop()
    expect(() => stop()).not.toThrow()
    await vi.advanceTimersByTimeAsync(5000)
    expect(reconcile).toHaveBeenCalledTimes(2)
  })
})

describe("readDesiredSFlowConfig", () => {
  it("returns the tenant's saved configuration, null when absent or unusable", async () => {
    const { readDesiredSFlowConfig } = await import("./reconciler")
    const saved = { collectorTarget: "10.42.0.250:6343", samplingRate: 512, pollingInterval: 30 }

    settingFindUniqueMock.mockResolvedValueOnce({ value: saved })
    await expect(readDesiredSFlowConfig("tenant-a")).resolves.toEqual(saved)
    expect(settingFindUniqueMock).toHaveBeenLastCalledWith({ where: { key_tenantId: { key: "sflow.desiredConfig", tenantId: "tenant-a" } } })

    settingFindUniqueMock.mockResolvedValueOnce(null)
    await expect(readDesiredSFlowConfig("tenant-a")).resolves.toBeNull()

    settingFindUniqueMock.mockResolvedValueOnce({ value: { collectorTarget: "", samplingRate: 512, pollingInterval: 30 } })
    await expect(readDesiredSFlowConfig("tenant-a")).resolves.toBeNull()
  })
})

describe("refreshPortMaps", () => {
  const heard = (...ips: string[]) => ({ enabled: true, agents: ips.map(agent_ip => ({ agent_ip, active: true })) })

  it("probes only the nodes the collector hears, one MAC read per cluster, and counts the maps pushed", async () => {
    orchestratorFetchMock.mockResolvedValue(heard("10.0.0.1", "10.0.0.2", "10.0.0.3"))
    connectionFindManyMock.mockResolvedValue([
      connection({ id: "prod", name: "PROD", hosts: [
        { enabled: true, ip: "10.0.0.1", node: "pve1" }, { enabled: true, ip: "10.0.0.2", node: "pve2" }, { enabled: true, ip: "10.0.0.3", node: "pve3" },
        { enabled: true, ip: "10.0.0.4", node: "pve4" }, { enabled: false, ip: "10.0.0.5", node: "pve5" },
      ] }),
      connection({ id: "silent", hosts: [{ enabled: true, ip: "10.9.0.1", node: "dr1" }] }),
      connection({ id: "nokey", sshKeyEnc: null, sshPassEnc: null, hosts: [{ enabled: true, ip: "10.0.0.1", node: "x" }] }),
      connection({ id: "excluded", hosts: [{ enabled: true, ip: "10.0.0.1", node: "y" }] }),
    ])
    isConnectionLicenseExcludedMock.mockImplementation(async (id: string) => id === "excluded")

    // pve1 pushed; pve2 failed to push; pve3 has no Open vSwitch; pve4 is not heard; pve5 disabled.
    await expect(refreshPortMaps()).resolves.toBe(1)
    expect(orchestratorFetchMock).toHaveBeenCalledWith("/sflow/status")
    expect(collectGuestMACsMock).toHaveBeenCalledTimes(1)
    expect(probeHostMock.mock.calls.map(c => c[2])).toEqual(["pve1", "pve2", "pve3"])
    expect(probeHostMock.mock.calls[0]).toEqual(["prod", "PROD", "pve1", "10.0.0.1", expect.objectContaining({ host: "10.0.0.1" }), { "bc:24:11:00:00:01": 101 }])
    isConnectionLicenseExcludedMock.mockImplementation(async () => false)
  })

  it("does nothing, not even a database read, when the collector hears no agent or is off", async () => {
    orchestratorFetchMock.mockResolvedValue({ enabled: true, agents: [{ agent_ip: "10.0.0.1", active: false }] })
    await expect(refreshPortMaps()).resolves.toBe(0)
    orchestratorFetchMock.mockResolvedValue({ enabled: false, agents: [{ agent_ip: "10.0.0.1", active: true }] })
    await expect(refreshPortMaps()).resolves.toBe(0)
    orchestratorFetchMock.mockResolvedValue(null)
    await expect(refreshPortMaps()).resolves.toBe(0)
    expect(connectionFindManyMock).not.toHaveBeenCalled()
    expect(probeHostMock).not.toHaveBeenCalled()
  })
})

describe("startPortMapRefresher", () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it("pushes the maps soon after the start, then every interval, one pass at a time, and never throws", async () => {
    let release: () => void = () => {}
    const refresh = vi.fn()
      .mockImplementationOnce(() => new Promise<number>(resolve => { release = () => resolve(1) }))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(0)
    const errors = vi.spyOn(console, "error").mockImplementation(() => {})
    const stop = startPortMapRefresher({ intervalMs: 1000, firstDelayMs: 100, refresh })

    await vi.advanceTimersByTimeAsync(100)
    expect(refresh).toHaveBeenCalledTimes(1)
    // Still in flight at the interval: skipped.
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(1)
    release()
    await vi.advanceTimersByTimeAsync(1000)
    expect(refresh).toHaveBeenCalledTimes(2)
    expect(errors).toHaveBeenCalledWith("[sflow-portmap] pass failed:", "boom")

    stop()
    expect(() => stop()).not.toThrow()
    await vi.advanceTimersByTimeAsync(5000)
    expect(refresh).toHaveBeenCalledTimes(2)
    errors.mockRestore()
  })

  it("waits a minute before the first pass by default", () => {
    expect(PORTMAP_FIRST_DELAY_MS).toBe(60_000)
    const stop = startPortMapRefresher({ refresh: vi.fn().mockResolvedValue(0) })
    stop()
  })
})
