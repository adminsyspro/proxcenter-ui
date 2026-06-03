/**
 * Shared scope validation for RBAC roles and assignments (issue #383).
 *
 * Kept in one place so the assignments routes (POST + PATCH) and the roles
 * routes (POST + PATCH) validate scope the same way instead of each carrying
 * its own list (Sonar duplication rule).
 */

// Scope types an assignment may carry. "inherit" follows the role's default
// scope; "global" is unscoped. Both carry no target.
export const ASSIGNMENT_SCOPE_TYPES = [
  "global",
  "connection",
  "node",
  "vm",
  "tag",
  "pool",
  "inherit",
] as const

// Scope types valid as a role's default scope. Excludes "global" (expressed as
// an empty list) and "inherit" (a role cannot inherit from itself).
export const ROLE_DEFAULT_SCOPE_TYPES = ["connection", "node", "vm", "tag", "pool"] as const

const NO_TARGET = new Set<string>(["global", "inherit"])

export type ScopeEntry = { scopeType: string; scopeTarget: string }

/**
 * Validate a single assignment scope. global/inherit carry no target (any
 * supplied target is dropped); every other type requires a non-empty target.
 */
export function validateAssignmentScope(
  scopeType: string,
  scopeTarget: string | null | undefined,
): { ok: boolean; error?: string; scopeType?: string; scopeTarget?: string | null } {
  if (!ASSIGNMENT_SCOPE_TYPES.includes(scopeType as (typeof ASSIGNMENT_SCOPE_TYPES)[number])) {
    return { ok: false, error: "scope_type invalide" }
  }
  if (NO_TARGET.has(scopeType)) {
    return { ok: true, scopeType, scopeTarget: null }
  }
  if (!scopeTarget) {
    return { ok: false, error: "scope_target requis pour ce type de scope" }
  }
  return { ok: true, scopeType, scopeTarget }
}

/**
 * Validate a role's default_scopes payload. Accepts an array of
 * { scopeType, scopeTarget } (snake_case keys are also accepted) and returns a
 * normalized camelCase list. An empty array clears the default scope (global).
 */
export function validateRoleDefaultScopes(
  input: unknown,
): { ok: boolean; error?: string; scopes?: ScopeEntry[] } {
  if (!Array.isArray(input)) {
    return { ok: false, error: "default_scopes doit être un tableau" }
  }
  const scopes: ScopeEntry[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: "entrée default_scopes invalide" }
    }
    const r = raw as Record<string, unknown>
    const scopeType = (r.scopeType ?? r.scope_type) as string
    const scopeTarget = (r.scopeTarget ?? r.scope_target) as string
    if (!ROLE_DEFAULT_SCOPE_TYPES.includes(scopeType as (typeof ROLE_DEFAULT_SCOPE_TYPES)[number])) {
      return { ok: false, error: `scopeType de default_scope invalide: ${String(scopeType)}` }
    }
    if (!scopeTarget || typeof scopeTarget !== "string") {
      return { ok: false, error: "scopeTarget requis pour chaque default_scope" }
    }
    scopes.push({ scopeType, scopeTarget })
  }
  return { ok: true, scopes }
}
