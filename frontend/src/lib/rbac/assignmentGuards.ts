// src/lib/rbac/assignmentGuards.ts
//
// The one set of rules every path that grants a role obeys: POST and PATCH
// /rbac/assignments, POST /tenants/[id]/users and the role propagation of
// PATCH /users/[id]. They used to carry their own copies, and the copies
// drifted: the user PATCH only checked that the role existed (roadmap#97).
//
//  1. Provider-only and protected roles never land in a customer tenant.
//  2. Protected roles (super_admin, provider_admin) come from a super admin
//     only, and a protected target is only touched by a super admin; both
//     read as unknown to anyone else.
//  3. The role must exist and, when it belongs to a tenant, to the target one.
//  4. NIC identity rights (MAC, VLAN) are granted by a super admin only.

import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { isUserProtected, isUserSuperAdmin, PROTECTED_ROLE_IDS, PROVIDER_ONLY_ROLE_IDS } from "@/lib/rbac"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

import { roleHasSensitiveNicPermissions } from "./nicPermissions"

export type AssignableRole = {
  id: string
  name: string
  tenantId: string | null
  permissions: { permissionId: string }[]
}

export type RoleAssignmentGuardInput = {
  /** The user granting the role. */
  callerUserId: string
  roleId: string
  /** The tenant the grant is written in. */
  targetTenantId: string
  /** The user receiving the role, when the protected-target rule applies. */
  targetUserId?: string | null
}

// FLAT on purpose (tsconfig strict:false breaks discriminated-union
// narrowing): callers test `ok` and read `response` or `role`.
export type RoleAssignmentGuardResult = {
  ok: boolean
  response?: NextResponse
  role?: AssignableRole
  callerIsSuperAdmin?: boolean
}

const TENANT_FORBIDDEN_ROLE_IDS: readonly string[] = [...PROVIDER_ONLY_ROLE_IDS, ...PROTECTED_ROLE_IDS]

const refuse = (error: string, status: number): RoleAssignmentGuardResult => ({
  ok: false,
  response: NextResponse.json({ error }, { status }),
})

export async function guardRoleAssignment(input: RoleAssignmentGuardInput): Promise<RoleAssignmentGuardResult> {
  const { callerUserId, roleId, targetTenantId, targetUserId } = input

  if (targetTenantId !== DEFAULT_TENANT_ID && TENANT_FORBIDDEN_ROLE_IDS.includes(roleId)) {
    return refuse("This role can only be assigned in the provider tenant (default)", 400)
  }

  const callerIsSuperAdmin = await isUserSuperAdmin(callerUserId)
  if (!callerIsSuperAdmin) {
    if ((PROTECTED_ROLE_IDS as readonly string[]).includes(roleId)) return refuse("Role not found", 404)
    if (targetUserId && (await isUserProtected(targetUserId))) return refuse("User not found", 404)
  }

  const role = (await prisma.rbacRole.findUnique({
    where: { id: roleId },
    select: { id: true, name: true, tenantId: true, permissions: { select: { permissionId: true } } },
  })) as AssignableRole | null
  const roleTenantId = role?.tenantId ?? null
  if (!role || (roleTenantId !== null && roleTenantId !== targetTenantId)) return refuse("Role not found", 404)

  if (!callerIsSuperAdmin && roleHasSensitiveNicPermissions(role)) {
    return refuse("Only a super admin may grant NIC identity permissions", 403)
  }

  return { ok: true, role, callerIsSuperAdmin }
}
