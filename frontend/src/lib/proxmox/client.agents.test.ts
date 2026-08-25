import { describe, it, expect, vi } from "vitest"
import { Agent } from "undici"

// client.ts pulls the connection cache at module load; stub it to keep this
// suite DB-free, exactly like client.test.ts does.
vi.mock("../connections/getConnection", () => ({ invalidateConnectionCache: vi.fn() }))

import { getDefaultAgent, getInsecureAgent } from "./client"

function agentOptions(agent: object): Record<string, any> {
  const key = Object.getOwnPropertySymbols(agent).find((s) => s.description === "options")!
  return (agent as any)[key]
}

describe("PVE undici agents", () => {
  it("caches one default Agent pinned to HTTP/1.1 with a connect timeout", () => {
    const agent = getDefaultAgent()
    expect(agent).toBeInstanceOf(Agent)
    expect(getDefaultAgent()).toBe(agent)
    expect(agentOptions(agent).allowH2).toBe(false)
    expect(agentOptions(agent).connect.rejectUnauthorized).toBeUndefined()
    expect(agentOptions(agent).connect.timeout).toBeGreaterThan(0)
  })

  it("caches one insecure Agent that only relaxes certificate validation", () => {
    const agent = getInsecureAgent()
    expect(agent).toBeInstanceOf(Agent)
    expect(getInsecureAgent()).toBe(agent)
    expect(agent).not.toBe(getDefaultAgent())
    expect(agentOptions(agent).allowH2).toBe(false)
    expect(agentOptions(agent).connect.rejectUnauthorized).toBe(false)
    expect(agentOptions(agent).connect.timeout).toBe(agentOptions(getDefaultAgent()).connect.timeout)
  })
})
