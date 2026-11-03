// src/lib/firewall/publishOps.ts
//
// The operations of a Firewalling publish (UA51), shared by the browser that derives them from its draft
// (lib/firewall/draft.ts) and the route that applies them (lib/firewall/publish.ts). A scope is one rule list of
// Proxmox: the cluster's, a host's or a guest's. The micro-segmentation zone groups (pcz-*) are never a scope here:
// the engine owns them.

export type GuestType = 'qemu' | 'lxc'

export type DraftScope =
  | { kind: 'cluster' }
  | { kind: 'host'; node: string }
  | { kind: 'guest'; node: string; vmType: GuestType; vmid: number }

/** The fields of a rule a publish writes (Proxmox's, without `pos` and `digest`). */
export type RuleFields = {
  type: string
  action: string
  enable: number
  source: string
  dest: string
  proto: string
  dport: string
  sport: string
  macro: string
  iface: string
  log: string
  comment: string
}

export const RULE_TEXT_FIELDS = ['source', 'dest', 'proto', 'dport', 'sport', 'macro', 'iface', 'log', 'comment'] as const

export type ScopeOptions = {
  enable?: number
  policy_in?: string
  policy_out?: string
  log_level_in?: string
  log_level_out?: string
}

/**
 * One write (or a short fixed sequence) on one scope. Positions are those of the list as the previous operations of
 * the publish left it: the browser derives them by applying the operations in order, the server applies them in the
 * same order. `ref` is the browser's id of the rule, ignored by the server.
 */
export type PublishOp =
  | { kind: 'rule.add'; scope: DraftScope; rule: RuleFields; index: number; ref?: string }
  | { kind: 'rule.edit'; scope: DraftScope; pos: number; patch: Partial<RuleFields>; ref?: string }
  | { kind: 'rule.delete'; scope: DraftScope; pos: number; ref?: string }
  | { kind: 'rule.move'; scope: DraftScope; pos: number; to: number; ref?: string }
  | { kind: 'options.set'; scope: DraftScope; options: ScopeOptions }
  | { kind: 'guest.enable'; scope: Extract<DraftScope, { kind: 'guest' }> }

export type PublishOpKind = PublishOp['kind']

export type PublishBody = {
  ops: PublishOp[]
  /** The digest of each scope's rule list (key scopeKey) and options (key `${scopeKey}#options`) as the draft read it. */
  digests: Record<string, string>
  /** Set once the user confirmed a publish of more than PUBLISH_CONFIRM_ABOVE operations. */
  confirmed?: boolean
}

/** A publish of more operations than this asks a confirmation stating the count. */
export const PUBLISH_CONFIRM_ABOVE = 50
/** At most this many operations in one publish: each is up to four Proxmox calls, the route must answer within 60 s. */
export const PUBLISH_MAX_OPS = 100

export type PublishFailureCode = 'DIGEST_CONFLICT' | 'MANAGED_RULE' | 'STALE_POSITION' | 'NOT_OURS' | 'TIME_BUDGET' | 'PVE_ERROR'

export type PublishResult = {
  /** Operations applied, from the first: the remaining ones were not sent. */
  applied: number
  total: number
  /** Each scope written: the digest and the rule list read after its last write. */
  scopes: Record<string, { digest: string; rules?: unknown[] }>
  failed?: { index: number; kind: PublishOpKind; scope: string; code: PublishFailureCode; message: string }
}

/** The engine's marker: a rule whose comment starts with it belongs to the micro-segmentation (Go: microseg.Marker). */
export const ENGINE_MARKER = '[pc-microseg]'

export const isEngineComment = (comment: unknown): boolean => typeof comment === 'string' && comment.startsWith(ENGINE_MARKER)

export function scopeKey(scope: DraftScope): string {
  if (scope.kind === 'cluster') return 'cluster'
  if (scope.kind === 'host') return `host:${scope.node}`
  return `guest:${scope.vmType}/${scope.vmid}`
}

export const optionsKey = (scope: DraftScope): string => `${scopeKey(scope)}#options`

export function rulesPath(scope: DraftScope): string {
  if (scope.kind === 'cluster') return '/cluster/firewall/rules'
  if (scope.kind === 'host') return `/nodes/${encodeURIComponent(scope.node)}/firewall/rules`
  return `/nodes/${encodeURIComponent(scope.node)}/${scope.vmType}/${scope.vmid}/firewall/rules`
}

export function optionsPath(scope: DraftScope): string {
  if (scope.kind === 'cluster') return '/cluster/firewall/options'
  if (scope.kind === 'host') return `/nodes/${encodeURIComponent(scope.node)}/firewall/options`
  return `/nodes/${encodeURIComponent(scope.node)}/${scope.vmType}/${scope.vmid}/firewall/options`
}

export const configPath = (scope: Extract<DraftScope, { kind: 'guest' }>): string =>
  `/nodes/${encodeURIComponent(scope.node)}/${scope.vmType}/${scope.vmid}/config`

// ---- validation of a body ------------------------------------------------------------------------------------------

const NODE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/
const ACTIONS = new Set(['ACCEPT', 'DROP', 'REJECT'])
const GROUP_RE = /^[A-Za-z][A-Za-z0-9_-]{1,31}$/
const POLICIES = ACTIONS
const LOG_LEVELS = new Set(['emerg', 'alert', 'crit', 'err', 'warning', 'notice', 'info', 'debug', 'nolog'])
const MAX_FIELD = 512
const MAX_INDEX = 10_000

type Fail = { ok: false; error: string }
export type Parsed<T> = { ok: true; value: T } | Fail

const fail = (error: string): Fail => ({ ok: false, error })

/** A failed parse (a type guard: the project compiles without strictNullChecks, where `!p.ok` does not narrow). */
export const isFail = <T>(p: Parsed<T>): p is Fail => !p.ok

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

const isIndex = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= MAX_INDEX

const isText = (v: unknown): v is string => typeof v === 'string' && v.length <= MAX_FIELD && !/[\r\n\0]/.test(v)

function parseScope(raw: unknown): Parsed<DraftScope> {
  if (!isRecord(raw)) return fail('scope must be an object')
  if (raw.kind === 'cluster') return { ok: true, value: { kind: 'cluster' } }
  if (typeof raw.node !== 'string' || !NODE_RE.test(raw.node)) return fail('scope.node is not a node name')
  if (raw.kind === 'host') return { ok: true, value: { kind: 'host', node: raw.node } }
  if (raw.kind !== 'guest') return fail('scope.kind must be cluster, host or guest')
  if (raw.vmType !== 'qemu' && raw.vmType !== 'lxc') return fail('scope.vmType must be qemu or lxc')
  if (!Number.isInteger(raw.vmid) || (raw.vmid as number) < 100 || (raw.vmid as number) > 999_999_999) return fail('scope.vmid is not a guest id')
  return { ok: true, value: { kind: 'guest', node: raw.node, vmType: raw.vmType, vmid: raw.vmid as number } }
}

function checkTypeAction(type: unknown, action: unknown): string | null {
  if (type !== 'in' && type !== 'out' && type !== 'group') return 'rule.type must be in, out or group'
  if (typeof action !== 'string') return 'rule.action is missing'
  if (type === 'group') return GROUP_RE.test(action) ? null : 'rule.action is not a security group name'
  return ACTIONS.has(action) ? null : 'rule.action must be ACCEPT, DROP or REJECT'
}

/** The fields of a rule (all of them for an add, those present for an edit); null when one is not acceptable. */
function parseRuleFields(raw: unknown, partial: boolean): Parsed<Partial<RuleFields>> {
  if (!isRecord(raw)) return fail('rule must be an object')
  const out: Partial<RuleFields> = {}
  // An edit sends the type and the action together, or neither: one alone could not be checked against the other.
  if (!partial || raw.type !== undefined || raw.action !== undefined) {
    const error = checkTypeAction(raw.type, raw.action)
    if (error) return fail(error)
    out.type = raw.type as string
    out.action = raw.action as string
  }
  if (raw.enable !== undefined) {
    if (raw.enable !== 0 && raw.enable !== 1) return fail('rule.enable must be 0 or 1')
    out.enable = raw.enable
  } else if (!partial) out.enable = 1
  for (const key of RULE_TEXT_FIELDS) {
    const value = raw[key]
    if (value === undefined) {
      if (!partial) out[key] = ''
      continue
    }
    if (!isText(value)) return fail(`rule.${key} is not acceptable`)
    out[key] = value
  }
  if (out.log && !LOG_LEVELS.has(out.log)) return fail('rule.log is not a log level')
  if (isEngineComment(out.comment)) return fail('a rule marked for the micro-segmentation engine cannot be written here')
  return { ok: true, value: out }
}

function parseOptions(raw: unknown): Parsed<ScopeOptions> {
  if (!isRecord(raw)) return fail('options must be an object')
  const out: ScopeOptions = {}
  if (raw.enable !== undefined) {
    if (raw.enable !== 0 && raw.enable !== 1) return fail('options.enable must be 0 or 1')
    out.enable = raw.enable
  }
  for (const key of ['policy_in', 'policy_out'] as const) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'string' || !POLICIES.has(raw[key] as string)) return fail(`options.${key} must be ACCEPT, DROP or REJECT`)
    out[key] = raw[key] as string
  }
  for (const key of ['log_level_in', 'log_level_out'] as const) {
    if (raw[key] === undefined) continue
    if (typeof raw[key] !== 'string' || !LOG_LEVELS.has(raw[key] as string)) return fail(`options.${key} is not a log level`)
    out[key] = raw[key] as string
  }
  if (Object.keys(out).length === 0) return fail('options is empty')
  return { ok: true, value: out }
}

const refOf = (raw: Record<string, unknown>) => (typeof raw.ref === 'string' && raw.ref.length <= 64 ? { ref: raw.ref } : {})

function parseRuleOp(raw: Record<string, unknown>, scope: DraftScope): Parsed<PublishOp> {
  const ref = refOf(raw)
  if (raw.kind === 'rule.add') {
    if (!isIndex(raw.index)) return fail('rule.add needs an index')
    const rule = parseRuleFields(raw.rule, false)
    if (isFail(rule)) return rule
    return { ok: true, value: { kind: 'rule.add', scope, rule: rule.value as RuleFields, index: raw.index, ...ref } }
  }
  if (!isIndex(raw.pos)) return fail(`${String(raw.kind)} needs a pos`)
  if (raw.kind === 'rule.delete') return { ok: true, value: { kind: 'rule.delete', scope, pos: raw.pos, ...ref } }
  if (raw.kind === 'rule.move') {
    if (!isIndex(raw.to) || raw.to === raw.pos) return fail('rule.move needs another position to go to')
    return { ok: true, value: { kind: 'rule.move', scope, pos: raw.pos, to: raw.to, ...ref } }
  }
  const patch = parseRuleFields(raw.patch, true)
  if (isFail(patch)) return patch
  if (Object.keys(patch.value).length === 0) return fail('rule.edit has nothing to change')
  return { ok: true, value: { kind: 'rule.edit', scope, pos: raw.pos, patch: patch.value, ...ref } }
}

function parseOp(raw: unknown): Parsed<PublishOp> {
  if (!isRecord(raw)) return fail('an operation must be an object')
  const scope = parseScope(raw.scope)
  if (isFail(scope)) return scope
  switch (raw.kind) {
    case 'rule.add':
    case 'rule.edit':
    case 'rule.delete':
    case 'rule.move':
      return parseRuleOp(raw, scope.value)
    case 'options.set': {
      const options = parseOptions(raw.options)
      return isFail(options) ? options : { ok: true, value: { kind: 'options.set', scope: scope.value, options: options.value } }
    }
    case 'guest.enable':
      return scope.value.kind === 'guest'
        ? { ok: true, value: { kind: 'guest.enable', scope: scope.value } }
        : fail('guest.enable applies to a guest')
    default:
      return fail('unknown operation kind')
  }
}

/** The body of POST /api/v1/firewall/publish/[connectionId], checked field by field. */
export function parsePublishBody(raw: unknown): Parsed<PublishBody> {
  if (!isRecord(raw) || !Array.isArray(raw.ops)) return fail('ops must be a list')
  if (raw.ops.length === 0) return fail('nothing to publish')
  if (raw.ops.length > PUBLISH_MAX_OPS) return fail(`at most ${PUBLISH_MAX_OPS} operations per publish`)
  const ops: PublishOp[] = []
  for (const [i, item] of raw.ops.entries()) {
    const op = parseOp(item)
    if (isFail(op)) return fail(`operation ${i + 1}: ${op.error}`)
    ops.push(op.value)
  }
  const digests: Record<string, string> = {}
  if (raw.digests !== undefined) {
    if (!isRecord(raw.digests)) return fail('digests must be an object')
    for (const [key, value] of Object.entries(raw.digests)) {
      if (typeof value !== 'string' || value.length > 128 || key.length > 128) return fail('digests holds a value that is not a digest')
      digests[key] = value
    }
  }
  return { ok: true, value: { ops, digests, confirmed: raw.confirmed === true } }
}
