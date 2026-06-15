/**
 * Tests for useWidgetVisibility.
 *
 * Environment: node (no jsdom, no @testing-library/react).
 * Strategy: mock the two context hooks and mock React.useMemo to invoke the
 * factory synchronously so the hook can be called as a plain function.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

// ── Mock React.useMemo to call the factory synchronously ─────────────────────
// useMemo(factory, deps) → factory() in the test environment so we can call
// useWidgetVisibility() as a plain function without a React render tree.
vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>()
  return {
    ...actual,
    useMemo: (factory: () => any, _deps?: any[]) => factory(),
  }
})

// ── Mock context hooks ────────────────────────────────────────────────────────

const mockUseRBAC = vi.fn()
const mockUseTenant = vi.fn()

vi.mock("@/contexts/RBACContext", () => ({
  useRBAC: () => mockUseRBAC(),
}))

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => mockUseTenant(),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRbac(overrides: Partial<{ scopeTypes: string[]; isAdmin: boolean; hiddenWidgets: string[]; loading: boolean }> = {}) {
  return {
    scopeTypes: [],
    isAdmin: false,
    hiddenWidgets: [],
    loading: false,
    ...overrides,
  }
}

function makeTenant(overrides: Partial<{ isFullClusterView: boolean; loading: boolean }> = {}) {
  return {
    isFullClusterView: true,
    loading: false,
    ...overrides,
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("useWidgetVisibility", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("MSP tenant (isFullClusterView=true, non-default) admin → hasInfraScope true", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ isAdmin: true }))
    mockUseTenant.mockReturnValue(makeTenant({ isFullClusterView: true }))

    const { useWidgetVisibility } = await import("./useWidgetVisibility")
    const result = useWidgetVisibility()

    expect(result.hasInfraScope).toBe(true)
    expect(result.loading).toBe(false)
  })

  it("MSP tenant (isFullClusterView=true) non-admin with connection scope → hasInfraScope true", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ isAdmin: false, scopeTypes: ["connection"] }))
    mockUseTenant.mockReturnValue(makeTenant({ isFullClusterView: true }))

    const { useWidgetVisibility } = await import("./useWidgetVisibility")
    const result = useWidgetVisibility()

    expect(result.hasInfraScope).toBe(true)
    expect(result.loading).toBe(false)
  })

  it("IaaS/vDC tenant (isFullClusterView=false) → hasInfraScope false regardless of RBAC", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ isAdmin: true, scopeTypes: ["global"] }))
    mockUseTenant.mockReturnValue(makeTenant({ isFullClusterView: false }))

    const { useWidgetVisibility } = await import("./useWidgetVisibility")
    const result = useWidgetVisibility()

    expect(result.hasInfraScope).toBe(false)
    expect(result.loading).toBe(false)
  })

  it("IaaS/vDC tenant non-admin with no scopes → hasInfraScope false", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ isAdmin: false, scopeTypes: [] }))
    mockUseTenant.mockReturnValue(makeTenant({ isFullClusterView: false }))

    const { useWidgetVisibility } = await import("./useWidgetVisibility")
    const result = useWidgetVisibility()

    expect(result.hasInfraScope).toBe(false)
    expect(result.loading).toBe(false)
  })

  it("Provider tenant (isFullClusterView=true) admin → hasInfraScope true", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ isAdmin: true }))
    mockUseTenant.mockReturnValue(makeTenant({ isFullClusterView: true }))

    const { useWidgetVisibility } = await import("./useWidgetVisibility")
    const result = useWidgetVisibility()

    expect(result.hasInfraScope).toBe(true)
    expect(result.loading).toBe(false)
  })

  it("Provider tenant non-admin with tag-only scope → hasInfraScope false", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ isAdmin: false, scopeTypes: ["tag"] }))
    mockUseTenant.mockReturnValue(makeTenant({ isFullClusterView: true }))

    const { useWidgetVisibility } = await import("./useWidgetVisibility")
    const result = useWidgetVisibility()

    expect(result.hasInfraScope).toBe(false)
    expect(result.loading).toBe(false)
  })

  it("returns loading=true and hasInfraScope=true while tenant is loading", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ loading: false }))
    mockUseTenant.mockReturnValue(makeTenant({ loading: true }))

    const { useWidgetVisibility } = await import("./useWidgetVisibility")
    const result = useWidgetVisibility()

    expect(result.loading).toBe(true)
    expect(result.hasInfraScope).toBe(true)
  })

  it("propagates hiddenWidgets from RBAC into the result", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ isAdmin: true, hiddenWidgets: ["alerts", "backup"] }))
    mockUseTenant.mockReturnValue(makeTenant({ isFullClusterView: true }))

    const { useWidgetVisibility } = await import("./useWidgetVisibility")
    const result = useWidgetVisibility()

    expect(result.hiddenWidgets).toEqual(new Set(["alerts", "backup"]))
  })
})
