import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

const { getPrincipalMock } = vi.hoisted(() => ({
  getPrincipalMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('@/lib/auth/principal', () => ({ getPrincipal: getPrincipalMock }))

describe('orchestratorHeaders', () => {
  const originalKey = process.env.ORCHESTRATOR_API_KEY

  // The helper snapshots the env at module-load time. vi.resetModules()
  // before each test forces a fresh import so the env mutation is
  // actually picked up.
  beforeEach(() => {
    delete process.env.ORCHESTRATOR_API_KEY
    vi.resetModules()
    getPrincipalMock.mockReset()
    getPrincipalMock.mockResolvedValue({ ok: true })
  })

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.ORCHESTRATOR_API_KEY
    } else {
      process.env.ORCHESTRATOR_API_KEY = originalKey
    }
  })

  async function loadHelper() {
    const mod = await import('./headers')
    return mod.orchestratorHeaders
  }

  it('returns the extra headers unchanged when the env key is unset', async () => {
    const orchestratorHeaders = await loadHelper()
    const out = await orchestratorHeaders({ 'Content-Type': 'application/json' })
    expect(out).toEqual({ 'Content-Type': 'application/json' })
    expect(out).not.toHaveProperty('X-API-Key')
  })

  it('returns an empty object when called with no args and no env key', async () => {
    const orchestratorHeaders = await loadHelper()
    expect(await orchestratorHeaders()).toEqual({})
  })

  it('attaches X-API-Key when the env var is set', async () => {
    process.env.ORCHESTRATOR_API_KEY = 'secret-key-123'
    const orchestratorHeaders = await loadHelper()
    const out = await orchestratorHeaders({ 'Content-Type': 'application/json' })
    expect(out).toEqual({
      'Content-Type': 'application/json',
      'X-API-Key': 'secret-key-123',
    })
  })

  it('env value wins over a caller-supplied X-API-Key', async () => {
    process.env.ORCHESTRATOR_API_KEY = 'baseline'
    const orchestratorHeaders = await loadHelper()
    // The helper writes the env-derived value AFTER spreading the
    // caller extras, on purpose: callers passing their own key (by
    // accident or otherwise) should not silently override the
    // configured server identity.
    const out = await orchestratorHeaders({ 'X-API-Key': 'caller-supplied' })
    expect(out['X-API-Key']).toBe('baseline')
  })

  describe('actor headers (#1105)', () => {
    it('names a session user by id and email', async () => {
      getPrincipalMock.mockResolvedValue({
        ok: true,
        principal: { kind: 'session', userId: 'u1', userEmail: 'alice@example.org', tenantId: 'default', connectionIds: null },
      })
      const orchestratorHeaders = await loadHelper()
      expect(await orchestratorHeaders({ 'Content-Type': 'application/json' })).toEqual({
        'Content-Type': 'application/json',
        'X-ProxCenter-Actor-Id': 'u1',
        'X-ProxCenter-Actor-Email': 'alice@example.org',
      })
    })

    it('names an API token as token:<id> without a user id', async () => {
      getPrincipalMock.mockResolvedValue({
        ok: true,
        principal: { kind: 'token', tokenId: 'tok_1', tenantId: 'default', connectionIds: null },
      })
      const orchestratorHeaders = await loadHelper()
      expect(await orchestratorHeaders()).toEqual({ 'X-ProxCenter-Actor-Email': 'token:tok_1' })
    })

    it('sends nothing without a principal', async () => {
      const orchestratorHeaders = await loadHelper()
      expect(await orchestratorHeaders()).toEqual({})
    })

    it('sends nothing outside a request, where reading the headers throws', async () => {
      getPrincipalMock.mockRejectedValue(new Error('headers() was called outside a request scope'))
      const orchestratorHeaders = await loadHelper()
      expect(await orchestratorHeaders({ 'Content-Type': 'application/json' })).toEqual({ 'Content-Type': 'application/json' })
    })

    it('keeps the values ASCII-safe and drops an actor that empties out', async () => {
      getPrincipalMock.mockResolvedValue({
        ok: true,
        principal: { kind: 'session', userId: 'u1\r\nX-Injected: 1', userEmail: 'élodie@exämple.org', tenantId: 'default', connectionIds: null },
      })
      const orchestratorHeaders = await loadHelper()
      const out = await orchestratorHeaders()
      expect(out['X-ProxCenter-Actor-Id']).toBe('u1X-Injected: 1')
      expect(out['X-ProxCenter-Actor-Email']).toBe('lodie@exmple.org')

      getPrincipalMock.mockResolvedValue({
        ok: true,
        principal: { kind: 'session', userId: '\n', userEmail: undefined, tenantId: 'default', connectionIds: null },
      })
      expect(await orchestratorHeaders()).toEqual({})
    })

    it('does not let a caller spoof the actor', async () => {
      getPrincipalMock.mockResolvedValue({
        ok: true,
        principal: { kind: 'session', userId: 'u1', userEmail: 'alice@example.org', tenantId: 'default', connectionIds: null },
      })
      const orchestratorHeaders = await loadHelper()
      const out = await orchestratorHeaders({ 'X-ProxCenter-Actor-Email': 'mallory@example.org' })
      expect(out['X-ProxCenter-Actor-Email']).toBe('alice@example.org')
    })
  })
})
