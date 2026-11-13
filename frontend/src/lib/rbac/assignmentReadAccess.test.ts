import { describe, expect, it, vi } from "vitest"

const hasAny = vi.hoisted(() => vi.fn())

vi.mock("@/lib/rbac", () => ({
  hasAnyPermission: (...a: unknown[]) => hasAny(...a),
  PERMISSIONS: { ADMIN_USERS_VIEW: "admin.users.view", ADMIN_RBAC_VIEW: "admin.rbac.view" },
}))

import { canReadRoleAssignments } from "./assignmentReadAccess"

describe("canReadRoleAssignments", () => {
  it("asks admin.users.view or admin.rbac.view (implied by admin.users and admin.rbac) in the caller's tenant", async () => {
    hasAny.mockResolvedValue(true)
    expect(await canReadRoleAssignments("u1", "t1")).toBe(true)
    expect(hasAny).toHaveBeenCalledWith("u1", ["admin.users.view", "admin.rbac.view"], undefined, undefined, "t1")
    hasAny.mockResolvedValue(false)
    expect(await canReadRoleAssignments("u1", "t1")).toBe(false)
  })
})
