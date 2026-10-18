import { beforeEach, describe, expect, it, vi } from "vitest"

const { orchestratorFetchMock } = vi.hoisted(() => ({ orchestratorFetchMock: vi.fn() }))

vi.mock("@/lib/orchestrator", () => ({ orchestratorFetch: orchestratorFetchMock }))

import { reportExpectedAgents, type ExpectedAgentsUpdate } from "./expectedAgents"

const update: ExpectedAgentsUpdate = {
  connection_ids: ["conn-dr"],
  agents: [{
    connection_id: "conn-dr", connection_name: "PVE-DR", node: "pve2-dr", agent_ip: "10.42.0.112",
    target: "100.110.158.84:16343", polling_interval: 30, sampling_rate: 512, configured: true,
  }],
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe("reportExpectedAgents", () => {
  it("PUTs the inventory to the orchestrator", async () => {
    orchestratorFetchMock.mockResolvedValue({ upserted: 1, removed: 0 })

    await expect(reportExpectedAgents(update)).resolves.toBe(true)
    expect(orchestratorFetchMock).toHaveBeenCalledWith("/sflow/expected-agents", { method: "PUT", body: update })
  })

  it("sends nothing for an empty report", async () => {
    await expect(reportExpectedAgents({ connection_ids: [], agents: [] })).resolves.toBe(true)
    expect(orchestratorFetchMock).not.toHaveBeenCalled()
  })

  // The probe and the configure action must survive an orchestrator that is
  // down or predates the route.
  it("swallows an unavailable orchestrator and reports it did not get through", async () => {
    orchestratorFetchMock.mockRejectedValue(Object.assign(new Error("down"), { code: "ORCHESTRATOR_UNAVAILABLE" }))
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(reportExpectedAgents(update)).resolves.toBe(false)
    expect(warn).not.toHaveBeenCalled()

    orchestratorFetchMock.mockRejectedValue(new Error("404 not found"))
    await expect(reportExpectedAgents(update)).resolves.toBe(false)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })
})
