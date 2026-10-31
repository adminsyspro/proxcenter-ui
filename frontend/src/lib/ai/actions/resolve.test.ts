import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  licensed: true,
  principal: { kind: 'session', userId: 'u1', tenantId: 't1', connectionIds: null } as any,
  settings: { enabled: true, actions: { snapshot: true }, maxPerConversation: 5 } as any,
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: async () => state.licensed }))
vi.mock('@/lib/auth/principal', () => ({ getPrincipal: async () => ({ ok: true, principal: state.principal }) }))
vi.mock('./settings', () => ({ getAiActionsSettings: async () => state.settings }))
vi.mock('@/lib/tools/catalog', () => ({ READ_ONLY_TOOLS: [{ name: 'read_a' }, { name: 'read_b' }] }))
vi.mock('@/lib/tools/actions', () => ({
  actionToolsFor: (s: any) => (s.enabled && s.actions.snapshot ? [{ name: 'propose_action' }] : []),
}))

import { resolveAssistantTools } from './resolve'

const messages = [{ role: 'user', content: 'Snapshot db-01' }]
const run = (conversationId: unknown = 'conv-1_A') => resolveAssistantTools({ tenantId: 't1', conversationId, messages })
const runWithout = () => resolveAssistantTools({ tenantId: 't1', conversationId: undefined, messages })

beforeEach(() => {
  state.licensed = true
  state.principal = { kind: 'session', userId: 'u1', tenantId: 't1', connectionIds: null }
  state.settings = { enabled: true, actions: { snapshot: true }, maxPerConversation: 5 }
})

describe('resolveAssistantTools', () => {
  it('adds the proposal tools after the read-only ones and binds the card', async () => {
    const r = await run()

    expect(r.actionsEnabled).toBe(true)
    expect(r.tools.map(t => t.name)).toEqual(['read_a', 'read_b', 'propose_action'])
    expect(r.actions?.bind).toEqual({ userId: 'u1', tenantId: 't1', conversationId: 'conv-1_A' })
    expect(r.actions?.userText).toBe('snapshot db-01')
  })

  const readOnly = (r: Awaited<ReturnType<typeof run>>) => {
    expect(r.actionsEnabled).toBe(false)
    expect(r.actions).toBeUndefined()
    expect(r.tools.map(t => t.name)).toEqual(['read_a', 'read_b'])
  }

  it('stays read-only without the licence', async () => {
    state.licensed = false
    readOnly(await run())
  })

  it('stays read-only when the tenant enabled no kind', async () => {
    state.settings = { enabled: true, actions: { snapshot: false }, maxPerConversation: 5 }
    readOnly(await run())
  })

  it('stays read-only for an API token', async () => {
    state.principal = { kind: 'token', userId: 'u1', tenantId: 't1', connectionIds: null }
    readOnly(await run())
  })

  it('stays read-only without a principal or a user id', async () => {
    state.principal = undefined
    readOnly(await run())
    state.principal = { kind: 'session', tenantId: 't1', connectionIds: null }
    readOnly(await run())
  })

  it('stays read-only without a conversationId', async () => {
    readOnly(await runWithout())
  })

  it.each(['', 42, 'a b', 'x'.repeat(101), 'a/b'])('stays read-only for conversationId %j', async id => {
    readOnly(await run(id))
  })
})
