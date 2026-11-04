import { beforeEach, describe, expect, it, vi } from 'vitest'

const checkPermission = vi.hoisted(() => vi.fn())
vi.mock('@/lib/rbac', () => ({ checkPermission, buildNodeResourceId: (c: string, n: string) => `${c}:${n}` }))

import { checkScopePermission, parseDrainScope, scopeError, scopeNode, scopeNodes } from './scope'

describe('parseDrainScope', () => {
  it('reads one node, a group or a selection', () => {
    expect(parseDrainScope({ node: 'pve1' })).toEqual({ scope: { kind: 'node', node: 'pve1' } })
    expect(parseDrainScope({ config: { nodes: ['pve1', 'pve3'] } })).toEqual({ scope: { kind: 'group', nodes: ['pve1', 'pve3'] } })
    expect(parseDrainScope({ config: { vmids: [101] } })).toEqual({ scope: { kind: 'selection' } })
  })

  it('refuses a mixed, empty or malformed request', () => {
    for (const body of [
      {},
      null,
      { node: 'pve1', config: { nodes: ['pve2', 'pve3'] } },
      { node: 'pve1', config: { vmids: [1] } },
      { config: { vmids: [1], nodes: ['a', 'b'] } },
      { config: { nodes: ['pve1'] } },
      { config: { nodes: ['pve1', 'pve1'] } },
      { config: { nodes: ['pve1', 'bad node;'] } },
      { config: { nodes: Array.from({ length: 65 }, (_, i) => `n${i}`) } },
      { node: '../etc' },
    ]) {
      expect('error' in parseDrainScope(body)).toBe(true)
    }
  })

  it('names the nodes and the node field of each kind', () => {
    expect(scopeNodes({ kind: 'group', nodes: ['a', 'b'] })).toEqual(['a', 'b'])
    expect(scopeNodes({ kind: 'selection' })).toEqual([])
    expect(scopeNode({ kind: 'node', node: 'a' })).toBe('a')
    expect(scopeNode({ kind: 'group', nodes: ['a', 'b'] })).toBe('')
  })
})

describe('checkScopePermission', () => {
  beforeEach(() => checkPermission.mockReset())

  it('needs the right on every node of a group', async () => {
    const denied = new Response('no', { status: 403 })
    checkPermission.mockImplementation(async (_p: string, _t: string, id: string) => (id === 'c1:pve3' ? denied : null))

    expect(await checkScopePermission('c1', { kind: 'group', nodes: ['pve1', 'pve3'] }, 'node.manage')).toBe(denied)
    expect(await checkScopePermission('c1', { kind: 'node', node: 'pve1' }, 'node.manage')).toBeNull()
    expect(await checkScopePermission('c1', { kind: 'selection' }, 'node.manage')).toBeNull()
    expect(checkPermission).toHaveBeenCalledWith('node.manage', 'node', 'c1:pve3')
  })

  it('answers a 400 with the error', async () => {
    const res = scopeError('bad')
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'bad' })
  })
})
