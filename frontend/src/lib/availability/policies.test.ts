import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ query: vi.fn(), guestsInScope: vi.fn(), scoped: vi.fn() }))

vi.mock('./orchestrator', () => ({ queryAvailability: (...a: unknown[]) => m.query(...a) }))
vi.mock('./validate', async orig => ({
  ...(await orig<typeof import('./validate')>()),
  guestsInScope: (...a: unknown[]) => m.guestsInScope(...a),
  scopedClusterGuests: (...a: unknown[]) => m.scoped(...a),
}))

import { evaluatePolicy, isRowId, isUniqueViolation, policyData, policyInScope, policyView, withGuestNames } from './policies'

const ROW = {
  id: 'p1', name: 'Prod', target: 99.9, guests: [{ connectionId: 'c1', vmid: 100 }, { bogus: true }, 'x'],
  tags: ['prod'], pools: [], enabled: true, createdBy: 'ops@lab',
  createdAt: new Date('2026-10-01T00:00:00Z'), updatedAt: new Date('2026-10-02T00:00:00Z'),
}
const INPUT = { name: 'Prod', target: 99.9, guests: [{ connectionId: 'c1', vmid: 100 }], tags: [], pools: ['pool-a'], enabled: true }

beforeEach(() => {
  vi.clearAllMocks()
  m.query.mockResolvedValue({ results: [] })
  m.guestsInScope.mockResolvedValue(true)
})

describe('policies helpers', () => {
  it('policyView drops malformed stored guests and the tenant', () => {
    expect(policyView(ROW as never)).toEqual({
      id: 'p1', name: 'Prod', target: 99.9, guests: [{ connectionId: 'c1', vmid: 100 }], tags: ['prod'], pools: [],
      enabled: true, createdBy: 'ops@lab', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z',
    })
    expect(policyView({ ...ROW, guests: null } as never).guests).toEqual([])
  })

  it('policyData carries the validated fields only', () => {
    expect(policyData(INPUT)).toEqual(INPUT)
  })

  it('evaluatePolicy queries the policy within the perimeter', async () => {
    const scope = { connections: { c1: { all: true } } }
    await evaluatePolicy({ tenantId: 'acme', scope }, 'p1', '30d', new Date('2026-10-27T10:15:00Z'))
    expect(m.query).toHaveBeenCalledWith({
      from: '2026-09-27T11:00:00.000Z', to: '2026-10-27T11:00:00.000Z', slot_seconds: 3600, tenant_id: 'acme', scope, policy_id: 'p1',
    })
  })

  it('policyInScope checks the pools, then the guests', async () => {
    const iaas = { connections: { c1: { all: false, nodes: ['pve1'], pools: ['pool-b'] } } }
    expect(await policyInScope(iaas, ['c1'], INPUT)).toBe(false)
    expect(m.guestsInScope).not.toHaveBeenCalled()
    expect(await policyInScope(null, ['c1'], INPUT)).toBe(true)
    m.guestsInScope.mockResolvedValue(false)
    expect(await policyInScope(null, ['c1'], INPUT)).toBe(false)
  })

  it('isUniqueViolation and isRowId', () => {
    expect(isUniqueViolation({ code: 'P2002' })).toBe(true)
    expect(isUniqueViolation(new Error('x'))).toBe(false)
    expect(isUniqueViolation(null)).toBe(false)
    expect(isRowId('cmh1abc')).toBe(true)
    expect(isRowId('../x')).toBe(false)
    expect(isRowId(undefined)).toBe(false)
  })
})

describe('withGuestNames', () => {
  const guest = (connection_id: string, vmid: number) => ({ ref: { connection_id, kind: 'guest' as const, vmid } }) as never

  it('names each guest from its cluster list, null when missing or unlisted', async () => {
    m.scoped.mockImplementation(async (_scope: unknown, id: string) =>
      id === 'c1' ? new Map([[100, { name: 'web-01', type: 'qemu' }]]) : null)
    const out = await withGuestNames(null, [guest('c1', 100), guest('c1', 404), guest('c2', 7)])
    expect(out.map(r => [r.name, r.type])).toEqual([['web-01', 'qemu'], [null, null], [null, null]])
    expect(m.scoped).toHaveBeenCalledTimes(2)
  })

  it('lists nothing without guest results', async () => {
    expect(await withGuestNames(null, [])).toEqual([])
    expect(m.scoped).not.toHaveBeenCalled()
  })
})
