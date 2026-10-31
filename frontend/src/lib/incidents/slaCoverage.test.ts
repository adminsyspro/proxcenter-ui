import { beforeEach, describe, expect, it, vi } from 'vitest'

const { findManyMock, evaluateMock } = vi.hoisted(() => ({ findManyMock: vi.fn(), evaluateMock: vi.fn() }))

vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default', getTenantPrisma: () => ({ slaPolicy: { findMany: findManyMock } }) }))
vi.mock('@/lib/availability/policies', () => ({ evaluatePolicy: (...args: unknown[]) => evaluateMock(...args) }))

import { slaCoverage } from './slaCoverage'

const guest = (connectionId: string, vmid: number) => ({ ref: { connection_id: connectionId, kind: 'guest', vmid } })
const vmDown = (id: string, connectionId: string, vmid: number) => ({ id, type: 'vm_down', connection_id: connectionId, resource_id: vmid })

beforeEach(() => {
  findManyMock.mockReset().mockResolvedValue([{ id: 'p1' }, { id: 'p2' }])
  evaluateMock.mockReset().mockImplementation(async (_access: unknown, id: string) => ({ results: id === 'p1' ? [guest('c1', 108)] : [guest('c2', 5103)] }))
})

describe('slaCoverage', () => {
  it('lists the guest alerts no enabled Default policy covers, across every policy', async () => {
    const coverage = await slaCoverage([vmDown('a1', 'c1', 108), vmDown('a2', 'c1', 96722), vmDown('a3', 'c2', 5103)])

    expect(coverage).toEqual({ uncovered: ['a2'], report: true })
    expect(findManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { enabled: true } }))
    expect(evaluateMock).toHaveBeenCalledWith({ tenantId: 'default', scope: null }, 'p1', '1h', expect.any(Date))
  })

  it('keeps out of the report an incident whose guests no policy covers', async () => {
    expect(await slaCoverage([vmDown('a2', 'c1', 96722)])).toEqual({ uncovered: ['a2'], report: false })
  })

  it('reads no policy for an incident without a guest alert, which never enters the report', async () => {
    expect(await slaCoverage([{ id: 'n1', type: 'node_down', connection_id: 'c1', resource: 'pve2' }])).toEqual({ uncovered: [], report: false })
    expect(findManyMock).not.toHaveBeenCalled()
  })

  it('skips a policy deleted meanwhile and fails on any other refusal', async () => {
    evaluateMock.mockImplementation(async (_access: unknown, id: string) => {
      if (id === 'p2') throw new Error('Orchestrator 404: {"error":"not_found"}')
      return { results: [guest('c1', 108)] }
    })

    expect(await slaCoverage([vmDown('a1', 'c1', 108)])).toEqual({ uncovered: [], report: true })

    evaluateMock.mockRejectedValue(new Error('Orchestrator 503: unavailable'))
    await expect(slaCoverage([vmDown('a1', 'c1', 108)])).rejects.toThrow('Orchestrator 503')
  })
})
