// Anti-escalation: a creator may only mint a write scope whose every
// permission key they hold broadly (global, or on each token connection).
import { holdsBroadPermission } from "@/lib/rbac"

import { isWriteScope, WRITE_SCOPE_DEFINITIONS } from "./scopes"

/** Whether `userId` holds every permission key of the write scope `scopeId`. */
export async function holdsWriteScope(
  userId: string,
  tenantId: string,
  scopeId: string,
  connectionIds: string[] | null,
): Promise<boolean> {
  const keys = WRITE_SCOPE_DEFINITIONS[scopeId]
  if (!keys) return false
  for (const key of keys) {
    if (!(await holdsBroadPermission(userId, tenantId, key, connectionIds))) return false
  }
  return true
}

/** The first requested write scope the user cannot grant, or null. */
export async function firstUngrantableScope(
  userId: string,
  tenantId: string,
  scopes: string[],
  connectionIds: string[] | null,
): Promise<string | null> {
  for (const scope of scopes) {
    if (isWriteScope(scope) && !(await holdsWriteScope(userId, tenantId, scope, connectionIds))) return scope
  }
  return null
}
