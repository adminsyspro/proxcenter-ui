import { describe, expect, it } from 'vitest'

import { actorSource, attributionOf, authorsOf, authorsOfAll, evidenceOrder } from './attribution'

describe('attributionOf', () => {
  it('is the least certain of the changes', () => {
    expect(attributionOf([{ attribution: 'verified' }, { attribution: 'inferred' }])).toBe('inferred')
    expect(attributionOf([{ attribution: 'verified' }, { attribution: 'unknown' }, { attribution: 'inferred' }])).toBe('unknown')
    expect(attributionOf([{ attribution: 'verified' }])).toBe('verified')
  })

  it('skips the rows written before attribution', () => {
    expect(attributionOf([{ user: 'system' }, { attribution: 'verified' }])).toBe('verified')
    expect(attributionOf([{ user: 'system' }, { attribution: 'bogus' }])).toBeUndefined()
    expect(attributionOf([])).toBeUndefined()
  })
})

describe('authorsOf', () => {
  it('splits the accounts a change names', () => {
    expect(authorsOf({ user: 'ops@example.com, alice@pve' })).toEqual(['ops@example.com', 'alice@pve'])
    expect(authorsOf({ user: '' })).toEqual([])
    expect(authorsOf({})).toEqual([])
  })

  it('lists each author of several changes once', () => {
    expect(authorsOfAll([{ user: 'a@pve, b@pve' }, { user: 'b@pve' }, {}])).toEqual(['a@pve', 'b@pve'])
  })
})

describe('evidenceOrder', () => {
  it('puts the records naming the author first and the token last, in time order within each', () => {
    const order = evidenceOrder([
      { name: 'root@pam!px', source: 'task', token: true },
      { name: 'alice@pve', source: 'journal' },
      { name: 'ops@example.com', source: 'audit' },
      { name: 'mig@example.com', source: 'migration' },
      { name: 'bob@pve', source: 'task' }
    ]).map(a => a.name)

    expect(order).toEqual(['ops@example.com', 'mig@example.com', 'alice@pve', 'bob@pve', 'root@pam!px'])
  })
})

describe('actorSource', () => {
  it('names where each name was read', () => {
    expect(actorSource({ name: 'ProxCenter', source: 'audit', masked: true }).key).toBe('changes.actorMasked')
    expect(actorSource({ name: 'ops@example.com', source: 'audit' }).key).toBe('changes.actorSourceAudit')
    expect(actorSource({ name: 'ops@example.com', source: 'migration' }).key).toBe('changes.actorSourceMigration')
    expect(actorSource({ name: 'bob@pve', source: 'task', taskType: 'qmigrate', node: 'pve1' })).toEqual({
      key: 'changes.actorSourceTask',
      values: { type: 'qmigrate', node: 'pve1' }
    })
    expect(actorSource({ name: 'alice@pve', source: 'journal', node: 'pve2' })).toEqual({
      key: 'changes.actorSourceJournal',
      values: { node: 'pve2' }
    })
    expect(actorSource({ name: 'x', source: 'task' }).values).toEqual({ type: '', node: '' })
  })
})
