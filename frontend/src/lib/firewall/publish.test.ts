/**
 * The executor of a Firewalling publish (UA51), against a fake Proxmox that keeps rule lists the way Proxmox does: a
 * POST lands at the top, `moveto` names the rule the moved one goes before, every PUT and DELETE checks the digest,
 * and each write changes the digest. What is tested: one call at a time, the digest of the draft checked before the
 * first write and chained after each one, the stop at the first failure, the engine's rules left alone, and, for
 * random drafts, that the list Proxmox ends with is the list the user wanted.
 */
import { describe, expect, it } from 'vitest'

import { EMPTY_DRAFT, addRule, currentEntries, deriveOps, enableGuestFirewall, moveRule, removeRules, toFields, updateRules, type FirewallDraft } from './draft'
import { executePublish, publishStatus, publishSummary, type PublishIO } from './publish'
import { type DraftScope, type RuleFields, parsePublishBody, isFail } from './publishOps'

type Stored = Partial<RuleFields> & { type: string; action: string }

const RULE_KEYS = ['type', 'action', 'enable', 'source', 'dest', 'proto', 'dport', 'sport', 'macro', 'iface', 'log', 'comment'] as const

/** A Proxmox that holds rule lists, options and configs, and logs every call. */
class FakePve implements PublishIO {
  lists = new Map<string, Stored[]>()
  versions = new Map<string, number>()
  options = new Map<string, Record<string, unknown>>()
  configs = new Map<string, Record<string, unknown>>()
  calls: string[] = []
  inFlight = 0
  maxInFlight = 0
  failOn: ((method: string, path: string) => Error | null) | null = null

  digest(path: string) { return `d${this.versions.get(path) ?? 0}` }
  bump(path: string) { this.versions.set(path, (this.versions.get(path) ?? 0) + 1) }

  async get<T>(path: string): Promise<T> {
    this.calls.push(`GET ${path}`)
    await this.tick()
    if (this.options.has(path)) return { ...this.options.get(path), digest: this.digest(path) } as T
    if (this.configs.has(path)) return { ...this.configs.get(path), digest: this.digest(path) } as T
    const list = this.lists.get(path) ?? []
    return list.map((r, pos) => ({ ...r, pos, digest: this.digest(path) })) as T
  }

  private async tick() {
    this.inFlight++
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight)
    await Promise.resolve()
    this.inFlight--
  }

  async write(method: 'POST' | 'PUT' | 'DELETE', rawPath: string, form?: URLSearchParams): Promise<void> {
    this.calls.push(`${method} ${rawPath}`)
    await this.tick()
    const [path, query] = rawPath.split('?')
    const params = new URLSearchParams(query ?? '')
    const failure = this.failOn?.(method, path)
    if (failure) throw failure
    const m = /^(.*\/rules)(?:\/(\d+))?$/.exec(path)
    const target = m ? m[1] : path
    const digest = form?.get('digest') ?? params.get('digest')
    if (method !== 'POST' && digest && digest !== this.digest(target)) throw new Error('detected modified configuration - file changed by other user? Try again.')
    if (!m) return this.writeObject(path, form!)
    const list = this.lists.get(target) ?? []
    this.lists.set(target, list)
    this.bump(target)
    if (method === 'POST') {
      const r: Stored = { type: form!.get('type')!, action: form!.get('action')! }
      for (const k of RULE_KEYS) if (form!.has(k)) (r as any)[k] = k === 'enable' ? Number(form!.get(k)) : form!.get(k)
      list.unshift(r)
      return
    }
    const pos = Number(m[2])
    if (method === 'DELETE') return void list.splice(pos, 1)
    if (form!.has('moveto')) return pveMove(list, pos, Number(form!.get('moveto')))
    for (const k of RULE_KEYS) if (form!.has(k)) (list[pos] as any)[k] = k === 'enable' ? Number(form!.get(k)) : form!.get(k)
    for (const k of (form!.get('delete') ?? '').split(',').filter(Boolean)) delete (list[pos] as any)[k]
  }

  private writeObject(path: string, form: URLSearchParams) {
    const store = this.options.has(path) ? this.options : this.configs
    const obj = store.get(path) ?? {}
    for (const [k, v] of form) if (k !== 'digest') obj[k] = v
    store.set(path, obj)
    this.bump(path)
  }

  rules(path: string): Stored[] { return this.lists.get(path) ?? [] }
}

/** Proxmox's move (PVE/API2/Firewall/Rules.pm): the rule goes before the one at `moveto` in the list that holds it. */
function pveMove(list: Stored[], pos: number, moveto: number) {
  const rule = list[pos]
  const out: Stored[] = []
  list.forEach((r, i) => {
    if (i === pos) return
    if (i === moveto) out.push(rule)
    out.push(r)
  })
  if (moveto >= list.length) out.push(rule)
  list.splice(0, list.length, ...out)
}

const CLUSTER: DraftScope = { kind: 'cluster' }
const GUEST: DraftScope = { kind: 'guest', node: 'pve1', vmType: 'qemu', vmid: 101 }
const CLUSTER_PATH = '/cluster/firewall/rules'
const GUEST_PATH = '/nodes/pve1/qemu/101/firewall/rules'

const stored = (comment: string, extra: Partial<Stored> = {}): Stored => ({ type: 'in', action: 'ACCEPT', enable: 1, comment, ...extra })

function setup(comments: string[], path = CLUSTER_PATH) {
  const pve = new FakePve()
  pve.lists.set(path, comments.map(c => stored(c)))
  return pve
}

const readList = async (pve: FakePve, path = CLUSTER_PATH) => pve.get<any[]>(path)

const publish = (pve: FakePve, draft: FirewallDraft, opts?: Parameters<typeof executePublish>[3]) => {
  const { ops, digests } = deriveOps(draft)
  return executePublish(ops, digests, pve, opts)
}

describe('executePublish', () => {
  it('applies the operations one at a time, checks the draft digest first, chains the digest after each write', async () => {
    const pve = setup(['a', 'b', 'c'])
    const base = await readList(pve)
    pve.calls = []
    let d = removeRules(EMPTY_DRAFT, CLUSTER, base, ['b0'])
    d = updateRules(d, CLUSTER, base, ['b2'], { action: 'DROP' })
    d = addRule(d, CLUSTER, base, toFields({ type: 'in', action: 'ACCEPT', comment: 'new', enable: 1 }), 1)
    const result = await publish(pve, d)

    expect(result).toMatchObject({ applied: 3, total: 3 })
    expect(result.failed).toBeUndefined()
    expect(pve.maxInFlight).toBe(1)
    expect(pve.calls).toEqual([
      `GET ${CLUSTER_PATH}`,
      `DELETE ${CLUSTER_PATH}/0?digest=d0`, `GET ${CLUSTER_PATH}`,
      `PUT ${CLUSTER_PATH}/1`, `GET ${CLUSTER_PATH}`,
      `POST ${CLUSTER_PATH}`, `GET ${CLUSTER_PATH}`, `PUT ${CLUSTER_PATH}/0`, `GET ${CLUSTER_PATH}`,
    ])
    expect(pve.rules(CLUSTER_PATH).map(r => [r.comment, r.action])).toEqual([['b', 'ACCEPT'], ['new', 'ACCEPT'], ['c', 'DROP']])
    expect(result.scopes.cluster.digest).toBe('d4')
    expect(publishStatus(result)).toBe(200)
  })

  it('stops before any write on a list changed since the draft (409, nothing applied)', async () => {
    const pve = setup(['a', 'b'])
    const d = removeRules(EMPTY_DRAFT, CLUSTER, await readList(pve), ['b1'])
    pve.bump(CLUSTER_PATH)
    pve.calls = []
    const result = await publish(pve, d)
    expect(result.applied).toBe(0)
    expect(result.failed).toMatchObject({ index: 0, code: 'DIGEST_CONFLICT', scope: 'cluster' })
    expect(pve.calls).toEqual([`GET ${CLUSTER_PATH}`])
    expect(publishStatus(result)).toBe(409)
  })

  it('stops at the first failure: the applied count, the operation and the message; the rest is not sent', async () => {
    const pve = setup(['a', 'b', 'c', 'd'])
    const base = await readList(pve)
    const d = updateRules(EMPTY_DRAFT, CLUSTER, base, ['b0', 'b1', 'b2'], { log: 'info' })
    let edits = 0
    pve.failOn = (method) => (method === 'PUT' && ++edits === 2 ? new Error('Parameter verification failed. (400)') : null)
    pve.calls = []
    const result = await publish(pve, d)
    expect(result).toMatchObject({ applied: 1, total: 3, failed: { index: 1, kind: 'rule.edit', code: 'PVE_ERROR', message: 'Parameter verification failed. (400)' } })
    expect(pve.calls.filter(c => c.startsWith('PUT'))).toHaveLength(2)
    expect(publishStatus(result)).toBe(502)
  })

  it('a digest Proxmox refuses on a write is a conflict too', async () => {
    const pve = setup(['a'])
    const d = updateRules(EMPTY_DRAFT, CLUSTER, await readList(pve), ['b0'], { enable: 0 })
    pve.failOn = (method) => (method === 'PUT' ? new Error('detected modified configuration - file changed by other user? Try again.') : null)
    expect((await publish(pve, d)).failed?.code).toBe('DIGEST_CONFLICT')
  })

  it('never edits, moves or deletes a rule of the engine, even when asked', async () => {
    const pve = new FakePve()
    pve.lists.set(GUEST_PATH, [stored('[pc-microseg]', { type: 'group', action: 'pcz-db' }), stored('mine')])
    const result = await executePublish([{ kind: 'rule.delete', scope: GUEST, pos: 0 }], {}, pve)
    expect(result.failed?.code).toBe('MANAGED_RULE')
    expect(pve.rules(GUEST_PATH)).toHaveLength(2)
  })

  it('moves a created rule only when the rule on top is the one just created', async () => {
    const pve = setup(['a', 'b'])
    const base = await readList(pve)
    const d = addRule(EMPTY_DRAFT, CLUSTER, base, toFields({ type: 'in', action: 'DROP', comment: 'mine', enable: 1 }), 2)
    const { ops, digests } = deriveOps(d)
    const sneaky: PublishIO = {
      ...pve,
      get: pve.get.bind(pve),
      write: async (method, path, form) => {
        await pve.write(method, path, form)
        if (method === 'POST') pve.lists.get(CLUSTER_PATH)!.unshift(stored('someone else'))
      },
    }
    const result = await executePublish(ops, digests, sneaky)
    expect(result.failed?.code).toBe('NOT_OURS')
  })

  it('stops once its time is spent, before the next operation', async () => {
    const pve = setup(['a', 'b', 'c'])
    const d = updateRules(EMPTY_DRAFT, CLUSTER, await readList(pve), ['b0', 'b1', 'b2'], { log: 'info' })
    let clock = 0
    const result = await publish(pve, d, { budgetMs: 100, now: () => (clock += 60) })
    expect(result.applied).toBe(1)
    expect(result.failed?.code).toBe('TIME_BUDGET')
    expect(publishStatus(result)).toBe(503)
  })

  it('turns a guest firewall on: its options switch, then the flag on every NIC, each with its digest', async () => {
    const pve = new FakePve()
    pve.options.set('/nodes/pve1/qemu/101/firewall/options', { enable: 0 })
    pve.configs.set('/nodes/pve1/qemu/101/config', { net0: 'virtio=AA,bridge=vmbr0', net1: 'virtio=BB,bridge=vmbr1,firewall=1' })
    const written: string[] = []
    const result = await executePublish(deriveOps(enableGuestFirewall(EMPTY_DRAFT, GUEST)).ops, {}, { ...pve, get: pve.get.bind(pve), write: pve.write.bind(pve), guestWritten: (_s, what) => written.push(what) })
    expect(result.applied).toBe(1)
    expect(pve.options.get('/nodes/pve1/qemu/101/firewall/options')?.enable).toBe('1')
    expect(pve.configs.get('/nodes/pve1/qemu/101/config')?.net0).toBe('virtio=AA,bridge=vmbr0,firewall=1')
    expect(pve.calls.filter(c => c.startsWith('PUT'))).toHaveLength(2)
    expect(written).toEqual(['options', 'nic'])
  })

  it('summarises a publish for its audit row', () => {
    const ops = deriveOps(removeRules(addRule(EMPTY_DRAFT, GUEST, [], toFields({ comment: 'x' })), CLUSTER, [{ type: 'in', action: 'ACCEPT', digest: 'd' }], ['b0'])).ops
    expect(publishSummary(ops)).toEqual({ kinds: { 'rule.add': 1, 'rule.delete': 1 }, scopes: { guest: 1, cluster: 1 } })
  })
})

describe('executePublish: what Proxmox ends with is what the user wanted', () => {
  // A small deterministic generator: the same drafts on every run.
  function rng(seed: number) {
    let s = seed
    return (n: number) => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s % n
    }
  }

  for (let seed = 1; seed <= 40; seed++) {
    it(`random draft ${seed}`, async () => {
      const r = rng(seed)
      const pve = setup(Array.from({ length: 2 + r(6) }, (_, i) => `r${i}`))
      const base = await readList(pve)
      let d = EMPTY_DRAFT
      for (let step = 0; step < 1 + r(8); step++) {
        const entries = currentEntries(d, CLUSTER, base)
        const pick = entries.length > 0 ? entries[r(entries.length)].id : ''
        switch (r(5)) {
          case 0: d = addRule(d, CLUSTER, base, toFields({ type: 'in', action: 'DROP', comment: `n${seed}-${step}`, enable: 1 }), r(entries.length + 1)); break
          case 1: if (pick) d = removeRules(d, CLUSTER, base, [pick]); break
          case 2: if (pick) d = moveRule(d, CLUSTER, base, pick, r(entries.length)); break
          case 3: if (pick) d = updateRules(d, CLUSTER, base, [pick], { log: 'info', dport: String(1000 + step), proto: 'tcp' }); break
          default: if (pick) d = updateRules(d, CLUSTER, base, [pick], { enable: 0 })
        }
      }
      const wanted = currentEntries(d, CLUSTER, base).map(e => [e.rule.comment, e.rule.enable, e.rule.dport])
      const result = await publish(pve, d)
      expect(result.failed).toBeUndefined()
      expect(pve.rules(CLUSTER_PATH).map(x => [x.comment, Number(x.enable ?? 1), x.dport ?? ''])).toEqual(wanted)
    })
  }
})

describe('parsePublishBody', () => {
  const scope = { kind: 'cluster' }
  it('accepts the operations of a draft and refuses anything else', () => {
    const ok = parsePublishBody({ ops: deriveOps(addRule(EMPTY_DRAFT, CLUSTER, [], toFields({ comment: 'x' }))).ops, digests: { cluster: '' } })
    expect(isFail(ok)).toBe(false)
    const bad = [
      {},
      { ops: [] },
      { ops: [{ kind: 'rule.drop', scope }] },
      { ops: [{ kind: 'rule.delete', scope: { kind: 'host', node: '../etc' }, pos: 0 }] },
      { ops: [{ kind: 'rule.delete', scope: { kind: 'guest', node: 'pve1', vmType: 'kvm', vmid: 100 }, pos: 0 }] },
      { ops: [{ kind: 'rule.add', scope, index: 0, rule: { type: 'in', action: 'ALLOW' } }] },
      { ops: [{ kind: 'rule.add', scope, index: 0, rule: { type: 'in', action: 'ACCEPT', comment: '[pc-microseg] x' } }] },
      { ops: [{ kind: 'rule.add', scope, index: 0, rule: { type: 'in', action: 'ACCEPT', source: 'a\nb' } }] },
      { ops: [{ kind: 'rule.edit', scope, pos: 0, patch: { action: 'DROP' } }] },
      { ops: [{ kind: 'rule.move', scope, pos: 1, to: 1 }] },
      { ops: [{ kind: 'options.set', scope, options: { policy_in: 'MAYBE' } }] },
      { ops: [{ kind: 'guest.enable', scope }] },
      { ops: Array.from({ length: 101 }, () => ({ kind: 'rule.delete', scope, pos: 0 })) },
    ]
    for (const body of bad) expect(isFail(parsePublishBody(body)), JSON.stringify(body).slice(0, 80)).toBe(true)
  })
})
