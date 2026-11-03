// src/lib/firewall/draft.ts
//
// The draft of the Firewalling tab (UA51): what the user changed in the rule lists of a connection and has not
// published yet. Nothing here talks to Proxmox. A scope (cluster, host, guest) holds the list as it was read when it
// was first edited (`base`, with the digest Proxmox gave it) and the list the user wants (`rules`). Each rule carries
// an id: a base rule keeps its id, a rule added in the draft gets a new one. The operations to publish are derived
// from the two lists, never recorded one by one, so an edit of a rule added in the draft is part of its creation, a
// rule added then deleted costs nothing, and a rule dragged back where it was is no move.

import type { DraftScope, PublishOp, RuleExpect, RuleFields, ScopeOptions } from './publishOps'
import { EXPECT_FIELDS, RULE_TEXT_FIELDS, isEngineComment, scopeKey } from './publishOps'

export type DraftEntry = { id: string; rule: RuleFields }

export type ScopeDraft = {
  scope: DraftScope
  /** Digest of the rule list as read when its rules were first edited ('' for an empty list). */
  baseDigest: string
  /** The rules as read, null while only the options of the scope changed (its rules may not even be read). */
  base: DraftEntry[] | null
  rules: DraftEntry[] | null
  /** Options to set, only the fields that differ from what was read. */
  options?: ScopeOptions
  /** Turn the guest firewall on (options and every NIC). */
  enableFirewall?: boolean
}

export type FirewallDraft = { scopes: Record<string, ScopeDraft>; seq: number }

export const EMPTY_DRAFT: FirewallDraft = { scopes: {}, seq: 0 }

/** The rule fields of a rule as read (the orchestrator drops `enable: 0`: only an explicit 1 is on, #1015). */
export type RuleLike = { type?: string; action?: string; enable?: number | string; digest?: string } & Partial<Record<(typeof RULE_TEXT_FIELDS)[number], string>>

export function toFields(rule: RuleLike): RuleFields {
  return {
    type: rule.type || 'in',
    action: rule.action || 'ACCEPT',
    enable: Number(rule.enable) === 1 ? 1 : 0,
    source: rule.source ?? '',
    dest: rule.dest ?? '',
    proto: rule.proto ?? '',
    dport: rule.dport ?? '',
    sport: rule.sport ?? '',
    macro: rule.macro ?? '',
    iface: rule.iface ?? '',
    log: rule.log || 'nolog',
    comment: rule.comment ?? '',
    'icmp-type': rule['icmp-type'] ?? '',
  }
}

const FIELD_KEYS = ['type', 'action', 'enable', ...RULE_TEXT_FIELDS] as const

/** The fields that differ, or null. Type and action always go together (the server checks one against the other). */
export function diffFields(before: RuleFields, after: RuleFields): Partial<RuleFields> | null {
  const patch: Record<string, string | number> = {}
  for (const key of FIELD_KEYS) {
    if (before[key] !== after[key]) patch[key] = after[key]
  }
  if (patch.type !== undefined || patch.action !== undefined) {
    patch.type = after.type
    patch.action = after.action
  }
  return Object.keys(patch).length > 0 ? (patch as Partial<RuleFields>) : null
}

const baseDigestOf = (rules: RuleLike[]) => rules.find(r => typeof r.digest === 'string')?.digest ?? ''

const entriesOf = (baseRules: RuleLike[]): DraftEntry[] => baseRules.map((rule, i) => ({ id: `b${i}`, rule: toFields(rule) }))

const emptyScope = (scope: DraftScope): ScopeDraft => ({ scope, baseDigest: '', base: null, rules: null })

function sameRules(a: DraftEntry[], b: DraftEntry[]): boolean {
  return a.length === b.length && a.every((e, i) => e.id === b[i].id && diffFields(e.rule, b[i].rule) === null)
}

const rulesIdle = (sd: ScopeDraft) => !sd.rules || !sd.base || sameRules(sd.base, sd.rules)

const isIdle = (sd: ScopeDraft) => !sd.enableFirewall && !sd.options && rulesIdle(sd)

function withScope(draft: FirewallDraft, sd: ScopeDraft, seq = draft.seq): FirewallDraft {
  const key = scopeKey(sd.scope)
  const scopes = { ...draft.scopes }
  if (isIdle(sd)) delete scopes[key]
  else scopes[key] = sd
  return { scopes, seq }
}

export const scopeDraftOf = (draft: FirewallDraft, scope: DraftScope): ScopeDraft | undefined => draft.scopes[scopeKey(scope)]

/** The list the user sees for a scope: the draft's when its rules were edited, the list read otherwise. */
export function currentEntries(draft: FirewallDraft, scope: DraftScope, baseRules: RuleLike[] | null): DraftEntry[] {
  return scopeDraftOf(draft, scope)?.rules ?? entriesOf(baseRules ?? [])
}

/**
 * Changes the list of a scope; the scope keeps the base its rules were first edited from. Nothing changes while the
 * rules of the scope were never read (`baseRules` null): a draft is only made on a list that was seen.
 */
export function editRules(
  draft: FirewallDraft,
  scope: DraftScope,
  baseRules: RuleLike[] | null,
  change: (rules: DraftEntry[], newId: () => string) => DraftEntry[],
): FirewallDraft {
  const sd = scopeDraftOf(draft, scope) ?? emptyScope(scope)
  let base = sd.base
  let rules = sd.rules
  let baseDigest = sd.baseDigest
  if (!base || !rules) {
    if (!baseRules) return draft
    base = entriesOf(baseRules)
    rules = base
    baseDigest = baseDigestOf(baseRules)
  }
  let seq = draft.seq
  const newId = () => `n${++seq}`
  return withScope(draft, { ...sd, base, baseDigest, rules: change(rules, newId) }, seq)
}

/** Rules owned by the engine (its marker in the comment) are never edited, moved or deleted from the draft. */
const editable = (e: DraftEntry) => !isEngineComment(e.rule.comment)

/**
 * Where the user's rules may go in a list holding the engine's: after its leading rules (the zone group on top of a
 * guest) and before its trailing ones (the final observe rule), as insertion indexes [lo, hi].
 */
export function userRange(rules: DraftEntry[]): [number, number] {
  let lo = 0
  while (lo < rules.length && !editable(rules[lo])) lo++
  let hi = rules.length
  while (hi > lo && !editable(rules[hi - 1])) hi--
  return [lo, hi]
}

/** The insertion indexes around position `at` that cross no rule of the engine (the segment it sits in). */
function segmentAround(rules: DraftEntry[], at: number): [number, number] {
  let lo = at
  while (lo > 0 && editable(rules[lo - 1])) lo--
  let hi = at
  while (hi < rules.length && editable(rules[hi])) hi++
  return [lo, hi]
}

const clamp = (value: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(value, hi))

/** Adds a rule at `index`, at the end of the user's rules by default; never among the engine's leading or trailing rules. */
export const addRule = (draft: FirewallDraft, scope: DraftScope, baseRules: RuleLike[] | null, rule: RuleFields, index?: number) =>
  editRules(draft, scope, baseRules, (rules, newId) => {
    const range = userRange(rules)
    const next = [...rules]
    next.splice(clamp(index ?? range[1], range), 0, { id: newId(), rule })
    return next
  })

export const updateRules = (draft: FirewallDraft, scope: DraftScope, baseRules: RuleLike[] | null, ids: string[], patch: Partial<RuleFields>) =>
  editRules(draft, scope, baseRules, rules => rules.map(e => (ids.includes(e.id) && editable(e) ? { ...e, rule: { ...e.rule, ...patch } } : e)))

export const removeRules = (draft: FirewallDraft, scope: DraftScope, baseRules: RuleLike[] | null, ids: string[]) =>
  editRules(draft, scope, baseRules, rules => rules.filter(e => !ids.includes(e.id) || !editable(e)))

/** Puts one rule at `toIndex` of its list (the index it will have once moved), never across a rule of the engine. */
export const moveRule = (draft: FirewallDraft, scope: DraftScope, baseRules: RuleLike[] | null, id: string, toIndex: number) =>
  editRules(draft, scope, baseRules, rules => {
    const from = rules.findIndex(e => e.id === id)
    if (from < 0 || !editable(rules[from])) return rules
    const next = [...rules]
    const [moved] = next.splice(from, 1)
    next.splice(clamp(toIndex, segmentAround(next, from)), 0, moved)
    return next
  })

/** Moves the selected rules one place up (-1) or down (1), as a block; a rule at the edge stays. */
export const shiftRules = (draft: FirewallDraft, scope: DraftScope, baseRules: RuleLike[] | null, ids: string[], delta: -1 | 1) =>
  editRules(draft, scope, baseRules, rules => {
    const next = [...rules]
    const order = delta < 0 ? next.map((_, i) => i) : next.map((_, i) => next.length - 1 - i)
    for (const i of order) {
      const j = i + delta
      const movable = ids.includes(next[i].id) && editable(next[i]) && j >= 0 && j < next.length && !ids.includes(next[j].id) && editable(next[j])
      if (movable) {
        const held = next[i]
        next[i] = next[j]
        next[j] = held
      }
    }
    return next
  })

/** A copy of each selected rule, right below it. */
export const cloneRules = (draft: FirewallDraft, scope: DraftScope, baseRules: RuleLike[] | null, ids: string[]) =>
  editRules(draft, scope, baseRules, (rules, newId) =>
    rules.flatMap(e => (ids.includes(e.id) && editable(e) ? [e, { id: newId(), rule: { ...e.rule } }] : [e])))

/** Moves rules to the end of another scope's list: deleted here, created there. */
export function moveRulesToScope(
  draft: FirewallDraft,
  from: { scope: DraftScope; baseRules: RuleLike[] | null },
  ids: string[],
  to: { scope: DraftScope; baseRules: RuleLike[] | null },
): FirewallDraft {
  if (scopeKey(from.scope) === scopeKey(to.scope)) return draft
  const moving = currentEntries(draft, from.scope, from.baseRules).filter(e => ids.includes(e.id) && editable(e))
  if (moving.length === 0) return draft
  const removed = removeRules(draft, from.scope, from.baseRules, moving.map(e => e.id))
  return editRules(removed, to.scope, to.baseRules, (rules, newId) => {
    const at = userRange(rules)[1]
    return [...rules.slice(0, at), ...moving.map(e => ({ id: newId(), rule: { ...e.rule } })), ...rules.slice(at)]
  })
}

/** Sets options of a scope; a value equal to the one read is no change. */
export function setScopeOptions(draft: FirewallDraft, scope: DraftScope, current: ScopeOptions | null, patch: ScopeOptions): FirewallDraft {
  const sd = scopeDraftOf(draft, scope) ?? emptyScope(scope)
  const merged: Record<string, string | number> = { ...sd.options, ...patch }
  for (const [key, value] of Object.entries(merged)) {
    if (value === undefined || current?.[key as keyof ScopeOptions] === value) delete merged[key]
  }
  const options = Object.keys(merged).length > 0 ? (merged as ScopeOptions) : undefined
  return withScope(draft, { ...sd, options })
}

/** Turns the guest firewall on at publish (its options, then the flag on every NIC). */
export function enableGuestFirewall(draft: FirewallDraft, scope: DraftScope, on = true): FirewallDraft {
  const sd = scopeDraftOf(draft, scope) ?? emptyScope(scope)
  return withScope(draft, { ...sd, enableFirewall: on || undefined })
}

export function discardScope(draft: FirewallDraft, scope: DraftScope): FirewallDraft {
  const scopes = { ...draft.scopes }
  delete scopes[scopeKey(scope)]
  return { scopes, seq: draft.seq }
}

// ---- the operations ------------------------------------------------------------------------------------------------

/** The list of a scope after an operation: what a partial publish leaves on the server. */
export type SimState = { key: string; ids: string[]; fields: Record<string, RuleFields>; options: boolean; enable: boolean }

export type DerivedOps = { ops: PublishOp[]; states: SimState[]; digests: Record<string, string> }

/** Ids of the longest increasing run of `positions` (by value): the rules that keep their place. */
function stableIds(ids: string[], positions: number[]): Set<string> {
  const tails: number[] = []
  const prev: number[] = Array.from({ length: positions.length }, () => -1)
  for (let i = 0; i < positions.length; i++) {
    let lo = 0
    let hi = tails.length
    while (lo < hi) {
      const mid = (lo + hi) >> 1
      if (positions[tails[mid]] < positions[i]) lo = mid + 1
      else hi = mid
    }
    prev[i] = lo > 0 ? tails[lo - 1] : -1
    tails[lo] = i
  }
  const keep = new Set<string>()
  for (let i = tails.length > 0 ? tails.at(-1)! : -1; i >= 0; i = prev[i]) keep.add(ids[i])
  return keep
}

class ScopeSim {
  readonly ops: PublishOp[] = []
  readonly states: SimState[] = []
  cur: string[]
  fields: Record<string, RuleFields>
  options = false
  enable = false

  constructor(readonly sd: ScopeDraft, readonly key: string) {
    this.cur = (sd.base ?? []).map(e => e.id)
    this.fields = Object.fromEntries((sd.base ?? []).map(e => [e.id, e.rule]))
  }

  /** What the server must find at the position of a rule before writing it. */
  private expectOf(id: string): RuleExpect {
    const f = this.fields[id]
    return Object.fromEntries(EXPECT_FIELDS.map(k => [k, f[k]])) as RuleExpect
  }

  push(op: PublishOp) {
    this.ops.push(op)
    this.states.push({ key: this.key, ids: [...this.cur], fields: { ...this.fields }, options: this.options, enable: this.enable })
  }

  deletes(wanted: Set<string>) {
    for (let i = this.cur.length - 1; i >= 0; i--) {
      const id = this.cur[i]
      if (wanted.has(id)) continue
      const expect = this.expectOf(id)
      this.cur.splice(i, 1)
      delete this.fields[id]
      this.push({ kind: 'rule.delete', scope: this.sd.scope, pos: i, expect, ref: id })
    }
  }

  edits() {
    const desired = new Map((this.sd.rules ?? []).map(e => [e.id, e.rule]))
    this.cur.forEach((id, pos) => {
      const patch = diffFields(this.fields[id], desired.get(id)!)
      if (!patch) return
      const expect = this.expectOf(id)
      this.fields[id] = desired.get(id)!
      this.push({ kind: 'rule.edit', scope: this.sd.scope, pos, patch, expect, ref: id })
    })
  }

  order() {
    const rules = this.sd.rules ?? []
    const kept = rules.filter(e => e.id in this.fields)
    const stable = stableIds(kept.map(e => e.id), kept.map(e => this.cur.indexOf(e.id)))
    // The engine's rules never move: they are placed whatever the longest run says.
    for (const e of kept) if (!editable(e)) stable.add(e.id)
    let previous: string | null = null
    for (const e of rules) {
      if (!stable.has(e.id)) this.place(e, previous === null ? 0 : this.cur.indexOf(previous) + 1)
      previous = e.id
      stable.add(e.id)
    }
  }

  /** Puts a rule right after the previous one placed (at `target` of the list as it is now). */
  private place(e: DraftEntry, target: number) {
    const from = this.cur.indexOf(e.id)
    if (from < 0) {
      this.cur.splice(target, 0, e.id)
      this.fields[e.id] = e.rule
      this.push({ kind: 'rule.add', scope: this.sd.scope, rule: e.rule, index: target, ref: e.id })
      return
    }
    const to = from < target ? target - 1 : target
    if (to === from) return
    const expect = this.expectOf(e.id)
    this.cur.splice(from, 1)
    this.cur.splice(to, 0, e.id)
    this.push({ kind: 'rule.move', scope: this.sd.scope, pos: from, to, expect, ref: e.id })
  }

  settings() {
    if (this.sd.options) {
      this.options = true
      this.push({ kind: 'options.set', scope: this.sd.scope, options: this.sd.options })
    }
    if (this.sd.enableFirewall && this.sd.scope.kind === 'guest') {
      this.enable = true
      this.push({ kind: 'guest.enable', scope: this.sd.scope })
    }
  }
}

/** The operations of one scope, in the order the server applies them: deletes, edits, creations and moves, options. */
export function deriveScopeOps(sd: ScopeDraft): { ops: PublishOp[]; states: SimState[] } {
  const sim = new ScopeSim(sd, scopeKey(sd.scope))
  if (sd.rules && sd.base) {
    sim.deletes(new Set(sd.rules.map(e => e.id)))
    sim.edits()
    sim.order()
  }
  // Rules first, then the options and the firewall switch: a guest turned on at DROP already has its rules.
  sim.settings()
  return { ops: sim.ops, states: sim.states }
}

/** Every operation of the draft, scope after scope, with the digests the server checks before the first write. */
export function deriveOps(draft: FirewallDraft): DerivedOps {
  const out: DerivedOps = { ops: [], states: [], digests: {} }
  for (const [key, sd] of Object.entries(draft.scopes)) {
    const { ops, states } = deriveScopeOps(sd)
    if (ops.length === 0) continue
    out.ops.push(...ops)
    out.states.push(...states)
    if (ops.some(op => op.kind.startsWith('rule.'))) out.digests[key] = sd.baseDigest
  }
  return out
}

/** The operations a scope (or the whole draft) would publish. */
export function pendingCount(draft: FirewallDraft, scope?: DraftScope): number {
  if (!scope) return deriveOps(draft).ops.length
  const sd = scopeDraftOf(draft, scope)
  return sd ? deriveScopeOps(sd).ops.length : 0
}

/** What a rule of the list shows: added in the draft, changed, or moved (dragged or pushed by the selection). */
export type EntryState = 'added' | 'edited' | 'moved' | null

export function entryStates(sd: ScopeDraft | undefined): Map<string, EntryState> {
  const out = new Map<string, EntryState>()
  if (!sd) return out
  for (const op of deriveScopeOps(sd).ops) {
    if (!('ref' in op) || !op.ref) continue
    if (op.kind === 'rule.add') out.set(op.ref, 'added')
    else if (op.kind === 'rule.edit') out.set(op.ref, 'edited')
    else if (op.kind === 'rule.move' && !out.has(op.ref)) out.set(op.ref, 'moved')
  }
  return out
}

/**
 * The draft after a publish that stopped at operation `applied` (0-based count of those applied). A scope whose
 * operations all went through leaves the draft; a scope the publish did not reach stays as it was; the scope it
 * stopped in starts again from the list the applied operations left, with the digest the server read after them,
 * and keeps the rest of its changes.
 */
export function rebaseDraft(draft: FirewallDraft, sent: DerivedOps, applied: number, digests: Record<string, string>): FirewallDraft {
  const scopes = { ...draft.scopes }
  const lastApplied = new Map<string, SimState>()
  const touched = new Set<string>()
  sent.states.forEach((state, i) => {
    touched.add(state.key)
    if (i < applied) lastApplied.set(state.key, state)
  })
  for (const key of touched) {
    const sd = scopes[key]
    const state = lastApplied.get(key)
    if (!sd || !state) continue
    const remaining = sent.states.slice(applied).some(s => s.key === key)
    if (!remaining) {
      delete scopes[key]
      continue
    }
    const base = sd.base ? state.ids.map(id => ({ id, rule: state.fields[id] })) : null
    scopes[key] = {
      ...sd,
      base,
      baseDigest: digests[key] ?? sd.baseDigest,
      options: state.options ? undefined : sd.options,
      enableFirewall: state.enable ? undefined : sd.enableFirewall,
    }
  }
  return { scopes, seq: draft.seq }
}

// ---- storage -------------------------------------------------------------------------------------------------------

const isEntryList = (v: unknown): v is DraftEntry[] | null =>
  v === null || (Array.isArray(v) && v.every(e => !!e && typeof e.id === 'string' && !!e.rule && typeof e.rule.type === 'string' && typeof e.rule.action === 'string'))

/** A draft read back from the browser's storage, or the empty draft when it is not one. */
export function parseStoredDraft(text: string | null): FirewallDraft {
  if (!text) return EMPTY_DRAFT
  try {
    const raw = JSON.parse(text) as { v?: number; draft?: FirewallDraft }
    const d = raw?.draft
    if (raw?.v !== 1 || !d || typeof d.seq !== 'number' || !d.scopes || typeof d.scopes !== 'object') return EMPTY_DRAFT
    const scopes: Record<string, ScopeDraft> = {}
    for (const [key, sd] of Object.entries(d.scopes)) {
      if (sd?.scope && scopeKey(sd.scope) === key && typeof sd.baseDigest === 'string' && isEntryList(sd.base) && isEntryList(sd.rules)) scopes[key] = sd
    }
    return { scopes, seq: d.seq }
  } catch {
    return EMPTY_DRAFT
  }
}

export const serializeDraft = (draft: FirewallDraft): string => JSON.stringify({ v: 1, draft })
