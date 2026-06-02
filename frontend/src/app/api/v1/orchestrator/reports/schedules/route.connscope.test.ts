import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null),
  applyReportRequestScope: vi.fn(),
  orchestratorFetch: vi.fn(async () => ({ id: 'sched-1' })),
}))
vi.mock('@/lib/rbac', () => ({ checkPermission: mocks.checkPermission, PERMISSIONS: { REPORTS_VIEW: 'reports.view' } }))
vi.mock('@/lib/reports/connectionScope', () => ({ applyReportRequestScope: mocks.applyReportRequestScope }))
vi.mock('@/lib/orchestrator', () => ({ orchestratorFetch: mocks.orchestratorFetch }))

import { POST } from './route'

function req(body: any) {
  return new Request('http://localhost/api/v1/orchestrator/reports/schedules', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as any
}

beforeEach(() => vi.clearAllMocks())

describe('POST /reports/schedules', () => {
  it('forwards the scoped body to the orchestrator (201)', async () => {
    mocks.applyReportRequestScope.mockImplementation(async (b: any) => { b.connection_ids = ['pve-1']; return null })
    const res = await POST(req({ type: 'backup', connection_ids: ['pve-1', 'ghost'], recipients: ['a@b.c'] }))
    expect(res.status).toBe(201)
    expect(mocks.orchestratorFetch).toHaveBeenCalledWith('/reports/schedules', expect.objectContaining({
      method: 'POST', body: expect.objectContaining({ connection_ids: ['pve-1'] }),
    }))
  })

  it('short-circuits on scope rejection without calling the orchestrator', async () => {
    const { NextResponse } = await import('next/server')
    mocks.applyReportRequestScope.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 422 }))
    const res = await POST(req({ type: 'inventory' }))
    expect(res.status).toBe(422)
    expect(mocks.orchestratorFetch).not.toHaveBeenCalled()
  })
})
