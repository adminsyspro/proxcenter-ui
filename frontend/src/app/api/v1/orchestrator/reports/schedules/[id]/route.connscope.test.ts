import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null),
  applyReportRequestScope: vi.fn(),
  orchestratorFetch: vi.fn(async () => ({ id: 'sched-1' })),
}))
vi.mock('@/lib/rbac', () => ({ checkPermission: mocks.checkPermission, PERMISSIONS: { REPORTS_VIEW: 'reports.view' } }))
vi.mock('@/lib/reports/connectionScope', () => ({ applyReportRequestScope: mocks.applyReportRequestScope }))
vi.mock('@/lib/orchestrator', () => ({ orchestratorFetch: mocks.orchestratorFetch }))

import { PUT } from './route'

function req(body: any) {
  return new Request('http://localhost/api/v1/orchestrator/reports/schedules/sched-1', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as any
}
const ctx = () => ({ params: Promise.resolve({ id: 'sched-1' }) })

beforeEach(() => vi.clearAllMocks())

describe('PUT /reports/schedules/[id]', () => {
  it('forwards the scoped body to the orchestrator (200)', async () => {
    mocks.applyReportRequestScope.mockImplementation(async (b: any) => { b.connection_ids = ['pve-1']; return null })
    const res = await PUT(req({ type: 'backup', connection_ids: ['pve-1'] }), ctx())
    expect(res.status).toBe(200)
    expect(mocks.orchestratorFetch).toHaveBeenCalledWith('/reports/schedules/sched-1', expect.objectContaining({
      method: 'PUT', body: expect.objectContaining({ connection_ids: ['pve-1'] }),
    }))
  })

  it('short-circuits on scope rejection without calling the orchestrator', async () => {
    const { NextResponse } = await import('next/server')
    mocks.applyReportRequestScope.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 400 }))
    const res = await PUT(req({ type: 'backup' }), ctx())
    expect(res.status).toBe(400)
    expect(mocks.orchestratorFetch).not.toHaveBeenCalled()
  })
})
