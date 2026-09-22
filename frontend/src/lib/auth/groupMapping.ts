// src/lib/auth/groupMapping.ts
// Shared helper for the LDAP + OIDC config routes.
//
// Both routes upsert a `groupRoleMapping` JSONB column from the same
// frontend payload shape (a stringified JSON object). Factored out so
// each route's PUT handler stays a single function call, which keeps
// the new-code duplication metric inside the Sonar quality gate.

import { DEFAULT_TENANT_ID } from '@/lib/tenant/constants'

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
 * Read the raw groups claim from an OIDC profile and report BOTH the extracted
 * group list and whether the IdP actually sent an array (even an empty one).
 * The array flag is captured before extraction because extractGroupsFromClaim
 * collapses missing / non-array / empty all to []. The OIDC role re-sync uses it
 * to decide whether the group->role mapping is authoritative (issue #442): a
 * real array (even empty) is authoritative, a missing / non-array claim is not.
 */
export function readGroupsClaim(
  profile: Record<string, unknown>,
  claimKey: string | null | undefined,
): { groups: string[]; groupsClaimIsArray: boolean } {
  const raw = profile[claimKey || "groups"]
  return { groups: extractGroupsFromClaim(raw), groupsClaimIsArray: Array.isArray(raw) }
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

// ---------------------------------------------------------------------------
// Ordered mapping (both providers)
// ---------------------------------------------------------------------------
//
// The mapping is a LIST, never an object. A `{ group: role }` object stored in
// a jsonb column comes back with its keys re-sorted (by length, then bytewise),
// so the row order an admin types in the SSO form could not survive a single
// save (issue #992). That order is what decides which role a user in several
// mapped groups ends up with, so it has to be durable.

/** How several matching rows combine for one user. */
export type MappingStrategy = "first_match" | "cumulative"

export const MAPPING_STRATEGIES: readonly MappingStrategy[] = ["first_match", "cumulative"]

/** Anything unknown (including a null column on an old row) means first match. */
export function normalizeMappingStrategy(input: unknown): MappingStrategy {
  const value = typeof input === "string" ? input.trim() : ""
  return (MAPPING_STRATEGIES as readonly string[]).includes(value)
    ? (value as MappingStrategy)
    : "first_match"
}

/** One row of the LDAP mapping form. */
export type GroupRoleEntry = { group: string; role: string }

/**
 * Parse an LDAP group->role payload into an ordered entry list. Accepts the
 * list form, the legacy flat object, or a JSON string of either (the config
 * form posts a string). Order is preserved for the list form; a legacy object
 * is read in whatever order jsonb hands its keys back, which is the best that
 * can be done for a mapping whose order was never stored.
 */
export function normalizeGroupRoleEntries(input: unknown): GroupRoleEntry[] {
  let raw: unknown = input
  if (typeof input === "string") {
    try {
      raw = JSON.parse(input || "[]")
    } catch {
      return []
    }
  }

  const out: GroupRoleEntry[] = []
  const push = (rawGroup: unknown, rawRole: unknown) => {
    const group = String(rawGroup ?? "").trim()
    const role = String(rawRole ?? "").trim()
    // A half-filled row must not silently become a grant.
    if (!group || PROTOTYPE_POLLUTION_KEYS.has(group) || !role) return
    out.push({ group, role })
  }

  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue
      const entry = item as Record<string, unknown>
      push(entry.group, entry.role)
    }
    return out
  }

  for (const [group, role] of Object.entries(normalizeGroupRoleMapping(raw))) {
    push(group, role)
  }
  return out
}

/**
 * Project an entry list back onto the flat `{ group: role }` shape. The topmost
 * entry of a repeated group wins, mirroring what the login path resolves.
 */
export function projectEntriesToRoleMapping(
  entries: readonly GroupRoleEntry[],
): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  for (const entry of entries) {
    if (PROTOTYPE_POLLUTION_KEYS.has(entry.group)) continue
    if (out[entry.group]) continue
    out[entry.group] = entry.role
  }
  return out
}

// ---------------------------------------------------------------------------
// Tenant / vDC aware mapping (OIDC only)
// ---------------------------------------------------------------------------
//
// The flat `{ group: role }` shape above can only ever describe one grant per
// group, in the provider tenant. An MSP mapping a group to a role inside a
// customer tenant (or inside one vDC of that tenant) needs several grants for
// the same group, so the OIDC side stores a LIST of entries in the very same
// `group_role_mapping` JSONB column:
//
//   [{ group: "ops-acme", tenant: "t_acme", vdc: "vdc_prod", role: "role_operator" }]
//
// `vdc` absent/empty means "the whole tenant". A config written before this
// feature is still a flat object, and reads back as one default-tenant,
// unscoped entry per key, so no data migration is required.

// The provider tenant id, single-sourced from lib/tenant/constants (that module
// is dependency-free, so importing it here keeps this helper client-safe).
export { DEFAULT_TENANT_ID }

export type GroupGrant = {
  /** IdP group name, matched exactly (trimmed on both sides). */
  group: string
  tenantId: string
  /** null = the grant covers the whole tenant. */
  vdcId: string | null
  /** Role id or bare role name; normalised to a role_ id at resolution time. */
  role: string
}

/** Trim an unknown into a string, treating null/undefined as empty. */
function trimmed(value: unknown): string {
  if (value == null) return ''
  return String(value).trim()
}

/**
 * Parse a group->grant payload into a clean entry list. Accepts the new array
 * form, the legacy flat object, or a JSON string of either (the config form
 * posts a string). Malformed input yields an empty list rather than throwing,
 * so a broken payload can never take the login path down with it.
 *
 * Entries missing a group or a role are dropped: a half-filled UI row must not
 * silently become a grant.
 */
export function normalizeGroupGrantMapping(input: unknown): GroupGrant[] {
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input || '[]')
    } catch {
      return []
    }
  }

  if (Array.isArray(raw)) {
    const out: GroupGrant[] = []
    for (const item of raw) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const entry = item as Record<string, unknown>
      const group = trimmed(entry.group)
      const role = trimmed(entry.role)
      if (!group || PROTOTYPE_POLLUTION_KEYS.has(group) || !role) continue
      // Accept both the wire names (tenant/vdc) and the internal ones.
      const tenantId = trimmed(entry.tenant ?? entry.tenantId) || DEFAULT_TENANT_ID
      const vdcId = trimmed(entry.vdc ?? entry.vdcId) || null
      out.push({ group, tenantId, vdcId, role })
    }
    return out
  }

  // Legacy flat object: every key is a provider-tenant, unscoped grant.
  const flat = normalizeGroupRoleMapping(raw)
  const out: GroupGrant[] = []
  for (const [group, rawRole] of Object.entries(flat)) {
    const role = trimmed(rawRole)
    if (!role) continue
    out.push({ group, tenantId: DEFAULT_TENANT_ID, vdcId: null, role })
  }
  return out
}

/**
 * Project a grant list back onto the flat `{ group: role }` shape, keeping only
 * the unscoped provider-tenant entries (first one per group wins). This is what
 * the legacy `resolveOidcRole` path and the denormalised `users.role` display
 * column still read, so a mapping that only targets customer tenants simply
 * projects to an empty object and those callers fall back to the default role.
 */
export function projectGrantsToRoleMapping(grants: readonly GroupGrant[]): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  for (const grant of grants) {
    if (grant.tenantId !== DEFAULT_TENANT_ID || grant.vdcId) continue
    if (PROTOTYPE_POLLUTION_KEYS.has(grant.group)) continue
    if (out[grant.group]) continue
    out[grant.group] = grant.role
  }
  return out
}
