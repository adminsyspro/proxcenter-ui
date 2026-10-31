import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ inScope: vi.fn() }))

vi.mock('./validate', async orig => ({
  ...(await orig<typeof import('./validate')>()),
  windowTargetInScope: (...a: unknown[]) => m.inScope(...a),
}))

import { windowData, windowTargetError, windowView } from './windows'

const START = new Date('2026-10-27T08:00:00Z')
const END = new Date('2026-10-27T10:00:00Z')
const INPUT = { scope: 'guest' as const, connectionId: 'c1', node: null, vmid: 100, policyId: null, startsAt: START, endsAt: END, reason: 'Patch' }

beforeEach(() => {
  vi.clearAllMocks()
  m.inScope.mockResolvedValue(true)
})

describe('windows helpers', () => {
  it('windowView serialises the dates, windowData the validated fields', () => {
    const row = { id: 'w1', ...INPUT, createdBy: 'ops@lab', createdAt: START, tenantId: 'acme' }
    expect(windowView(row)).toEqual({
      id: 'w1', scope: 'guest', connectionId: 'c1', node: null, vmid: 100, policyId: null,
      startsAt: '2026-10-27T08:00:00.000Z', endsAt: '2026-10-27T10:00:00.000Z', reason: 'Patch', createdBy: 'ops@lab', createdAt: '2026-10-27T08:00:00.000Z',
    })
    expect(windowData(INPUT)).toEqual(INPUT)
  })

  it('windowTargetError: a guest or another target out of scope, a policy of the tenant', async () => {
    const exists = vi.fn().mockResolvedValue(true)
    expect(await windowTargetError(null, ['c1'], INPUT, exists)).toBeNull()
    m.inScope.mockResolvedValue(false)
    expect(await windowTargetError(null, ['c1'], INPUT, exists)).toBe('guest_out_of_scope')
    expect(await windowTargetError(null, ['c1'], { ...INPUT, scope: 'node', node: 'pve1', vmid: null }, exists)).toBe('target_out_of_scope')
    const policy = { ...INPUT, scope: 'policy' as const, connectionId: null, vmid: null, policyId: 'p1' }
    expect(await windowTargetError(null, [], policy, exists)).toBeNull()
    expect(exists).toHaveBeenCalledWith('p1')
    exists.mockResolvedValue(false)
    expect(await windowTargetError(null, [], policy, exists)).toBe('target_out_of_scope')
  })
})
