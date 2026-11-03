// src/lib/firewall/publish.ts
//
// Applies the operations of a Firewalling publish (UA51) to Proxmox, one after the other, never two at once, as the
// micro-segmentation engine applies a plan (proxcenter-backend internal/microseg/plan.go, engine_exec.go):
//  - before the first write on a rule list, the list is read and its digest compared with the one the draft was made
//    on: another hand changed it meanwhile, the publish stops with DIGEST_CONFLICT before writing anything there;
//  - every PUT and DELETE carries the digest (Proxmox refuses it when the list moved since), and the list is read
//    again after each write: the next operation on that list uses that digest and sees the positions as they are;
//  - a creation lands at the top (Proxmox ignores `pos` on a POST): a rule wanted lower is then moved, PUT <list>/0
//    moveto=index+1, only when the rule on top is the one just created (Go: firewall.addRuleAt);
//  - a rule carrying the engine's marker is never edited, moved or deleted;
//  - the first failure stops the publish: what was applied, the operation that failed and Proxmox's message come
//    back, the remaining operations are not sent.
// Load: one write per operation (two for a creation lower than the top, up to two for a guest switched on), one read
// after each rule write, one read of each list and options before its first write. Nothing runs in parallel, and no
// operation starts once `budgetMs` is spent (nginx cuts an API route at 60 s).

import type { DraftScope, PublishFailureCode, PublishOp, PublishResult, RuleFields, ScopeOptions } from './publishOps'
import { RULE_TEXT_FIELDS, configPath, isEngineComment, optionsKey, optionsPath, rulesPath, scopeKey } from './publishOps'

/** What the executor needs from Proxmox: a read, and a write that sends `form` (urlencoded) or nothing. */
export type PublishIO = {
  get: <T>(path: string) => Promise<T>
  write: (method: 'POST' | 'PUT' | 'DELETE', path: string, form?: URLSearchParams) => Promise<void>
  /** A guest's options or NICs were written: the firewall coverage cache must not keep what it read before. */
  guestWritten?: (scope: Extract<DraftScope, { kind: 'guest' }>, what: 'options' | 'nic') => void
}

export const PUBLISH_BUDGET_MS = 45_000

type Rule = Partial<RuleFields> & { pos?: number; digest?: string }

class PublishError extends Error {
  constructor(readonly code: PublishFailureCode, message: string) {
    super(message)
  }
}

const DIGEST_MESSAGES = ['detected modified configuration', 'file changed by other user']

function classify(err: unknown): PublishError {
  if (err instanceof PublishError) return err
  const message = err instanceof Error ? err.message : String(err)
  const lower = message.toLowerCase()
  const code: PublishFailureCode = DIGEST_MESSAGES.some(s => lower.includes(s)) ? 'DIGEST_CONFLICT' : 'PVE_ERROR'
  return new PublishError(code, message.slice(0, 500))
}

function createForm(rule: RuleFields): URLSearchParams {
  const form = new URLSearchParams()
  form.set('type', rule.type)
  form.set('action', rule.action)
  form.set('enable', String(rule.enable))
  for (const key of RULE_TEXT_FIELDS) {
    if (rule[key] && !(key === 'log' && rule[key] === 'nolog')) form.set(key, rule[key])
  }
  return form
}

/** An edit: the fields given, an emptied one through `delete` (Proxmox keeps a field a PUT leaves out, #1115). */
function editForm(patch: Partial<RuleFields>, digest: string): URLSearchParams {
  const form = new URLSearchParams()
  if (patch.type !== undefined) form.set('type', patch.type)
  if (patch.action !== undefined) form.set('action', patch.action)
  if (patch.enable !== undefined) form.set('enable', String(patch.enable))
  const cleared: string[] = []
  for (const key of RULE_TEXT_FIELDS) {
    const value = patch[key]
    if (value === undefined) continue
    if (value === '') cleared.push(key)
    else form.set(key, value)
  }
  if (cleared.length > 0) form.set('delete', cleared.join(','))
  if (digest) form.set('digest', digest)
  return form
}

function optionsForm(options: ScopeOptions, digest: string): URLSearchParams {
  const form = new URLSearchParams()
  for (const [key, value] of Object.entries(options)) {
    if (value !== undefined) form.set(key, String(value))
  }
  if (digest) form.set('digest', digest)
  return form
}

const withDigest = (path: string, digest: string) => (digest ? `${path}?digest=${encodeURIComponent(digest)}` : path)

/** NIC keys of a guest config whose firewall flag is not on, with the value to write. */
function nicsToArm(config: Record<string, unknown>): [string, string][] {
  const out: [string, string][] = []
  for (let i = 0; i < 32; i++) {
    const value = config[`net${i}`]
    if (typeof value !== 'string') continue
    const parts = value.split(',')
    const at = parts.findIndex(p => p.startsWith('firewall='))
    if (at >= 0 && parts[at] === 'firewall=1') continue
    if (at >= 0) parts[at] = 'firewall=1'
    else parts.push('firewall=1')
    out.push([`net${i}`, parts.join(',')])
  }
  return out
}

class Executor {
  private readonly lists = new Map<string, Rule[]>()
  private readonly digest = new Map<string, string>()
  readonly scopes: PublishResult['scopes'] = {}

  constructor(private readonly io: PublishIO, private readonly expected: Record<string, string>) {}

  private async read(scope: DraftScope): Promise<Rule[]> {
    const key = scopeKey(scope)
    const list = (await this.io.get<Rule[] | null>(rulesPath(scope))) ?? []
    const digest = list.find(r => typeof r.digest === 'string')?.digest ?? ''
    this.lists.set(key, list)
    this.digest.set(key, digest)
    this.scopes[key] = { digest, rules: list }
    return list
  }

  /** The list before the first write on it, checked against the digest the draft was made on. */
  private async list(scope: DraftScope): Promise<Rule[]> {
    const key = scopeKey(scope)
    const known = this.lists.get(key)
    if (known) return known
    const list = await this.read(scope)
    const expected = this.expected[key]
    if (expected !== undefined && expected !== this.digest.get(key)) {
      throw new PublishError('DIGEST_CONFLICT', 'The rules of this scope were changed in Proxmox since they were read: refresh, then publish again')
    }
    return list
  }

  private async target(scope: DraftScope, pos: number): Promise<Rule> {
    const rule = (await this.list(scope))[pos]
    if (!rule) throw new PublishError('STALE_POSITION', `There is no rule at position ${pos} any more`)
    if (isEngineComment(rule.comment)) throw new PublishError('MANAGED_RULE', 'This rule belongs to the micro-segmentation engine')
    return rule
  }

  async run(op: PublishOp): Promise<void> {
    switch (op.kind) {
      case 'rule.add':
        return this.add(op.scope, op.rule, op.index)
      case 'rule.edit':
        await this.target(op.scope, op.pos)
        await this.io.write('PUT', `${rulesPath(op.scope)}/${op.pos}`, editForm(op.patch, this.digest.get(scopeKey(op.scope)) ?? ''))
        await this.read(op.scope)
        return
      case 'rule.delete':
        await this.target(op.scope, op.pos)
        await this.io.write('DELETE', withDigest(`${rulesPath(op.scope)}/${op.pos}`, this.digest.get(scopeKey(op.scope)) ?? ''))
        await this.read(op.scope)
        return
      case 'rule.move':
        await this.target(op.scope, op.pos)
        await this.moveTo(op.scope, op.pos, op.to)
        await this.read(op.scope)
        return
      case 'options.set':
        return this.setOptions(op.scope, op.options)
      case 'guest.enable':
        return this.enableGuest(op.scope)
    }
  }

  /** Proxmox's moveto names the rule the moved one goes before, in the list that still holds it. */
  private async moveTo(scope: DraftScope, pos: number, to: number) {
    const moveto = to > pos ? to + 1 : to
    const form = new URLSearchParams({ moveto: String(moveto) })
    const digest = this.digest.get(scopeKey(scope)) ?? ''
    if (digest) form.set('digest', digest)
    await this.io.write('PUT', `${rulesPath(scope)}/${pos}`, form)
  }

  private async add(scope: DraftScope, rule: RuleFields, index: number) {
    await this.list(scope)
    await this.io.write('POST', rulesPath(scope), createForm(rule))
    const after = await this.read(scope)
    if (index <= 0) return
    const top = after[0]
    if (!top || top.type !== rule.type || top.action !== rule.action || (top.comment ?? '') !== rule.comment) {
      throw new PublishError('NOT_OURS', `Rule created at the top, not moved to position ${index}: the rule at the top is not the one just created`)
    }
    await this.moveTo(scope, 0, index)
    await this.read(scope)
  }

  /** Options are read once for their digest, then written with it (a draft holds one options change per scope). */
  private async setOptions(scope: DraftScope, options: ScopeOptions) {
    const key = optionsKey(scope)
    const current = await this.io.get<{ digest?: string } | null>(optionsPath(scope))
    const digest = current?.digest ?? ''
    const expected = this.expected[key]
    if (expected !== undefined && expected !== digest) {
      throw new PublishError('DIGEST_CONFLICT', 'The firewall options of this scope were changed in Proxmox since they were read')
    }
    await this.io.write('PUT', optionsPath(scope), optionsForm(options, digest))
    if (scope.kind === 'guest') this.io.guestWritten?.(scope, 'options')
    this.scopes[key] = { digest }
  }

  /** The guest firewall on: its options switch, then firewall=1 on every NIC, each guarded by its digest. */
  private async enableGuest(scope: Extract<DraftScope, { kind: 'guest' }>) {
    const options = await this.io.get<{ enable?: number | string; digest?: string } | null>(optionsPath(scope))
    if (Number(options?.enable) !== 1) {
      await this.io.write('PUT', optionsPath(scope), optionsForm({ enable: 1 }, options?.digest ?? ''))
      this.io.guestWritten?.(scope, 'options')
    }
    const config = (await this.io.get<Record<string, unknown> | null>(configPath(scope))) ?? {}
    const nics = nicsToArm(config)
    if (nics.length === 0) return
    const form = new URLSearchParams(nics)
    if (typeof config.digest === 'string' && config.digest) form.set('digest', config.digest)
    await this.io.write('PUT', configPath(scope), form)
    this.io.guestWritten?.(scope, 'nic')
  }
}

/** Applies `ops` in order and stops at the first failure. Never throws: a failure is in the result. */
export async function executePublish(
  ops: PublishOp[],
  digests: Record<string, string>,
  io: PublishIO,
  opts: { budgetMs?: number; now?: () => number } = {},
): Promise<PublishResult> {
  const now = opts.now ?? Date.now
  const started = now()
  const budget = opts.budgetMs ?? PUBLISH_BUDGET_MS
  const exec = new Executor(io, digests)
  let applied = 0
  for (const [index, op] of ops.entries()) {
    const failedAt = (code: PublishFailureCode, message: string): PublishResult => ({
      applied, total: ops.length, scopes: exec.scopes,
      failed: { index, kind: op.kind, scope: scopeKey(op.scope), code, message },
    })
    if (now() - started > budget) return failedAt('TIME_BUDGET', 'The publish took too long and stopped: publish again for the remaining changes')
    try {
      await exec.run(op)
    } catch (err) {
      const e = classify(err)
      return failedAt(e.code, e.message)
    }
    applied++
  }
  return { applied, total: ops.length, scopes: exec.scopes }
}

/** HTTP status of a publish result. */
export function publishStatus(result: PublishResult): number {
  switch (result.failed?.code) {
    case undefined:
      return 200
    case 'DIGEST_CONFLICT':
    case 'STALE_POSITION':
    case 'NOT_OURS':
    case 'MANAGED_RULE':
      return 409
    case 'TIME_BUDGET':
      return 503
    default:
      return 502
  }
}

/** The audit details of a publish: how many operations of each kind, on how many scopes of each kind. */
export function publishSummary(ops: PublishOp[]): { kinds: Record<string, number>; scopes: Record<string, number> } {
  const kinds: Record<string, number> = {}
  const seen = new Map<string, string>()
  for (const op of ops) {
    kinds[op.kind] = (kinds[op.kind] ?? 0) + 1
    seen.set(scopeKey(op.scope), op.scope.kind)
  }
  const scopes: Record<string, number> = {}
  for (const kind of seen.values()) scopes[kind] = (scopes[kind] ?? 0) + 1
  return { kinds, scopes }
}
