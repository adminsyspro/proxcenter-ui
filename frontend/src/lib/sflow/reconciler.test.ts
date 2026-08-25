import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const {
  settingUpsertMock,
  settingFindManyMock,
  connectionFindManyMock,
  executeSSHMock,
  applySFlowOnNodeMock,
} = vi.hoisted(() => ({
  settingUpsertMock: vi.fn(),
  settingFindManyMock: vi.fn(),
  connectionFindManyMock: vi.fn(),
  executeSSHMock: vi.fn(),
  applySFlowOnNodeMock: vi.fn(),
}))

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    setting: {
      upsert: settingUpsertMock,
      findMany: settingFindManyMock,
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

import {
  reconcileSFlow,
  saveDesiredSFlowConfig,
  SFLOW_DESIRED_CONFIG_KEY,
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
    expect(executeSSHMock).toHaveBeenCalledWith("right-tenant", "10.0.0.1", "sflow-probe-command")
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
    expect(applySFlowOnNodeMock).toHaveBeenCalledWith("connection-1", "10.0.0.1", desiredConfig)
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
