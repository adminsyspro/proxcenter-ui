export interface CrushBucket {
  id: number
  name: string
  type: string
  children: number[]
  deviceClass?: string
}

export interface CrushStep {
  op: string
  num?: number
  type?: string
  item?: string
  deviceClass?: string
}

export interface CrushRule {
  id: number
  name: string
  type: 'replicated' | 'erasure'
  steps: CrushStep[]
}

export type Tolerance = {
  level: 'tolerates' | 'blocks' | 'insufficient' | 'unknown'
  tolerated: number
  domain: string
  domains: number
  needed: number
}

function cleanLine(raw: string): string {
  const i = raw.indexOf('#')

  return (i >= 0 ? raw.slice(0, i) : raw).trim()
}

function parseStep(tokens: string[]): CrushStep | null {
  const [verb, ...rest] = tokens

  if (verb === 'take') {
    const step: CrushStep = { op: 'take', item: rest[0] }
    const ci = rest.indexOf('class')

    if (ci >= 0 && rest[ci + 1]) step.deviceClass = rest[ci + 1]

    return step
  }

  if (verb === 'choose' || verb === 'chooseleaf') {
    // step choose[leaf] firstn|indep <num> type <type>
    const step: CrushStep = { op: `${verb}_${rest[0]}`, num: Number(rest[1]) }
    const ti = rest.indexOf('type')

    if (ti >= 0) step.type = rest[ti + 1]

    return step
  }

  if (verb === 'emit') return { op: 'emit' }
  if (!verb) return null

  const step: CrushStep = { op: verb }

  if (rest[0] !== undefined && Number.isFinite(Number(rest[0]))) step.num = Number(rest[0])

  return step
}

/** Lit le texte décompilé de GET /nodes/{n}/ceph/crush. */
export function parseCrushMap(text: string): { buckets: CrushBucket[]; rules: CrushRule[]; types: string[] } {
  const types: string[] = []
  const buckets: CrushBucket[] = []
  const rules: CrushRule[] = []
  const idByName = new Map<string, number>()
  const pending: { bucket: CrushBucket; items: string[] }[] = []

  let block: { kind: 'bucket' | 'rule'; bucket?: CrushBucket; items: string[]; rule?: CrushRule } | null = null

  for (const raw of text.split(/\r?\n/)) {
    const line = cleanLine(raw)

    if (!line) continue

    const t = line.split(/\s+/)

    if (block) {
      if (line === '}') {
        if (block.kind === 'bucket' && block.bucket) pending.push({ bucket: block.bucket, items: block.items })
        else if (block.rule) rules.push(block.rule)

        block = null
        continue
      }

      if (block.kind === 'bucket' && block.bucket) {
        // les lignes `id -4 class hdd` sont des ids d'ombre : ignorées
        if (t[0] === 'id' && t.length === 2) block.bucket.id = Number(t[1])
        else if (t[0] === 'item') block.items.push(t[1])
      } else if (block.rule) {
        if (t[0] === 'id') block.rule.id = Number(t[1])
        else if (t[0] === 'type') block.rule.type = t[1] === 'erasure' ? 'erasure' : 'replicated'
        else if (t[0] === 'step') {
          const step = parseStep(t.slice(1))

          if (step) block.rule.steps.push(step)
        }
      }

      continue
    }

    if (t[0] === 'type' && t.length === 3) {
      types.push(t[2])
    } else if (t[0] === 'device' && t.length >= 3) {
      const id = Number(t[1])
      const bucket: CrushBucket = { id, name: t[2], type: 'osd', children: [] }
      const ci = t.indexOf('class')

      if (ci >= 0 && t[ci + 1]) bucket.deviceClass = t[ci + 1]

      buckets.push(bucket)
      idByName.set(bucket.name, id)
    } else if (t[0] === 'rule' && t[t.length - 1] === '{') {
      block = { kind: 'rule', items: [], rule: { id: 0, name: t[1], type: 'replicated', steps: [] } }
    } else if (t.length === 3 && t[2] === '{' && types.includes(t[0])) {
      block = { kind: 'bucket', items: [], bucket: { id: 0, name: t[1], type: t[0], children: [] } }
    }
  }

  for (const { bucket } of pending) {
    buckets.push(bucket)
    idByName.set(bucket.name, bucket.id)
  }

  for (const { bucket, items } of pending) {
    bucket.children = items.map(n => idByName.get(n)).filter((id): id is number => id !== undefined)
  }

  return { buckets, rules, types }
}

const CHOOSE_OP = /^choose(leaf)?_(firstn|indep)$/
const isChoose = (s: CrushStep) => CHOOSE_OP.test(s.op)

/** Op de réglage (set_chooseleaf_tries, ...) : sans effet sur le placement. */
const isSetOp = (s: CrushStep) => s.op.startsWith('set_')

/**
 * Forme reconnue : un seul `take` en tête, un seul `emit`, uniquement des
 * choose/chooseleaf (firstn ou indep) et des set_*. Sinon le verdict serait faux.
 */
export function isSupportedRule(rule: Pick<CrushRule, 'steps'>): boolean {
  const takes = rule.steps.filter(s => s.op === 'take').length
  const emits = rule.steps.filter(s => s.op === 'emit').length

  if (takes !== 1 || emits !== 1) return false

  return rule.steps.every(s => s.op === 'take' || s.op === 'emit' || isChoose(s) || isSetOp(s))
}

/** Résout `num` contre size : 0 = size, > 0 = num, < 0 = size + num. */
function resolveNum(num: number | undefined, size: number): number {
  const n = num ?? 0

  if (n > 0) return n
  if (n === 0) return size

  return size + n
}

/**
 * Domaine de panne d'une règle : type du premier `choose*` après le `take`.
 * `perDomain` = produit des `num` résolus (voir resolveNum) des steps
 * choose/chooseleaf qui suivent le premier, borné à size, 1 s'il n'y en a pas.
 * `size` absent (0) : `num 0` ne dit rien sur le nombre de copies et compte
 * pour 1, et un `num` négatif aussi. Sans `choose`, le domaine est `osd`.
 */
export function ruleFailureDomain(
  rule: Pick<CrushRule, 'steps'>,
  size = 0,
): { domain: string; perDomain: number; deviceClass: string | null } {
  const take = rule.steps.find(s => s.op === 'take')
  const deviceClass = take?.deviceClass ?? null
  const idx = rule.steps.findIndex(isChoose)

  if (idx < 0) return { domain: 'osd', perDomain: 1, deviceClass }

  const domain = rule.steps[idx].type || 'osd'
  let perDomain = 1

  for (const step of rule.steps.slice(idx + 1)) {
    if (isChoose(step)) perDomain *= Math.max(1, resolveNum(step.num, size))
  }

  if (size > 0) perDomain = Math.min(perDomain, size)

  return { domain, perDomain, deviceClass }
}

/** Tolérance d'un pool (taille et min_size viennent du pool, pas de la CRUSH map). */
export function poolTolerance(pool: { size: number; minSize: number }, rule: CrushRule, buckets: CrushBucket[]): Tolerance {
  const unknown: Tolerance = { level: 'unknown', tolerated: 0, domain: '', domains: 0, needed: 0 }

  if (!isSupportedRule(rule)) return unknown

  const { domain, perDomain, deviceClass } = ruleFailureDomain(rule, pool.size)
  const byId = new Map(buckets.map(b => [b.id, b]))
  const rootName = rule.steps.find(s => s.op === 'take')?.item
  const root = buckets.find(b => b.name === rootName)

  if (!root) return unknown

  const holdsOsd = (id: number, seen: Set<number>): boolean => {
    if (seen.has(id)) return false

    seen.add(id)

    const b = byId.get(id)

    if (!b) return false
    if (b.type === 'osd') return !deviceClass || b.deviceClass === deviceClass

    return b.children.some(c => holdsOsd(c, seen))
  }

  // domaines atteignables depuis le bucket du take, pas toute la carte
  let domains = 0
  const visited = new Set<number>()

  const walk = (id: number) => {
    if (visited.has(id)) return

    visited.add(id)

    const b = byId.get(id)

    if (!b) return
    if (b.type === domain) {
      if (holdsOsd(b.id, new Set())) domains++

      return
    }

    b.children.forEach(walk)
  }

  walk(root.id)

  const needed = Math.ceil(pool.size / perDomain)

  if (domains < needed) return { level: 'insufficient', tolerated: 0, domain, domains, needed }

  const tolerated = Math.max(0, Math.floor((pool.size - pool.minSize) / perDomain))

  return { level: tolerated >= 1 ? 'tolerates' : 'blocks', tolerated, domain, domains, needed }
}
