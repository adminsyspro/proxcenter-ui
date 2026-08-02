import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { orchestratorOrPve } from './withPveFallback'

function unavailableError(): Error {
  const err: any = new Error('Orchestrator unavailable')

  err.code = 'ORCHESTRATOR_UNAVAILABLE'

  return err
}

describe('orchestratorOrPve', () => {
  let logSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  it('returns the unwrapped orchestrator data and never calls PVE on success', async () => {
    const pveCall = vi.fn()

    const result = await orchestratorOrPve(
      'firewall/vms',
      async () => ({ data: [{ pos: 0, type: 'in', action: 'ACCEPT' }] }),
      pveCall,
    )

    expect(result).toEqual([{ pos: 0, type: 'in', action: 'ACCEPT' }])
    expect(pveCall).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('does not fall back on empty/null orchestrator data — only on errors', async () => {
    const pveCall = vi.fn()

    const result = await orchestratorOrPve('firewall/vms', async () => ({ data: null as any }), pveCall)

    expect(result).toBeNull()
    expect(pveCall).not.toHaveBeenCalled()
  })

  it('falls back to PVE on ORCHESTRATOR_UNAVAILABLE and returns the bare shape', async () => {
    const pveCall = vi.fn().mockResolvedValue([{ pos: 1, type: 'out', action: 'DROP' }])

    const result = await orchestratorOrPve(
      'firewall/cluster',
      () => Promise.reject(unavailableError()),
      pveCall,
    )

    expect(result).toEqual([{ pos: 1, type: 'out', action: 'DROP' }])
    expect(pveCall).toHaveBeenCalledTimes(1)
  })

  it('logs the fallback once, in the SSH fallback style', async () => {
    await orchestratorOrPve('firewall/vms', () => Promise.reject(unavailableError()), async () => 'ok')

    expect(logSpy).toHaveBeenCalledTimes(1)
    expect(logSpy).toHaveBeenCalledWith('[firewall/vms] orchestrator unavailable, falling back to direct PVE')
  })

  it('rethrows non-unavailable orchestrator errors unchanged and never calls PVE', async () => {
    const pveCall = vi.fn()
    const licenseErr = new Error('Orchestrator 403: feature not licensed')

    await expect(
      orchestratorOrPve('firewall/groups', () => Promise.reject(licenseErr), pveCall),
    ).rejects.toBe(licenseErr)
    expect(pveCall).not.toHaveBeenCalled()
    expect(logSpy).not.toHaveBeenCalled()
  })

  it('rethrows timeouts — a timeout is not "unreachable"', async () => {
    const pveCall = vi.fn()
    const timeoutErr = new Error('Orchestrator request timeout')

    await expect(
      orchestratorOrPve('firewall/nodes', () => Promise.reject(timeoutErr), pveCall),
    ).rejects.toBe(timeoutErr)
    expect(pveCall).not.toHaveBeenCalled()
  })

  it('rethrows errors carrying a different code property', async () => {
    const pveCall = vi.fn()
    const otherErr: any = new Error('boom')

    otherErr.code = 'ECONNRESET'

    await expect(
      orchestratorOrPve('firewall/aliases', () => Promise.reject(otherErr), pveCall),
    ).rejects.toBe(otherErr)
    expect(pveCall).not.toHaveBeenCalled()
  })

  it('propagates PVE errors after a fallback', async () => {
    const pveErr = new Error('PVE 500 /cluster/firewall/rules: boom')

    await expect(
      orchestratorOrPve('firewall/cluster', () => Promise.reject(unavailableError()), () => Promise.reject(pveErr)),
    ).rejects.toBe(pveErr)
  })
})
