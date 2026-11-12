// Anti-escalation: a creator may only mint a write scope, or an admin read
// scope (CREATOR_CHECKED_READ_SCOPE_IDS), whose every permission key they hold
// broadly (global, or on each token connection; global only for the admin
// rights, see isGlobalScopePermission).
import { holdsBroadPermission } from "@/lib/rbac"

import { isCreatorCheckedScope, SCOPE_DEFINITIONS } from "./scopes"

/** Whether `userId` holds every permission key of the creator-checked scope `scopeId`. */
export async function holdsWriteScope(
  userId: string,
  tenantId: string,
  scopeId: string,
  connectionIds: string[] | null,
): Promise<boolean> {
  if (!isCreatorCheckedScope(scopeId)) return false
  const keys = SCOPE_DEFINITIONS[scopeId]
  if (!keys) return false
  for (const key of keys) {
    if (!(await holdsBroadPermission(userId, tenantId, key, connectionIds))) return false
  }
  return true
}

/** The first requested creator-checked scope the user cannot grant, or null. */
export async function firstUngrantableScope(
  userId: string,
  tenantId: string,
  scopes: string[],
  connectionIds: string[] | null,
): Promise<string | null> {
  for (const scope of scopes) {
    if (isCreatorCheckedScope(scope) && !(await holdsWriteScope(userId, tenantId, scope, connectionIds))) return scope
  }
  return null
}
