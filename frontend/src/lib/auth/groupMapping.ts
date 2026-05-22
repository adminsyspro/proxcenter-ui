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
// Keys that, written via bracket assignment on a normal object literal, would
// mutate the prototype chain instead of creating an own property. We harden
// twice: by initialising the result with `Object.create(null)` (no prototype
// to walk) and by skipping these names explicitly. Belt and suspenders so a
// future refactor that loses the null-proto trick still stays safe.
const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Coerce an IdP groups claim into a clean string array. Accepts arrays of
 * mixed types from upstream and drops anything that trims to empty so the
 * downstream role-resolution loop doesn't waste a roundtrip on noise.
 * Non-array inputs (missing claim, single string, etc.) return [].
 */
export function extractGroupsFromClaim(claim: unknown): string[] {
  if (!Array.isArray(claim)) return []
  const out: string[] = []
  for (const raw of claim) {
    // Skip null / undefined before String() so we don't end up with the
    // literal "null" / "undefined" as a group name.
    if (raw == null) continue
    const g = String(raw).trim()
    if (g) out.push(g)
  }
  return out
}

/**
 * Decide whether a user with the given groups is in any of the allowed
 * groups for an LDAP login. Accepts full DN strings on either side and
 * also matches by extracting the CN from a user-side DN so admins can
 * configure either "CN=ops,OU=..." or just "ops" and have the lookup
 * succeed. Trims whitespace on both sides; an empty allowed list always
 * returns false.
 */
export function isLdapGroupAllowed(
  userGroups: readonly string[] | undefined | null,
  allowedGroups: readonly string[] | undefined | null,
): boolean {
  if (!allowedGroups || allowedGroups.length === 0) return false
  const userList = userGroups ?? []
  return allowedGroups.some(rawAllowed => {
    const allowedGroup = String(rawAllowed).trim()
    if (!allowedGroup) return false
    return userList.some(rawUser => {
      const userGroup = String(rawUser).trim()
      if (!userGroup) return false
      if (userGroup === allowedGroup) return true
      const cnMatch = userGroup.match(/^CN=([^,]+)/i)
      return cnMatch ? cnMatch[1].trim() === allowedGroup : false
    })
  })
}

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

  const cleaned: Record<string, string> = Object.create(null)
  for (const [k, v] of Object.entries(raw)) {
    const key = String(k).trim()
    if (!key || PROTOTYPE_POLLUTION_KEYS.has(key)) continue
    cleaned[key] = v
  }
  return cleaned
}
