/**
 * The executor of a Firewalling publish (UA51), against a fake Proxmox that keeps rule lists the way Proxmox does: a
 * POST lands at the top, `moveto` names the rule the moved one goes before, every PUT and DELETE checks the digest,
 * and each write changes the digest. What is tested: one call at a time, the digest of the draft checked before the
 * first write and chained after each one, the stop at the first failure, the engine's rules left alone, and, for
 * random drafts, that the list Proxmox ends with is the list the user wanted.
 */
import { describe, expect, it } from 'vitest'

import { EMPTY_DRAFT, addRule, cloneRules, currentEntries, deriveOps, enableGuestFirewall, moveRule, rebaseDraft, removeRules, shiftRules, toFields, updateRules, type FirewallDraft } from './draft'
import { executePublish, publishStatus, publishSummary, type PublishIO } from './publish'
import { type DraftScope, type RuleFields, parsePublishBody, isFail } from './publishOps'

type Stored = Partial<RuleFields> & { type: string; action: string }

const RULE_KEYS = ['type', 'action', 'enable', 'source', 'dest', 'proto', 'dport', 'sport', 'macro', 'iface', 'log', 'comment', 'icmp-type'] as const

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
      for (const k of RULE_KEYS) if (form!.has(k)) (r as any)[k] = k === 'enable' ? Number(form!.get(k)) : form!.get(k)!.trim()
      list.unshift(r)
      return
    }
    const pos = Number(m[2])
    if (method === 'DELETE') return void list.splice(pos, 1)
    if (form!.has('moveto')) return pveMove(list, pos, Number(form!.get('moveto')))
    for (const k of RULE_KEYS) if (form!.has(k)) (list[pos] as any)[k] = k === 'enable' ? Number(form!.get(k)) : form!.get(k)!.trim()
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

  it('starts no operation that could end past 55 s, its calls counted 8 s each', async () => {
    const pve = setup(['a', 'b', 'c'])
    const d = updateRules(EMPTY_DRAFT, CLUSTER, await readList(pve), ['b0', 'b1', 'b2'], { log: 'info' })
    // 0 s, then 38 s, then 40 s: the third edit (2 calls, 16 s) would end at 56 s.
    const clock = [0, 0, 38_000, 40_000]
    let tick = 0
    const result = await publish(pve, d, { now: () => clock[Math.min(tick++, clock.length - 1)] })
    expect(result.applied).toBe(2)
    expect(result.failed).toMatchObject({ index: 2, code: 'TIME_BUDGET' })
    expect(publishStatus(result)).toBe(503)
  })

  it('stops on a list changed under the same digest: the rule at the position is not the one expected', async () => {
    const pve = setup(['a', 'b'])
    const d = updateRules(EMPTY_DRAFT, CLUSTER, await readList(pve), ['b1'], { enable: 0 })
    // Someone renamed rule 1 and the digest did not move (another write path, a restored file).
    pve.lists.get(CLUSTER_PATH)![1].comment = 'renamed'
    pve.calls = []
    const result = await publish(pve, d)
    expect(result.failed).toMatchObject({ code: 'STALE_POSITION', index: 0 })
    expect(pve.calls).toEqual([`GET ${CLUSTER_PATH}`])
  })

  it('refuses a move across a rule of the engine, and a creation among its leading or trailing rules', async () => {
    const pve = new FakePve()
    pve.lists.set(GUEST_PATH, [stored('[pc-microseg]', { type: 'group', action: 'pcz-db' }), stored('u1'), stored('u2'), stored('[pc-microseg] observe')])
    const move = await executePublish([{ kind: 'rule.move', scope: GUEST, pos: 2, to: 0 }], {}, pve)
    expect(move.failed?.code).toBe('MANAGED_RULE')
    const rule = toFields({ type: 'in', action: 'ACCEPT', comment: 'x', enable: 1 })
    for (const index of [0, 4]) expect((await executePublish([{ kind: 'rule.add', scope: GUEST, rule, index }], {}, pve)).failed?.code).toBe('MANAGED_RULE')
    expect(pve.calls.filter(c => !c.startsWith('GET'))).toEqual([])
    const ok = await executePublish([{ kind: 'rule.add', scope: GUEST, rule, index: 3 }], {}, pve)
    expect(ok.failed).toBeUndefined()
    expect(pve.rules(GUEST_PATH).map(r => r.comment)).toEqual(['[pc-microseg]', 'u1', 'u2', 'x', '[pc-microseg] observe'])
  })

  it('a creation done whose move failed hands back the digest before it: the retry stops on a conflict, never creates twice', async () => {
    const pve = setup(['a', 'b'])
    const base = await readList(pve)
    const d = addRule(EMPTY_DRAFT, CLUSTER, base, toFields({ type: 'in', action: 'DROP', comment: 'mine', enable: 1 }), 1)
    const sent = deriveOps(d)
    pve.failOn = (method, path) => (method === 'PUT' && path.endsWith('/0') ? new Error('timeout') : null)
    const first = await executePublish(sent.ops, sent.digests, pve)
    expect(first).toMatchObject({ applied: 0, failed: { code: 'PVE_ERROR' } })
    expect(first.scopes.cluster.digest).toBe('d0')
    expect(first.scopes.cluster.rules).toHaveLength(3)
    pve.failOn = null
    const rebased = rebaseDraft(d, sent, first.applied, { cluster: first.scopes.cluster.digest })
    const again = deriveOps(rebased)
    const retry = await executePublish(again.ops, again.digests, pve)
    expect(retry.failed?.code).toBe('DIGEST_CONFLICT')
    expect(pve.rules(CLUSTER_PATH).filter(r => r.comment === 'mine')).toHaveLength(1)
  })

  it('never writes the guest options the engine owns on a guest of a zone', async () => {
    const pve = new FakePve()
    pve.lists.set(GUEST_PATH, [stored('[pc-microseg]', { type: 'group', action: 'pcz-db' })])
    pve.options.set('/nodes/pve1/qemu/101/firewall/options', { enable: 1, policy_in: 'DROP' })
    for (const options of [{ enable: 0 }, { policy_in: 'ACCEPT' }, { log_level_in: 'nolog' }]) {
      expect((await executePublish([{ kind: 'options.set', scope: GUEST, options }], {}, pve)).failed?.code).toBe('MANAGED_RULE')
    }
    expect((await executePublish([{ kind: 'options.set', scope: GUEST, options: { policy_out: 'DROP' } }], {}, pve)).failed).toBeUndefined()
  })

  it('creates a clone of an ICMP rule with its ICMP type', async () => {
    const pve = new FakePve()
    pve.lists.set(CLUSTER_PATH, [stored('ping', { proto: 'icmp', 'icmp-type': 'echo-request' })])
    const base = await readList(pve)
    expect((await publish(pve, cloneRules(EMPTY_DRAFT, CLUSTER, base, ['b0']))).failed).toBeUndefined()
    expect(pve.rules(CLUSTER_PATH).map(r => r['icmp-type'])).toEqual(['echo-request', 'echo-request'])
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
    expect(publishSummary(ops)).toEqual({ kinds: { 'rule.add': 1, 'rule.delete': 1 }, scopes: { guest: 1, cluster: 1 }, scopeKeys: ['guest:qemu/101', 'cluster'], moreScopes: 0 })
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

describe('executePublish on a guest of a zone: never refuses what the draft produces', () => {
  const G = () => stored('[pc-microseg]', { type: 'group', action: 'pcz-db' })
  const O = () => stored('[pc-microseg] observe', { log: 'info' })
  const guestOn = (rules: Stored[]) => {
    const pve = new FakePve()
    pve.lists.set(GUEST_PATH, rules)
    return pve
  }
  const comments = (pve: FakePve) => pve.rules(GUEST_PATH).map(r => r.comment)
  const newRule = (comment: string) => toFields({ type: 'in', action: 'ACCEPT', comment, enable: 1 })

  it('[group, observe]: an add lands between them', async () => {
    const pve = guestOn([G(), O()])
    const d = addRule(EMPTY_DRAFT, GUEST, await pve.get<any[]>(GUEST_PATH), newRule('n'))
    expect((await publish(pve, d)).failed).toBeUndefined()
    expect(comments(pve)).toEqual(['[pc-microseg]', 'n', '[pc-microseg] observe'])
  })

  it('[group]: an add lands below it', async () => {
    const pve = guestOn([G()])
    const d = addRule(EMPTY_DRAFT, GUEST, await pve.get<any[]>(GUEST_PATH), newRule('n'))
    expect((await publish(pve, d)).failed).toBeUndefined()
    expect(comments(pve)).toEqual(['[pc-microseg]', 'n'])
  })

  it('[group, u1, observe]: add n then delete u1 (delete pos 1, then add at 1) goes through', async () => {
    const pve = guestOn([G(), stored('u1'), O()])
    const base = await pve.get<any[]>(GUEST_PATH)
    let d = addRule(EMPTY_DRAFT, GUEST, base, newRule('n'))
    d = removeRules(d, GUEST, base, ['b1'])
    expect(deriveOps(d).ops.map(o => [o.kind, 'pos' in o ? o.pos : (o as { index: number }).index])).toEqual([['rule.delete', 1], ['rule.add', 1]])
    expect((await publish(pve, d)).failed).toBeUndefined()
    expect(comments(pve)).toEqual(['[pc-microseg]', 'n', '[pc-microseg] observe'])
  })

  it('a comment typed with spaces: the rule created lower is moved, not left on top of the zone group', async () => {
    const pve = guestOn([G(), stored('u1'), O()])
    const d = addRule(EMPTY_DRAFT, GUEST, await pve.get<any[]>(GUEST_PATH), { ...newRule('x'), comment: '  spaced  ' })
    const result = await publish(pve, d)
    expect(result.failed).toBeUndefined()
    expect(comments(pve)).toEqual(['[pc-microseg]', 'u1', 'spaced', '[pc-microseg] observe'])
  })

  it('an expected rule read with spaces matches the trimmed one', async () => {
    const pve = setup(['a'])
    const d = updateRules(EMPTY_DRAFT, CLUSTER, [{ type: 'in', action: 'ACCEPT', enable: 1, comment: ' a ', digest: 'd0' }], ['b0'], { enable: 0 })
    expect((await publish(pve, d)).failed).toBeUndefined()
  })

  function rng(seed: number) {
    let s = seed
    return (n: number) => {
      s = (s * 1103515245 + 12345) % 2147483648
      return s % n
    }
  }

  for (let seed = 1; seed <= 40; seed++) {
    it(`random guest draft ${seed}`, async () => {
      const r = rng(seed * 7919)
      const users = Array.from({ length: r(4) }, (_, i) => stored(`u${i}`))
      const pve = guestOn([G(), ...users, ...(r(3) > 0 ? [O()] : [])])
      const base = await pve.get<any[]>(GUEST_PATH)
      let d = EMPTY_DRAFT
      for (let step = 0; step < 1 + r(8); step++) {
        const entries = currentEntries(d, GUEST, base)
        const pick = entries.length > 0 ? entries[r(entries.length)].id : ''
        switch (r(6)) {
          case 0: d = addRule(d, GUEST, base, newRule(`n${seed}-${step}`), r(2) ? undefined : r(entries.length + 1)); break
          case 1: d = removeRules(d, GUEST, base, [pick]); break
          case 2: d = moveRule(d, GUEST, base, pick, r(entries.length)); break
          case 3: d = shiftRules(d, GUEST, base, [pick], r(2) ? -1 : 1); break
          case 4: d = cloneRules(d, GUEST, base, [pick]); break
          default: d = updateRules(d, GUEST, base, [pick], { action: 'DROP', type: 'in' })
        }
      }
      const wanted = currentEntries(d, GUEST, base).map(e => [e.rule.comment, e.rule.action])
      const result = await publish(pve, d)
      expect(result.failed).toBeUndefined()
      expect(pve.rules(GUEST_PATH).map(x => [x.comment, x.action])).toEqual(wanted)
    })
  }
})

describe('parsePublishBody', () => {
  const scope = { kind: 'cluster' }
  it('accepts the operations of a draft and refuses anything else', () => {
    const ok = parsePublishBody({ ops: deriveOps(addRule(EMPTY_DRAFT, CLUSTER, [], toFields({ comment: 'x' }))).ops, digests: { cluster: '' } })
    expect(isFail(ok)).toBe(false)
    const withExpect = parsePublishBody({ ops: deriveOps(removeRules(EMPTY_DRAFT, CLUSTER, [{ type: 'in', action: 'ACCEPT', comment: 'a', digest: 'd' }], ['b0'])).ops })
    expect(withExpect).toMatchObject({ ok: true, value: { ops: [{ expect: { comment: 'a', type: 'in', action: 'ACCEPT' } }] } })
    expect(isFail(parsePublishBody({ ops: Array.from({ length: 200 }, () => ({ kind: 'rule.delete', scope, pos: 0 })) }))).toBe(false)
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
      { ops: Array.from({ length: 201 }, () => ({ kind: 'rule.delete', scope, pos: 0 })) },
      // 101 creations below the top are 202 writes.
      { ops: Array.from({ length: 101 }, () => ({ kind: 'rule.add', scope, index: 1, rule: { type: 'in', action: 'ACCEPT' } })) },
      { ops: [{ kind: 'rule.add', scope, index: 0, rule: { type: 'group', action: 'pcz-db' } }] },
      { ops: [{ kind: 'rule.add', scope, index: 0, rule: { type: 'group', action: 'PCZ-db' } }] },
      { ops: [{ kind: 'rule.delete', scope, pos: 0, expect: { comment: 'a\nb' } }] },
    ]
    for (const body of bad) expect(isFail(parsePublishBody(body)), JSON.stringify(body).slice(0, 80)).toBe(true)
  })
})
