/**
 * The Firewalling draft (UA51): the operations come from the list read and the list wanted, so an edit of a rule
 * added in the draft is part of its creation, a rule added then deleted costs nothing, a reorder is the fewest moves,
 * and the digest of the list the draft was made on goes with them.
 */
import { describe, expect, it } from 'vitest'

import {
  EMPTY_DRAFT, addRule, cloneRules, currentEntries, deriveOps, enableGuestFirewall, entryStates, moveRule, moveRulesToScope,
  deriveScopeOps, parseStoredDraft, userRange, pendingCount, rebaseDraft, removeRules, serializeDraft, setScopeOptions, shiftRules, toFields, updateRules,
} from './draft'
import type { DraftScope, RuleFields } from './publishOps'

const CLUSTER: DraftScope = { kind: 'cluster' }
const GUEST: DraftScope = { kind: 'guest', node: 'pve1', vmType: 'qemu', vmid: 101 }
const HOST: DraftScope = { kind: 'host', node: 'pve2' }

const rule = (comment: string, extra: Partial<RuleFields> = {}): RuleFields => ({ ...toFields({ type: 'in', action: 'ACCEPT', enable: 1, comment }), ...extra })
const read = (...comments: string[]) => comments.map((comment, pos) => ({ pos, type: 'in', action: 'ACCEPT', enable: 1, comment, digest: 'D1' }))

const BASE = read('a', 'b', 'c', 'd')

describe('draft: operations of a scope', () => {
  it('adds a rule at the end of the list by default, with the digest of the list it was made on', () => {
    const d = addRule(EMPTY_DRAFT, CLUSTER, BASE, rule('new'))
    const { ops, digests } = deriveOps(d)
    expect(ops).toEqual([expect.objectContaining({ kind: 'rule.add', index: 4, rule: expect.objectContaining({ comment: 'new' }) })])
    expect(digests).toEqual({ cluster: 'D1' })
    expect(currentEntries(d, CLUSTER, BASE).map(e => e.rule.comment)).toEqual(['a', 'b', 'c', 'd', 'new'])
  })

  it('names the rule each edit, delete and move expects at its position, as it is then', () => {
    let d = updateRules(EMPTY_DRAFT, CLUSTER, BASE, ['b1'], { dport: '22', proto: 'tcp' })
    d = removeRules(d, CLUSTER, BASE, ['b0'])
    d = moveRule(d, CLUSTER, BASE, 'b3', 0)
    const ops = deriveOps(d).ops
    const base = { type: 'in', action: 'ACCEPT', source: '', dest: '', proto: '', dport: '' }
    expect(ops[0]).toMatchObject({ kind: 'rule.delete', pos: 0, expect: { ...base, comment: 'a' } })
    expect(ops[1]).toMatchObject({ kind: 'rule.edit', pos: 0, expect: { ...base, comment: 'b' } })
    expect(ops[2]).toMatchObject({ kind: 'rule.move', pos: 2, to: 0, expect: { ...base, comment: 'd' } })
    expect(deriveOps(moveRule(EMPTY_DRAFT, CLUSTER, BASE, 'b1', 0)).ops[0]).toMatchObject({ expect: { comment: 'b' } })
  })

  it('keeps the ICMP type of a rule through a clone and a move to another section', () => {
    const icmp = [{ pos: 0, type: 'in', action: 'ACCEPT', enable: 1, proto: 'icmp', 'icmp-type': 'echo-request', comment: 'ping', digest: 'D1' }]
    const cloned = deriveOps(cloneRules(EMPTY_DRAFT, CLUSTER, icmp, ['b0'])).ops[0]
    expect(cloned).toMatchObject({ kind: 'rule.add', rule: { proto: 'icmp', 'icmp-type': 'echo-request' } })
    const moved = deriveOps(moveRulesToScope(EMPTY_DRAFT, { scope: CLUSTER, baseRules: icmp }, ['b0'], { scope: HOST, baseRules: [] })).ops
    expect(moved[1]).toMatchObject({ kind: 'rule.add', rule: { 'icmp-type': 'echo-request' } })
  })

  it('folds an edit of a rule added in the draft into its creation', () => {
    let d = addRule(EMPTY_DRAFT, CLUSTER, BASE, rule('new'), 2)
    const id = currentEntries(d, CLUSTER, BASE)[2].id
    d = updateRules(d, CLUSTER, BASE, [id], { action: 'DROP', dport: '22', proto: 'tcp' })
    const { ops } = deriveOps(d)
    expect(ops).toHaveLength(1)
    expect(ops[0]).toMatchObject({ kind: 'rule.add', index: 2, rule: { comment: 'new', action: 'DROP', dport: '22', proto: 'tcp' } })
  })

  it('cancels a rule added then deleted: nothing to publish, the scope leaves the draft', () => {
    let d = addRule(EMPTY_DRAFT, CLUSTER, BASE, rule('new'))
    const id = currentEntries(d, CLUSTER, BASE).find(e => e.rule.comment === 'new')!.id
    d = removeRules(d, CLUSTER, BASE, [id])
    expect(deriveOps(d).ops).toEqual([])
    expect(d.scopes).toEqual({})
  })

  it('edits a rule read with the fields that changed only; type and action go together', () => {
    let d = updateRules(EMPTY_DRAFT, CLUSTER, BASE, ['b1'], { log: 'info' })
    expect(deriveOps(d).ops).toEqual([expect.objectContaining({ kind: 'rule.edit', pos: 1, patch: { log: 'info' } })])
    d = updateRules(EMPTY_DRAFT, CLUSTER, BASE, ['b1'], { action: 'REJECT' })
    expect(deriveOps(d).ops[0]).toMatchObject({ kind: 'rule.edit', pos: 1, patch: { type: 'in', action: 'REJECT' } })
  })

  it('an edit undone is no change', () => {
    let d = updateRules(EMPTY_DRAFT, CLUSTER, BASE, ['b2'], { enable: 0 })
    d = updateRules(d, CLUSTER, BASE, ['b2'], { enable: 1 })
    expect(deriveOps(d).ops).toEqual([])
    expect(pendingCount(d)).toBe(0)
  })

  it('deletes from the bottom up, so the positions sent stay those of the list as it is then', () => {
    const d = removeRules(EMPTY_DRAFT, CLUSTER, BASE, ['b0', 'b2'])
    expect(deriveOps(d).ops.map(o => [o.kind, 'pos' in o ? o.pos : null])).toEqual([['rule.delete', 2], ['rule.delete', 0]])
  })

  it('moves the last rule to the top in one move, and the top one to the bottom in one move', () => {
    const up = moveRule(EMPTY_DRAFT, CLUSTER, BASE, 'b3', 0)
    expect(deriveOps(up).ops).toEqual([expect.objectContaining({ kind: 'rule.move', pos: 3, to: 0 })])
    const down = moveRule(EMPTY_DRAFT, CLUSTER, BASE, 'b0', 3)
    expect(deriveOps(down).ops).toEqual([expect.objectContaining({ kind: 'rule.move', pos: 0, to: 3 })])
    expect(entryStates(down.scopes.cluster).get('b0')).toBe('moved')
  })

  it('a rule dragged back to its place is no move', () => {
    let d = moveRule(EMPTY_DRAFT, CLUSTER, BASE, 'b1', 3)
    d = moveRule(d, CLUSTER, BASE, 'b1', 1)
    expect(deriveOps(d).ops).toEqual([])
  })

  it('Up and Down move the selection as a block and stop at the edge', () => {
    let d = shiftRules(EMPTY_DRAFT, CLUSTER, BASE, ['b0', 'b2'], -1)
    expect(currentEntries(d, CLUSTER, BASE).map(e => e.id)).toEqual(['b0', 'b2', 'b1', 'b3'])
    d = shiftRules(EMPTY_DRAFT, CLUSTER, BASE, ['b2', 'b3'], 1)
    expect(currentEntries(d, CLUSTER, BASE).map(e => e.id)).toEqual(['b0', 'b1', 'b2', 'b3'])
  })

  it('clones a rule right below it, a creation at that position', () => {
    const d = cloneRules(EMPTY_DRAFT, CLUSTER, BASE, ['b1'])
    expect(currentEntries(d, CLUSTER, BASE).map(e => e.rule.comment)).toEqual(['a', 'b', 'b', 'c', 'd'])
    expect(deriveOps(d).ops).toEqual([expect.objectContaining({ kind: 'rule.add', index: 2 })])
  })

  it('never changes a rule the engine owns', () => {
    const mixed = [...read('a'), { pos: 1, type: 'group', action: 'pcz-db', enable: 1, comment: '[pc-microseg]', digest: 'D1' }]
    let d = updateRules(EMPTY_DRAFT, GUEST, mixed, ['b1'], { enable: 0 })
    d = removeRules(d, GUEST, mixed, ['b1'])
    d = moveRule(d, GUEST, mixed, 'b1', 0)
    expect(deriveOps(d).ops).toEqual([])
  })

  it('makes no draft on a list never read', () => {
    expect(addRule(EMPTY_DRAFT, GUEST, null, rule('x'))).toBe(EMPTY_DRAFT)
  })
})

describe('draft: across scopes and settings', () => {
  it('moves rules to another section: deleted there, created at the end here, one scope after the other', () => {
    const d = moveRulesToScope(EMPTY_DRAFT, { scope: CLUSTER, baseRules: BASE }, ['b1'], { scope: HOST, baseRules: read('h') })
    const { ops, digests } = deriveOps(d)
    expect(ops.map(o => [o.kind, o.scope.kind])).toEqual([['rule.delete', 'cluster'], ['rule.add', 'host']])
    expect(ops[1]).toMatchObject({ index: 1, rule: { comment: 'b' } })
    expect(digests).toEqual({ cluster: 'D1', 'host:pve2': 'D1' })
  })

  it('options equal to what was read are no change; the guest firewall comes after its rules', () => {
    let d = setScopeOptions(EMPTY_DRAFT, GUEST, { enable: 0, policy_in: 'DROP' }, { policy_in: 'DROP' })
    expect(d.scopes).toEqual({})
    d = setScopeOptions(EMPTY_DRAFT, GUEST, { enable: 0, policy_in: 'DROP' }, { policy_in: 'ACCEPT' })
    d = enableGuestFirewall(d, GUEST)
    d = addRule(d, GUEST, read('g'), rule('allow ssh'))
    expect(deriveOps(d).ops.map(o => o.kind)).toEqual(['rule.add', 'options.set', 'guest.enable'])
    // The rules of the guest were read for the add: the options alone carry no digest of their own.
    expect(deriveOps(d).digests).toEqual({ 'guest:qemu/101': 'D1' })
  })

  it('the firewall switched on and back off is no change', () => {
    const d = enableGuestFirewall(enableGuestFirewall(EMPTY_DRAFT, GUEST), GUEST, false)
    expect(d.scopes).toEqual({})
  })
})

describe('draft: after a publish that stopped', () => {
  it('drops the scopes done, keeps the scope not reached, rebases the scope it stopped in', () => {
    let d = removeRules(EMPTY_DRAFT, CLUSTER, BASE, ['b3'])
    d = addRule(d, CLUSTER, BASE, rule('x'))
    d = addRule(d, HOST, read('h'), rule('y'))
    d = addRule(d, GUEST, read('g'), rule('z'))
    const sent = deriveOps(d)
    expect(sent.ops.map(o => `${o.kind} ${o.scope.kind}`)).toEqual(['rule.delete cluster', 'rule.add cluster', 'rule.add host', 'rule.add guest'])

    // Cluster done, host failed: the guest was not reached.
    const after = rebaseDraft(d, sent, 2, { cluster: 'D2' })
    expect(Object.keys(after.scopes)).toEqual(['host:pve2', 'guest:qemu/101'])
    expect(deriveOps(after).ops).toEqual(sent.ops.slice(2))

    // Stopped inside the cluster: the delete went through, the add is still to do, on the new digest.
    const mid = rebaseDraft(d, sent, 1, { cluster: 'D2' })
    const again = deriveOps(mid)
    expect(again.ops.map(o => `${o.kind} ${o.scope.kind}`)).toEqual(['rule.add cluster', 'rule.add host', 'rule.add guest'])
    expect(again.digests.cluster).toBe('D2')
  })
})

describe('draft: storage', () => {
  it('reads back what it wrote, and the empty draft from anything else', () => {
    const d = addRule(EMPTY_DRAFT, CLUSTER, BASE, rule('new'))
    expect(parseStoredDraft(serializeDraft(d))).toEqual(d)
    expect(parseStoredDraft('{"v":2}')).toEqual(EMPTY_DRAFT)
    expect(parseStoredDraft('not json')).toEqual(EMPTY_DRAFT)
    expect(parseStoredDraft(null)).toEqual(EMPTY_DRAFT)
    const tampered = JSON.parse(serializeDraft(d))
    tampered.draft.scopes.cluster.scope = { kind: 'host', node: 'x' }
    expect(parseStoredDraft(JSON.stringify(tampered)).scopes).toEqual({})
  })
})

describe('draft: the engine block of a guest stays where the engine put it', () => {
  // A guest of a zone: the zone group on top, the user's rules, the final observe rule.
  const engine = (comment: string, extra: Record<string, unknown> = {}) => ({ type: 'in', action: 'ACCEPT', enable: 1, comment, digest: 'D1', ...extra })
  const ZONED = [
    engine('[pc-microseg]', { type: 'group', action: 'pcz-db' }),
    engine('u1'),
    engine('u2'),
    engine('[pc-microseg] observe', { log: 'info' }),
  ]
  const order = (d: ReturnType<typeof addRule>) => currentEntries(d, GUEST, ZONED).map(e => e.rule.comment)

  it('Up and Down never pass a rule of the engine', () => {
    expect(shiftRules(EMPTY_DRAFT, GUEST, ZONED, ['b1'], -1).scopes).toEqual({})
    expect(shiftRules(EMPTY_DRAFT, GUEST, ZONED, ['b2'], 1).scopes).toEqual({})
  })

  it('a drag stops at the engine rules: onto the zone group it lands right below it, past the observe rule right above it', () => {
    let d = moveRule(EMPTY_DRAFT, GUEST, ZONED, 'b2', 0)
    expect(order(d)).toEqual(['[pc-microseg]', 'u2', 'u1', '[pc-microseg] observe'])
    expect(deriveOps(d).ops).toEqual([expect.objectContaining({ kind: 'rule.move', pos: 2, to: 1 })])
    d = moveRule(EMPTY_DRAFT, GUEST, ZONED, 'b1', 3)
    expect(order(d)).toEqual(['[pc-microseg]', 'u2', 'u1', '[pc-microseg] observe'])
  })

  it('adds before the observe rule, and never above the zone group', () => {
    expect(deriveOps(addRule(EMPTY_DRAFT, GUEST, ZONED, rule('new'))).ops[0]).toMatchObject({ kind: 'rule.add', index: 3 })
    expect(deriveOps(addRule(EMPTY_DRAFT, GUEST, ZONED, rule('new'), 0)).ops[0]).toMatchObject({ kind: 'rule.add', index: 1 })
  })

  it('a rule moved to the guest goes before its observe rule', () => {
    const d = moveRulesToScope(EMPTY_DRAFT, { scope: CLUSTER, baseRules: BASE }, ['b0'], { scope: GUEST, baseRules: ZONED })
    expect(order(d)).toEqual(['[pc-microseg]', 'u1', 'u2', 'a', '[pc-microseg] observe'])
    expect(deriveOps(d).ops.at(-1)).toMatchObject({ kind: 'rule.add', index: 3 })
  })

  it('Up of the whole user block stays put', () => {
    expect(shiftRules(EMPTY_DRAFT, GUEST, ZONED, ['b1', 'b2'], -1).scopes).toEqual({})
    expect(shiftRules(EMPTY_DRAFT, GUEST, ZONED, ['b1', 'b2'], 1).scopes).toEqual({})
  })

  it('a fresh guest of a zone, [group, observe] or [group]: an add and a Move to section land right below the group', () => {
    const fresh = [ZONED[0], ZONED[3]]
    expect(order(addRule(EMPTY_DRAFT, GUEST, fresh, rule('new')))).toEqual(['[pc-microseg]', 'new', '[pc-microseg] observe'])
    expect(deriveOps(addRule(EMPTY_DRAFT, GUEST, fresh, rule('new'))).ops[0]).toMatchObject({ kind: 'rule.add', index: 1 })
    const moved = moveRulesToScope(EMPTY_DRAFT, { scope: CLUSTER, baseRules: BASE }, ['b0'], { scope: GUEST, baseRules: fresh })
    expect(currentEntries(moved, GUEST, fresh).map(e => e.rule.comment)).toEqual(['[pc-microseg]', 'a', '[pc-microseg] observe'])
    const groupOnly = [ZONED[0]]
    expect(currentEntries(addRule(EMPTY_DRAFT, GUEST, groupOnly, rule('new')), GUEST, groupOnly).map(e => e.rule.comment)).toEqual(['[pc-microseg]', 'new'])
    expect(userRange(currentEntries(EMPTY_DRAFT, GUEST, fresh))).toEqual([1, 1])
    expect(userRange(currentEntries(EMPTY_DRAFT, GUEST, groupOnly))).toEqual([1, 1])
  })

  it('trims what Proxmox trims: a comment typed with spaces is the comment it will read back', () => {
    expect(toFields({ type: 'in', action: 'ACCEPT', comment: '  web  ', source: ' 10.0.0.1 ' })).toMatchObject({ comment: 'web', source: '10.0.0.1' })
  })

  it('never moves a rule of the engine, even where the longest run would rather move it', () => {
    // A draft out of reach of the UI: the user rules wanted above the zone group.
    const base = currentEntries(EMPTY_DRAFT, GUEST, ZONED.slice(0, 3))
    const sd = { scope: GUEST, baseDigest: 'D1', base, rules: [base[1], base[2], base[0]] }
    // Without the engine rules held in place, the longest run (u1, u2) would move the zone group to the bottom.
    expect(deriveScopeOps(sd).ops.filter(op => 'ref' in op && op.ref === 'b0')).toEqual([])
  })
})
