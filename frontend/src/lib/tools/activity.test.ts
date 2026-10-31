/**
 * Task history and change journal for the assistant (#459). The orchestrator
 * knows no users, so the tests pin the snapshot scoping and the journal's own
 * tenant rule more than the formatting.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { InventorySnapshot } from './snapshot'
import type { ToolContext } from './types'

const h = vi.hoisted(() => ({
  fetchStoredTasks: vi.fn(),
  orchestratorFetch: vi.fn(),
  visible: vi.fn((_c: unknown, _ctx: unknown) => true),
}))

vi.mock('@/lib/tasks/history', () => ({ fetchStoredTasks: h.fetchStoredTasks }))
vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: h.orchestratorFetch }))
vi.mock('@/lib/changes/visibility', () => ({
  buildChangeVisibilityCtx: async () => ({}),
  isChangeVisibleToTenant: (c: unknown, ctx: unknown) => h.visible(c, ctx),
}))

import { listChangesTool, listTasksTool, recordInSnapshot } from './activity'

const snapshot = (restricted: boolean): InventorySnapshot => ({
  clusters: [{ id: 'c1', name: 'PVE-PROD', nodeCount: 1, guestCount: 1 }],
  nodes: [{ connId: 'c1', cluster: 'PVE-PROD', name: 'pve1', status: 'online', cpuPct: 1, memPct: 1, memUsedGb: 1, memTotalGb: 8 }],
  guests: [
    {
      connId: 'c1', cluster: 'PVE-PROD', vmid: '101', name: 'db-01', type: 'VM', kind: 'qemu', status: 'running', node: 'pve1',
      cpuPct: 1, memPct: 1, memUsedGb: 1, memTotalGb: 4, template: false,
    },
  ],
  summary: { totalGuests: 1, runningGuests: 1, stoppedGuests: 0, totalNodes: 1, onlineNodes: 1 },
  cached: false,
  restricted,
})

const ctx = (restricted = true): ToolContext => ({ snapshot: snapshot(restricted), tenantId: 't', locale: 'fr', timeZone: 'UTC' })

beforeEach(() => {
  h.fetchStoredTasks.mockReset()
  h.orchestratorFetch.mockReset()
  h.visible.mockReset().mockReturnValue(true)
})

describe('recordInSnapshot', () => {
  it('keeps a guest record only for a guest of the snapshot when the caller is restricted', () => {
    const s = snapshot(true)

    expect(recordInSnapshot({ connectionId: 'c1', vmid: '101' }, s)).toBe(true)
    expect(recordInSnapshot({ connectionId: 'c1', vmid: '999' }, s)).toBe(false)
    expect(recordInSnapshot({ connectionId: 'c9', vmid: '101' }, s)).toBe(false)
  })

  it('keeps host-level records and deleted guests for an unrestricted caller only', () => {
    expect(recordInSnapshot({ connectionId: 'c1', node: 'pve1' }, snapshot(true))).toBe(false)
    expect(recordInSnapshot({ connectionId: 'c1', node: 'pve1' }, snapshot(false))).toBe(true)
    expect(recordInSnapshot({ connectionId: 'c1', node: 'pve7' }, snapshot(false))).toBe(false)
    expect(recordInSnapshot({ connectionId: 'c1', vmid: '999' }, snapshot(false))).toBe(true)
  })
})

describe('list_tasks', () => {
  const task = (over: Record<string, unknown>) => ({
    upid: 'u',
    connectionId: 'c1',
    startTime: '2026-10-30T02:00:00Z',
    endTime: '2026-10-30T02:05:00Z',
    node: 'pve1',
    type: 'vzdump',
    guestId: '101',
    user: 'root@pam',
    status: 'OK',
    ...over,
  })

  it('returns the failed tasks in scope with the end of their log', async () => {
    h.fetchStoredTasks.mockResolvedValue({
      truncated: false,
      tasks: [
        task({ status: 'job errors', logTail: 'INFO: starting\nERROR: backup write data failed: No space left on device' }),
        task({ startTime: '2026-10-30T01:00:00Z' }),
        task({ guestId: '999', status: 'job errors' }),
        task({ type: 'qmigrate', status: 'migration aborted', startTime: '2026-10-30T03:00:00Z' }),
      ],
    })

    const res = (await listTasksTool.execute({ family: 'backup', hours: 24 }, ctx())) as any

    expect(h.fetchStoredTasks.mock.calls[0][0]).toMatchObject({ connectionIds: ['c1'] })
    expect(res.total).toBe(1)
    expect(res.tasks[0]).toMatchObject({ guest: 'db-01', family: 'backup', status: 'job errors', started: '2026-10-30 02:00' })
    expect(res.tasks[0].error).toContain('No space left on device')
  })

  it('narrows the orchestrator query to the guest the model named', async () => {
    h.fetchStoredTasks.mockResolvedValue({ truncated: false, tasks: [] })

    await listTasksTool.execute({ guest: 'db-01', status: 'all', hours: 168 }, ctx())

    expect(h.fetchStoredTasks.mock.calls[0][0]).toMatchObject({ connectionIds: ['c1'], vmid: '101' })
  })

  it('says when the history cannot be read', async () => {
    h.fetchStoredTasks.mockResolvedValue(null)

    expect(await listTasksTool.execute({}, ctx())).toMatchObject({ available: false })
  })
})

describe('list_changes', () => {
  const change = (over: Record<string, unknown>) => ({
    timestamp: '2026-10-29T10:00:00Z',
    resourceType: 'qemu',
    resourceId: '101',
    resourceName: 'db-01',
    action: 'hardware_changed',
    user: 'admin@pve',
    node: 'pve1',
    fields: [{ field: 'memory', oldValue: 4096, newValue: 8192 }],
    ...over,
  })

  it('reads the journal per visible connection and keeps what the caller may see', async () => {
    h.orchestratorFetch.mockResolvedValue({
      data: [change({}), change({ resourceId: '999', resourceName: 'neighbour' }), change({ resourceType: 'node', resourceId: 'pve1' })],
    })

    const res = (await listChangesTool.execute({ hours: 48 }, ctx())) as any

    expect(h.orchestratorFetch.mock.calls[0][0]).toMatch(/^\/changes\?connectionId=c1&from=/)
    expect(res.changes).toHaveLength(1)
    expect(res.changes[0]).toMatchObject({ resource: 'db-01', vmid: '101', user: 'admin@pve', fields: ['memory: 4096 -> 8192'] })
  })

  it('applies the journal tenant rule on top of the snapshot', async () => {
    h.orchestratorFetch.mockResolvedValue({ data: [change({})] })
    h.visible.mockReturnValue(false)

    expect(((await listChangesTool.execute({}, ctx())) as any).total).toBe(0)
  })

  it('says when the journal cannot be read', async () => {
    h.orchestratorFetch.mockRejectedValue(new Error('ORCHESTRATOR_UNAVAILABLE'))

    expect(await listChangesTool.execute({}, ctx())).toMatchObject({ available: false })
  })
})
