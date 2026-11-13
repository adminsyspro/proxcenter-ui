import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ moveFindMany: vi.fn(), vdcFindMany: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { vdcMove: { findMany: h.moveFindMany }, vdc: { findMany: h.vdcFindMany } } }))

import { listMoves, tenantSafeError } from './status'

const ROW = {
  id: 'm1', guestName: 'web-01', vmid: 105, targetVmid: 105, status: 'failed', origin: 'tenant',
  sourceVdcId: 'vdc-src', targetVdcId: 'vdc-dst', sourceConnectionId: 'conn-a', targetConnectionId: 'conn-b', targetNode: 'pve1-dr',
  error: 'The VM landed on the target cluster but could not join the vDC pool: 403 on 10.42.0.111',
  warnings: [{ code: 'ADDRESS_RELEASED', context: { ip: '10.0.0.5' } }],
  createdAt: new Date('2026-11-10T10:00:00Z'), finishedAt: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.moveFindMany.mockResolvedValue([ROW])
  h.vdcFindMany.mockResolvedValue([{ id: 'vdc-src', name: 'Paris' }, { id: 'vdc-dst', name: 'Lyon' }])
})

describe('tenantSafeError', () => {
  it('keeps the sentence ProxCenter wrote and drops the Proxmox detail', () => {
    expect(tenantSafeError('The copy failed (ERROR: host 10.42.0.111 unreachable); the VM stays')).toBe('The copy failed')
    expect(tenantSafeError('Interrupted before the copy started; the VM was not changed')).toBe('Interrupted before the copy started; the VM was not changed')
    expect(tenantSafeError(null)).toBeNull()
    expect(tenantSafeError(': x')).toBe('The move failed')
  })
})

describe('listMoves', () => {
  it('scopes a tenant to its moves and hides node and raw error', async () => {
    const [move] = await listMoves({ tenantId: 'acme', isProvider: false })
    expect(h.moveFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { tenantId: 'acme' }, take: 50 }))
    expect(move).toMatchObject({ sourceVdc: { id: 'vdc-src', name: 'Paris' }, targetVdc: { id: 'vdc-dst', name: 'Lyon' }, targetNode: null, createdAt: '2026-11-10T10:00:00.000Z' })
    expect(move.error).toBe('The VM landed on the target cluster but could not join the vDC pool')
    expect(move.warnings).toEqual(ROW.warnings)
  })

  it('shows the provider every move, the node and the raw error', async () => {
    const [move] = await listMoves({ tenantId: 'default', isProvider: true, moveId: 'm1', activeOnly: true, limit: 999 })
    expect(h.moveFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1', status: { in: ['queued', 'copying', 'finalizing'] } }, take: 200 }))
    expect(move.targetNode).toBe('pve1-dr')
    expect(move.error).toContain('10.42.0.111')
  })

  it('reads no vDC when there is no move', async () => {
    h.moveFindMany.mockResolvedValue([])
    expect(await listMoves({ tenantId: 'acme', isProvider: false })).toEqual([])
    expect(h.vdcFindMany).not.toHaveBeenCalled()
  })
})
