// src/lib/auth/ldapDiagnostic.ts
//
// Read-only LDAP user lookup diagnostic (roadmap#38). The orchestrator finds
// the user exactly as sign-in does and reports what the directory answered;
// this module adds what ProxCenter decides on top of it at sign-in: the
// allowed-group restriction, then the group to role mapping. Nothing here
// writes anything or checks a password.

import { isLdapGroupAllowed, type GroupRoleEntry } from "./groupMapping"
import { matchLdapRoleEntry } from "./ldap"

export type LookupStatus = "found" | "not_found" | "ambiguous" | "invalid_filter" | "error"

export interface LookupUser {
  dn: string
  email: string
  name: string
  groups: string[]
}

export interface FilterGroupCheck {
  group: string
  recursive: boolean
  evaluated: boolean
  direct: boolean
  via?: string[]
}

export interface NestedGroup {
  group: string
  via: string
}

/** What the orchestrator answers on POST /api/v1/auth/ldap/lookup. */
export interface LdapLookupResult {
  status: LookupStatus
  stage?: string
  error?: string
  filter?: string
  base_dn?: string
  username_placeholder: boolean
  match_count: number
  more?: boolean
  matches?: string[]
  user?: LookupUser
  identity?: {
    filter: string
    match_count: number
    more?: boolean
    matches?: string[]
    user?: LookupUser
  }
  filter_groups?: FilterGroupCheck[]
  nested_groups?: NestedGroup[]
  nested_truncated?: boolean
  password_checked: boolean
}

/** The form values the evaluation reads (saved or not). */
export interface LdapPolicyInput {
  requireGroup: boolean
  allowedGroups: string[]
  groupRoleMapping: GroupRoleEntry[]
  defaultRole: string
}

/**
 * Why sign-in would be refused, in the order sign-in checks it. null = the
 * lookup found nothing that blocks sign-in (the password is still unchecked).
 */
export type LoginBlocker =
  | "invalid_filter"
  | "lookup_error"
  | "not_found"
  | "excluded_by_filter"
  | "ambiguous"
  | "not_in_allowed_group"
  | null

export type DiagnosticHint =
  | "username_format"
  | "nested_membership"
  | "placeholder_missing"
  | "base_dn_scope"

export interface AllowedGroupDecision {
  /** Restriction on and at least one allowed group: otherwise it does not apply. */
  enforced: boolean
  allowed: boolean | null
  /** Allowed groups the user only reaches through a nested group. */
  nestedOnly: string[]
}

export interface RoleDecision {
  /** Mapping row that gives the role, top-down first match. */
  matchedGroup: string | null
  roleId: string | null
  defaultRoleId: string
  /** Mapping rows the user would match only through a nested group. */
  nestedOnly: string[]
}

export interface LdapDiagnosticEvaluation {
  blocker: LoginBlocker
  /** The entry the decisions below are computed for (found user, or the one the filter excludes). */
  subject: LookupUser | null
  allowedGroup: AllowedGroupDecision | null
  role: RoleDecision | null
  hints: DiagnosticHint[]
}

/** Both spellings of a group (full DN lower-cased, and its CN) for comparisons. */
function groupKeys(group: string): string[] {
  const trimmed = String(group).trim()
  if (!trimmed) return []
  const keys = [trimmed.toLowerCase().replace(/\s*,\s*/g, ",")]
  const cn = trimmed.match(/^CN=([^,]+)/i)
  if (cn) keys.push(cn[1].trim().toLowerCase())
  return keys
}

/** Configured groups (allowed groups, mapping rows) the user reaches only by nesting. */
function nestedOnlyMatches(configured: string[], direct: string[], nested: NestedGroup[]): string[] {
  const directKeys = new Set(direct.flatMap(groupKeys))
  const nestedKeys = new Set(nested.map(n => n.group).flatMap(groupKeys))
  return configured.filter(g => {
    const keys = groupKeys(g)
    return keys.length > 0 && !keys.some(k => directKeys.has(k)) && keys.some(k => nestedKeys.has(k))
  })
}

/**
 * Combine the directory lookup with the sign-in policy: which step refuses
 * the user, the allowed-group decision, and the role sign-in would assign.
 */
export function evaluateLdapLookup(
  lookup: LdapLookupResult,
  policy: LdapPolicyInput,
  username: string,
): LdapDiagnosticEvaluation {
  const hints: DiagnosticHint[] = []
  if (lookup.status !== "invalid_filter" && lookup.username_placeholder === false) {
    hints.push("placeholder_missing")
  }

  const subject = lookup.user ?? lookup.identity?.user ?? null
  let blocker: LoginBlocker = null
  switch (lookup.status) {
    case "invalid_filter":
      blocker = "invalid_filter"
      break
    case "error":
      blocker = "lookup_error"
      break
    case "ambiguous":
      blocker = "ambiguous"
      break
    case "not_found":
      blocker = lookup.identity?.user ? "excluded_by_filter" : "not_found"
      break
  }

  if (blocker === "not_found") {
    if (/[@\\]/.test(username)) hints.push("username_format")
    hints.push("base_dn_scope")
  }

  if (!subject) return { blocker, subject: null, allowedGroup: null, role: null, hints }

  const nested = lookup.nested_groups ?? []
  const enforced = policy.requireGroup && policy.allowedGroups.length > 0
  const allowedGroup: AllowedGroupDecision = {
    enforced,
    allowed: enforced ? isLdapGroupAllowed(subject.groups, policy.allowedGroups) : null,
    nestedOnly: enforced ? nestedOnlyMatches(policy.allowedGroups, subject.groups, nested) : [],
  }
  if (blocker === null && allowedGroup.allowed === false) blocker = "not_in_allowed_group"

  const entry = matchLdapRoleEntry(subject.groups, policy.groupRoleMapping)
  const role: RoleDecision = {
    matchedGroup: entry?.group ?? null,
    roleId: entry?.role ?? null,
    defaultRoleId: policy.defaultRole || "role_viewer",
    nestedOnly: nestedOnlyMatches(
      policy.groupRoleMapping.map(m => m.group),
      subject.groups,
      nested,
    ),
  }

  const nestedFilterClause = (lookup.filter_groups ?? []).some(c => c.evaluated && !c.direct && (c.via?.length ?? 0) > 0)
  if (nestedFilterClause || allowedGroup.nestedOnly.length > 0 || role.nestedOnly.length > 0) {
    hints.push("nested_membership")
  }

  return { blocker, subject, allowedGroup, role, hints }
}
