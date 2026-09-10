import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  checkPermission: vi.fn(async () => null as any),
  getCurrentTenantId: vi.fn(async () => 'default'),
  fetchMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: h.checkPermission, PERMISSIONS: { REPORTS_VIEW: 'reports.view' } }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: h.getCurrentTenantId, DEFAULT_TENANT_ID: 'default' }))
vi.mock('@/lib/orchestrator', () => ({ orchestratorFetch: vi.fn() }))

import { callRoute } from '@/__tests__/setup/route-test'
import { GET } from './route'

function orchestratorResponse(contentType: string, filename: string) {
  return new Response(Buffer.from('payload'), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

beforeEach(() => {
  h.checkPermission.mockReset().mockResolvedValue(null)
  h.getCurrentTenantId.mockReset().mockResolvedValue('default')
  h.fetchMock.mockReset().mockResolvedValue(orchestratorResponse('application/pdf', 'infrastructure_3f1c8a52.pdf'))
  vi.stubGlobal('fetch', h.fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function calledUrl(): string {
  return h.fetchMock.mock.calls[0][0] as string
}

describe('GET /orchestrator/reports/[id]/download', () => {
  it('asks the orchestrator for the PDF when no format is given', async () => {
    const res = await callRoute(GET as any, { params: { id: 'rep-1' } })

    expect(res.status).toBe(200)
    expect(calledUrl()).toMatch(/\/api\/v1\/reports\/rep-1\/download$/)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  })

  it('forwards format=csv and serves the single CSV the orchestrator returns', async () => {
    h.fetchMock.mockResolvedValue(orchestratorResponse('text/csv; charset=utf-8', 'infrastructure_3f1c8a52.csv'))

    const res = await callRoute(GET as any, { params: { id: 'rep-1' }, searchParams: { format: 'csv' } })

    expect(res.status).toBe(200)
    expect(calledUrl()).toContain('/api/v1/reports/rep-1/download?format=csv')
    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toContain('.csv')
  })

  it('rejects an unknown format without calling the orchestrator', async () => {
    const res = await callRoute(GET as any, { params: { id: 'rep-1' }, searchParams: { format: 'xlsx' } })

    expect(res.status).toBe(400)
    expect(h.fetchMock).not.toHaveBeenCalled()
  })

  // A report is one CSV, so there is nothing to select: a leftover ?table=
  // from a bookmark must not travel to the orchestrator.
  it('never forwards a table parameter', async () => {
    await callRoute(GET as any, { params: { id: 'rep-1' }, searchParams: { format: 'csv', table: 'vms' } })

    expect(calledUrl()).toContain('format=csv')
    expect(calledUrl()).not.toContain('table=')
  })

  it('falls back to a CSV content type when the orchestrator sends none', async () => {
    h.fetchMock.mockResolvedValue(new Response(Buffer.from('a,b\n1,2\n'), { status: 200 }))

    const res = await callRoute(GET as any, { params: { id: 'rep-1' }, searchParams: { format: 'csv' } })

    expect(res.headers.get('Content-Type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('Content-Disposition')).toContain('report-rep-1.csv')
  })

  it('forwards an orchestrator error with its status', async () => {
    h.fetchMock.mockResolvedValue(new Response('this report has no CSV export', { status: 404 }))

    const res = await callRoute(GET as any, { params: { id: 'rep-1' }, searchParams: { format: 'csv' } })

    expect(res.status).toBe(404)
    expect((await res.json()).error).toContain('no CSV export')
  })

  it('returns the permission denial without touching the orchestrator', async () => {
    h.checkPermission.mockResolvedValue(new Response('no', { status: 403 }) as any)

    const res = await callRoute(GET as any, { params: { id: 'rep-1' }, searchParams: { format: 'csv' } })

    expect(res.status).toBe(403)
    expect(h.fetchMock).not.toHaveBeenCalled()
  })
})
