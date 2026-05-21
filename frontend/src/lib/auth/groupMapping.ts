// src/lib/auth/groupMapping.ts
// Shared helper for the LDAP + OIDC config routes.
//
// Both routes upsert a `groupRoleMapping` JSONB column from the same
// frontend payload shape (a stringified JSON object). Factored out so
// each route's PUT handler stays a single function call, which keeps
// the new-code duplication metric inside the Sonar quality gate.

/**
 * Parse and normalise a group->role mapping payload from the LDAP/OIDC
 * config form. Accepts either a JSON string (current frontend pattern)
 * or an already-parsed object (forward-compat). Returns an empty object
 * on malformed input rather than throwing, so the upsert path stays
 * robust against a broken UI payload.
 *
 * Trims whitespace on group names so a copy-paste from AD or an IdP doc
 * that picked up a stray leading or trailing space does not silently
 * break the exact-match lookup at login time. Entries whose key is
 * empty after trim are dropped.
 */
export function normalizeGroupRoleMapping(input: unknown): Record<string, string> {
  let raw: Record<string, string> = {}
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input || '{}')
    } catch {
      raw = {}
    }
  } else if (input && typeof input === 'object') {
    raw = input as Record<string, string>
  }

  const cleaned: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k).trim()
    if (key) cleaned[key] = v
  }
  return cleaned
}
