/**
 * Tests for useRBACScopeProfile.
 *
 * Environment: node (no jsdom, no @testing-library/react).
 * Strategy: mock the two context hooks and mock React.useMemo to invoke the
 * factory synchronously so the hook can be called as a plain function.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("react", async (orig) => {
  const actual = await orig<typeof import("react")>()
  return {
    ...actual,
    useMemo: (factory: () => any, _deps?: any[]) => factory(),
  }
})

const mockUseRBAC = vi.fn()
const mockUseTenant = vi.fn()

vi.mock("@/contexts/RBACContext", () => ({
  useRBAC: () => mockUseRBAC(),
}))

vi.mock("@/contexts/TenantContext", () => ({
  useTenant: () => mockUseTenant(),
}))

const ALL_VIEWS = ["tree", "vms", "hosts", "pools", "tags", "favorites", "templates"]

function makeRbac(overrides: Partial<{ roles: any[]; scopeTypes: string[]; isAdmin: boolean; loading: boolean }> = {}) {
  return {
    roles: [],
    scopeTypes: [],
    isAdmin: false,
    loading: false,
    ...overrides,
  }
}

function makeTenant(overrides: Partial<{ currentTenant: any; loading: boolean }> = {}) {
  return {
    currentTenant: { id: "default", operatingModel: "provider" },
    loading: false,
    ...overrides,
  }
}

async function run() {
  const { useRBACScopeProfile } = await import("./useRBACScopeProfile")
  return useRBACScopeProfile()
}

describe("useRBACScopeProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("admin → every view, default tree", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ isAdmin: true }))
    mockUseTenant.mockReturnValue(makeTenant())

    const result = await run()

    expect(result.defaultViewMode).toBe("tree")
    expect([...result.allowedViewModes].sort()).toEqual([...ALL_VIEWS].sort())
  })

  // Issue #842: an assignment whose scope_type is the "inherit" sentinel
  // follows the role's default scope, which is "global" when the role has
  // none. /rbac/effective already resolves that into scope_types; the raw
  // role row still says "inherit" and must not drive the view profile.
  it("inherit assignment resolved to global → every view, default tree", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({
      roles: [{ id: "role_custom", name: "Ops", scope_type: "inherit", scope_target: null }],
      scopeTypes: ["global"],
    }))
    mockUseTenant.mockReturnValue(makeTenant())

    const result = await run()

    expect(result.defaultViewMode).toBe("tree")
    expect([...result.allowedViewModes].sort()).toEqual([...ALL_VIEWS].sort())
  })

  it("inherit assignment resolved to a pool default scope → pools view, default pools", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({
      roles: [{ id: "role_custom", name: "Ops", scope_type: "inherit", scope_target: null }],
      scopeTypes: ["pool"],
    }))
    mockUseTenant.mockReturnValue(makeTenant())

    const result = await run()

    expect(result.defaultViewMode).toBe("pools")
    expect([...result.allowedViewModes].sort()).toEqual(["favorites", "pools", "templates", "vms"])
  })

  it("direct connection grant without any role → every view, default tree", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ roles: [], scopeTypes: ["connection"] }))
    mockUseTenant.mockReturnValue(makeTenant())

    const result = await run()

    expect(result.defaultViewMode).toBe("tree")
    expect([...result.allowedViewModes].sort()).toEqual([...ALL_VIEWS].sort())
  })

  it("tag-only → tags + safe views, default tags", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({
      roles: [{ id: "role_custom", scope_type: "tag", scope_target: "prod" }],
      scopeTypes: ["tag"],
    }))
    mockUseTenant.mockReturnValue(makeTenant())

    const result = await run()

    expect(result.defaultViewMode).toBe("tags")
    expect([...result.allowedViewModes].sort()).toEqual(["favorites", "tags", "templates", "vms"])
  })

  it("tag + pool → both views, default tags", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ scopeTypes: ["tag", "pool"] }))
    mockUseTenant.mockReturnValue(makeTenant())

    const result = await run()

    expect(result.defaultViewMode).toBe("tags")
    expect([...result.allowedViewModes].sort()).toEqual(["favorites", "pools", "tags", "templates", "vms"])
  })

  it("no scope at all → minimal views, default vms", async () => {
    mockUseRBAC.mockReturnValue(makeRbac())
    mockUseTenant.mockReturnValue(makeTenant())

    const result = await run()

    expect(result.defaultViewMode).toBe("vms")
    expect([...result.allowedViewModes].sort()).toEqual(["favorites", "templates", "vms"])
  })

  it("vDC tenant hides tree and hosts even with a global scope", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ scopeTypes: ["global"] }))
    mockUseTenant.mockReturnValue(makeTenant({ currentTenant: { id: "t-acme", operatingModel: "vdc" } }))

    const result = await run()

    expect(result.defaultViewMode).toBe("vms")
    expect([...result.allowedViewModes].sort()).toEqual(["favorites", "pools", "tags", "templates", "vms"])
  })

  it("MSP tenant keeps tree and hosts", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ scopeTypes: ["connection"] }))
    mockUseTenant.mockReturnValue(makeTenant({ currentTenant: { id: "t-msp", operatingModel: "msp" } }))

    const result = await run()

    expect(result.defaultViewMode).toBe("tree")
    expect([...result.allowedViewModes].sort()).toEqual([...ALL_VIEWS].sort())
  })

  it("returns loading=true with every view while RBAC is loading", async () => {
    mockUseRBAC.mockReturnValue(makeRbac({ loading: true }))
    mockUseTenant.mockReturnValue(makeTenant())

    const result = await run()

    expect(result.loading).toBe(true)
    expect(result.defaultViewMode).toBe("tree")
  })
})
