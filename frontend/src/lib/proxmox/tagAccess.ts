/**
 * PVE datacenter "User Tag Access" and "Registered Tags" (#1208).
 *
 * ProxCenter writes guest tags with the connection's credentials, which PVE
 * treats as a privileged user, so PVE's own check never fires for a
 * ProxCenter user. These helpers replay PVE's rules
 * (PVE::GuestHelpers::get_allowed_tags / assert_tag_permissions) so the
 * routes can apply them on ProxCenter's side.
 */

export type UserTagAllow = 'free' | 'list' | 'existing' | 'none'

export interface TagAccessConfig {
  userAllow: UserTagAllow
  allowList: string[]
  registered: string[]
}

export interface TagPolicy {
  /** ProxCenter's equivalent of PVE's Sys.Modify on `/`. */
  privileged: boolean
  userAllow: UserTagAllow
  freeform: boolean
  allowed: Set<string>
  registered: Set<string>
  /** Tags already on a guest the user can see. */
  guestTags: Set<string>
}

export type TagDenial = { tag: string; reason: 'registered' | 'not-allowed' }

const USER_ALLOW_MODES = new Set<UserTagAllow>(['free', 'list', 'existing', 'none'])

/** PVE's split_list: tags are separated by `;`, `,` or whitespace. */
export function splitTags(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(splitTags)
  if (value === null || value === undefined) return []
  return String(value).split(/[;,\s]+/).filter(Boolean)
}

function propertyStringField(value: unknown, field: string): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) return (value as Record<string, unknown>)[field]
  if (typeof value !== 'string') return undefined
  for (const part of value.split(',')) {
    const eq = part.indexOf('=')
    if (eq > 0 && part.slice(0, eq).trim() === field) return part.slice(eq + 1)
  }
  return undefined
}

/** Reads the two options from a GET /cluster/options answer (object or string form). */
export function parseTagAccessConfig(options: Record<string, unknown> | null | undefined): TagAccessConfig {
  const access = options?.['user-tag-access']
  const mode = String(propertyStringField(access, 'user-allow') ?? 'free') as UserTagAllow
  return {
    userAllow: USER_ALLOW_MODES.has(mode) ? mode : 'free',
    allowList: splitTags(propertyStringField(access, 'user-allow-list')),
    registered: splitTags(options?.['registered-tags']),
  }
}

/**
 * Mirrors get_allowed_tags. `visibleGuestTags` are the tags of the guests the
 * user can see, which PVE adds in `free` and `existing` modes.
 */
export function buildTagPolicy(config: TagAccessConfig, privileged: boolean, visibleGuestTags: Iterable<string>): TagPolicy {
  const allowed = new Set<string>()
  const registered = new Set(config.registered)
  const guestTags = new Set(visibleGuestTags)
  if (config.userAllow !== 'none' || privileged) config.allowList.forEach(tag => allowed.add(tag))
  if (config.userAllow === 'free' || config.userAllow === 'existing' || privileged) {
    guestTags.forEach(tag => allowed.add(tag))
  }
  if (privileged) registered.forEach(tag => allowed.add(tag))
  else registered.forEach(tag => allowed.delete(tag))
  return { privileged, userAllow: config.userAllow, freeform: config.userAllow === 'free', allowed, registered, guestTags }
}

/** True when the user may add or remove this tag (assert_tag_permissions' single-tag check). */
export function canChangeTag(policy: TagPolicy, tag: string): boolean {
  if (policy.privileged) return true
  if (policy.registered.has(tag)) return false
  return policy.freeform || policy.allowed.has(tag)
}

/**
 * Mirrors assert_tag_permissions: every tag whose count differs between the
 * old and new value must pass the single-tag check. Returns the first denial.
 */
export function findTagDenial(policy: TagPolicy, oldValue: unknown, newValue: unknown): TagDenial | null {
  if (policy.privileged) return null
  const tag = changedTags(oldValue, newValue).find(t => !canChangeTag(policy, t))
  if (tag === undefined) return null
  return { tag, reason: policy.registered.has(tag) ? 'registered' : 'not-allowed' }
}

/** The tags added or removed between two values, duplicates counted as PVE does. */
export function changedTags(oldValue: unknown, newValue: unknown): string[] {
  const count = (tags: string[]) => tags.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<string, number>())
  const before = count(splitTags(oldValue))
  const after = count(splitTags(newValue))
  return [...new Set([...before.keys(), ...after.keys()])].filter(t => (before.get(t) ?? 0) !== (after.get(t) ?? 0))
}

/** Whether a `tags` change needs the guest tags to be decided. */
export function policyNeedsGuestTags(config: TagAccessConfig, privileged: boolean): boolean {
  return !privileged && config.userAllow === 'existing'
}
