import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null),
  assertReportTypeAllowed: vi.fn(async () => null),
  resolveReportConnectionScope: vi.fn(),
  orchestratorFetch: vi.fn(async () => ({ ok: true })),
}))
vi.mock('@/lib/rbac', () => ({ checkPermission: mocks.checkPermission, PERMISSIONS: { REPORTS_VIEW: 'reports.view' } }))
vi.mock('@/lib/reports/tenantScope', () => ({ assertReportTypeAllowed: mocks.assertReportTypeAllowed }))
vi.mock('@/lib/reports/connectionScope', () => ({ resolveReportConnectionScope: mocks.resolveReportConnectionScope }))
vi.mock('@/lib/orchestrator', () => ({ orchestratorFetch: mocks.orchestratorFetch }))

import { POST } from './route'

function req(body: any) {
  return new Request('http://localhost/api/v1/orchestrator/reports', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }) as any
}

beforeEach(() => vi.clearAllMocks())

describe('POST /reports connection scope', () => {
  it('forwards the helper-resolved connection_ids', async () => {
    mocks.resolveReportConnectionScope.mockImplementation(async (b: any) => { b.connection_ids = ['pve-1']; return null })
    await POST(req({ type: 'backup', connection_ids: ['pve-1', 'ghost'] }))
    expect(mocks.orchestratorFetch).toHaveBeenCalledWith('/reports', expect.objectContaining({
      method: 'POST', body: expect.objectContaining({ connection_ids: ['pve-1'] }),
    }))
  })

  it('returns the helper rejection without calling the orchestrator', async () => {
    const { NextResponse } = await import('next/server')
    mocks.resolveReportConnectionScope.mockResolvedValue(NextResponse.json({ error: 'x' }, { status: 400 }))
    const res = await POST(req({ type: 'backup', connection_ids: ['ghost'] }))
    expect(res.status).toBe(400)
    expect(mocks.orchestratorFetch).not.toHaveBeenCalled()
  })
})
