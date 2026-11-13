import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextResponse } from "next/server"

// roadmap#224: the route forwards to the event-rule engine only the events
// the caller could have read on the Events feed (lib/alerts/eventRelayScope).
const h = vi.hoisted(() => ({
  checkPermission: vi.fn(),
  orchestratorFetch: vi.fn(),
  scope: vi.fn(),
}))

vi.mock("@/lib/rbac", () => ({
  checkPermission: (...a: unknown[]) => h.checkPermission(...a),
  PERMISSIONS: { ALERTS_MANAGE: "alerts.manage" },
}))
vi.mock("@/lib/orchestrator/client", () => ({ orchestratorFetch: (...a: unknown[]) => h.orchestratorFetch(...a) }))
vi.mock("@/lib/demo/demo-api", () => ({ demoResponse: () => null }))
vi.mock("@/lib/alerts/eventRelayScope", () => ({ scopeRelayedEvents: (...a: unknown[]) => h.scope(...a) }))

import { POST } from "./route"
import { callRoute, readJson } from "@/__tests__/setup/route-test"

const own = { connectionId: "prod", category: "task", node: "pve3", entity: "106" }
const neighbour = { connectionId: "prod", category: "task", node: "pve3", entity: "7201" }

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.orchestratorFetch.mockReset().mockImplementation(async (_p: string, o: { body: unknown[] }) => ({ status: "ok", processed: o.body.length }))
  h.scope.mockReset().mockImplementation(async (events: any[]) => events.filter(e => e.entity === "106"))
})

describe("POST /api/v1/orchestrator/alerts/events", () => {
  it("forwards only the events the caller could read on the feed", async () => {
    const res = await callRoute(POST, { body: [own, neighbour] })
    expect(res.status).toBe(200)
    expect(h.scope).toHaveBeenCalledWith([own, neighbour])
    expect(h.orchestratorFetch).toHaveBeenCalledWith("/alerts/events", { method: "POST", body: [own] })
    expect(await readJson(res)).toEqual({ status: "ok", processed: 1 })
  })

  it("answers processed 0 without calling the orchestrator when nothing is left", async () => {
    const res = await callRoute(POST, { body: [neighbour] })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ status: "ok", processed: 0 })
    expect(h.orchestratorFetch).not.toHaveBeenCalled()
  })

  it("needs alerts.manage, before reading anything", async () => {
    h.checkPermission.mockResolvedValue(NextResponse.json({ error: "Forbidden" }, { status: 403 }))
    const res = await callRoute(POST, { body: [own] })
    expect(res.status).toBe(403)
    expect(h.checkPermission).toHaveBeenCalledWith("alerts.manage")
    expect(h.scope).not.toHaveBeenCalled()
    expect(h.orchestratorFetch).not.toHaveBeenCalled()
  })

  it("400s on a body that is not an array", async () => {
    const res = await callRoute(POST, { body: { events: [own] } })
    expect(res.status).toBe(400)
    expect(h.orchestratorFetch).not.toHaveBeenCalled()
  })

  it("skips quietly when the orchestrator is down", async () => {
    h.orchestratorFetch.mockRejectedValue(Object.assign(new Error("connect ECONNREFUSED"), { code: "ORCHESTRATOR_UNAVAILABLE" }))
    const res = await callRoute(POST, { body: [own] })
    expect(await readJson(res)).toEqual({ status: "skipped", reason: "orchestrator unavailable" })
  })
})
