import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

describe('orchestratorHeaders', () => {
  const originalKey = process.env.ORCHESTRATOR_API_KEY

  // The helper snapshots the env at module-load time. vi.resetModules()
  // before each test forces a fresh import so the env mutation is
  // actually picked up.
  beforeEach(() => {
    delete process.env.ORCHESTRATOR_API_KEY
    vi.resetModules()
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
    const out = orchestratorHeaders({ 'Content-Type': 'application/json' })
    expect(out).toEqual({ 'Content-Type': 'application/json' })
    expect(out).not.toHaveProperty('X-API-Key')
  })

  it('returns an empty object when called with no args and no env key', async () => {
    const orchestratorHeaders = await loadHelper()
    expect(orchestratorHeaders()).toEqual({})
  })

  it('attaches X-API-Key when the env var is set', async () => {
    process.env.ORCHESTRATOR_API_KEY = 'secret-key-123'
    const orchestratorHeaders = await loadHelper()
    const out = orchestratorHeaders({ 'Content-Type': 'application/json' })
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
    const out = orchestratorHeaders({ 'X-API-Key': 'caller-supplied' })
    expect(out['X-API-Key']).toBe('baseline')
  })
})
