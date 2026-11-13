// src/lib/rbac/assignmentReadAccess.ts
//
// Who reads the role assignments of a tenant (roadmap#223). The two pages that
// list them, /security/users and /security/rbac, are opened with admin.users
// and admin.rbac; their read-only halves admin.users.view and admin.rbac.view
// are implied by them. Without any, a session reads its own assignments only,
// and no role's holders: the assignment list names every user of the platform
// with their e-mail, role and who granted it.

import { hasAnyPermission, PERMISSIONS } from "@/lib/rbac"

export async function canReadRoleAssignments(userId: string, tenantId: string): Promise<boolean> {
  return hasAnyPermission(userId, [PERMISSIONS.ADMIN_USERS_VIEW, PERMISSIONS.ADMIN_RBAC_VIEW], undefined, undefined, tenantId)
}
