import { beforeEach, describe, expect, it, vi } from "vitest"

const m = vi.hoisted(() => ({ restricted: vi.fn(), alerts: vi.fn(), visible: vi.fn() }))

vi.mock("@/lib/rbac", () => ({ PERMISSIONS: { ALERTS_MANAGE: "alerts.manage" } }))
vi.mock("./localAlertScope", () => ({ isLocalAlertScopeRestricted: (...a: unknown[]) => m.restricted(...a) }))
vi.mock("./orchestratorAlertFeed", () => ({ fetchOrchestratorAlerts: () => m.alerts() }))
vi.mock("./orchestratorFingerprint", () => ({ buildOrchestratorFingerprint: (a: { fp: string }) => a.fp }))
vi.mock("@/lib/incidents/alertVisibility", () => ({ visibleAlertFilter: async () => (a: { fp: string }) => m.visible(a) }))

import { refuseInvisibleSilence } from "./silenceScope"

beforeEach(() => {
  vi.clearAllMocks()
  m.restricted.mockResolvedValue(true)
  m.alerts.mockResolvedValue([{ fp: "mine" }, { fp: "theirs" }])
  m.visible.mockImplementation(async (a: { fp: string }) => a.fp === "mine")
})

describe("refuseInvisibleSilence", () => {
  it("lets a caller nothing restricts silence any fingerprint, without reading the alerts", async () => {
    m.restricted.mockResolvedValue(false)
    expect(await refuseInvisibleSilence("anything")).toBeNull()
    expect(m.restricted).toHaveBeenCalledWith("alerts.manage")
    expect(m.alerts).not.toHaveBeenCalled()
  })

  it("lets a scoped caller silence an alert it sees", async () => {
    expect(await refuseInvisibleSilence("mine")).toBeNull()
  })

  it("is a 404 for an alert outside the scope, or no alert at all", async () => {
    expect((await refuseInvisibleSilence("theirs"))?.status).toBe(404)
    expect((await refuseInvisibleSilence("unknown"))?.status).toBe(404)
  })
})
