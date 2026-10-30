/**
 * Who made a change, as the orchestrator attributes it: verified by
 * ProxCenter's own audit, inferred from a Proxmox task or the node journal,
 * or unknown. A row written before attribution has none and keeps the
 * poller's user.
 */

/** One candidate author of a change, as the orchestrator records it. */
export type ChangeActor = {
  name: string
  source: 'audit' | 'migration' | 'task' | 'journal'
  at?: string
  node?: string
  ref?: string
  taskType?: string
  tenantId?: string
  /** The name is ProxCenter's own API token on the connection. */
  token?: boolean
  /** Set by the API when the account belongs to another tenant. */
  masked?: boolean
}

export type Attribution = 'verified' | 'inferred' | 'unknown'

export type AttributedChange = {
  user?: string
  attribution?: string
  actors?: ChangeActor[]
}

const RANK: Record<Attribution, number> = { unknown: 0, inferred: 1, verified: 2 }

export const ATTRIBUTION_META: Record<Attribution, { icon: string; color: 'success' | 'info' | 'default'; label: string; hint: string }> = {
  verified: { icon: 'ri-shield-check-line', color: 'success', label: 'changes.attributionVerified', hint: 'changes.attributionVerifiedHint' },
  inferred: { icon: 'ri-search-eye-line', color: 'info', label: 'changes.attributionInferred', hint: 'changes.attributionInferredHint' },
  unknown: { icon: 'ri-question-line', color: 'default', label: 'changes.attributionUnknown', hint: 'changes.attributionUnknownHint' }
}

export const isAttribution = (v: unknown): v is Attribution => v === 'verified' || v === 'inferred' || v === 'unknown'

/** The least certain attribution of the changes, undefined when none has one. */
export function attributionOf(changes: readonly AttributedChange[]): Attribution | undefined {
  let level: Attribution | undefined

  for (const c of changes) {
    if (!isAttribution(c.attribution)) continue
    if (level === undefined || RANK[c.attribution] < RANK[level]) level = c.attribution
  }

  return level
}

/** The authors a change names, one per account. */
export function authorsOf(c: AttributedChange): string[] {
  return (c.user || '').split(', ').filter(Boolean)
}

/** The authors of several changes, each once, in order of appearance. */
export function authorsOfAll(changes: readonly AttributedChange[]): string[] {
  return [...new Set(changes.flatMap(authorsOf))]
}

const WEIGHT = (a: ChangeActor) => {
  if (a.source === 'audit' || a.source === 'migration') return 0

  return a.token ? 2 : 1
}

/**
 * The evidence in reading order: ProxCenter's own records first, which name
 * the author, then the other Proxmox accounts, then ProxCenter's token, which
 * only shows it acting; in time order within each.
 */
export function evidenceOrder(actors: readonly ChangeActor[]): ChangeActor[] {
  return [...actors].sort((a, b) => WEIGHT(a) - WEIGHT(b))
}

/** The label of where an actor's name was read, and its values. */
export function actorSource(a: ChangeActor): { key: string; values: Record<string, string> } {
  if (a.masked) return { key: 'changes.actorMasked', values: {} }
  if (a.source === 'audit') return { key: 'changes.actorSourceAudit', values: {} }
  if (a.source === 'migration') return { key: 'changes.actorSourceMigration', values: {} }
  if (a.source === 'task') return { key: 'changes.actorSourceTask', values: { type: a.taskType || '', node: a.node || '' } }

  return { key: 'changes.actorSourceJournal', values: { node: a.node || '' } }
}
