import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../../__tests__/setup/route-test'

const m = vi.hoisted(() => ({ visible: vi.fn(), render: vi.fn(), denied: vi.fn() }))

vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'fr' }) }) }))
vi.mock('@/lib/incidents/guard', () => ({ requireIncidentAccess: async () => ({ denied: m.denied() }) }))
vi.mock('@/lib/incidents/orchestrator', () => ({
  getIncident: async (id: string) => ({ id }),
  incidentErrorResponse: () => new Response(null, { status: 500 }),
}))
vi.mock('@/lib/incidents/alertVisibility', () => ({ visibleIncident: (v: unknown) => m.visible(v) }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { ALERTS_VIEW: 'alerts.view' } }))
vi.mock('@/lib/incidents/reportPdf', () => ({ renderIncidentReport: (...a: unknown[]) => m.render(...a) }))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  m.denied.mockReturnValue(undefined)
  m.visible.mockResolvedValue({ id: 'i1', alerts: [] })
  m.render.mockResolvedValue(new Response('%PDF', { status: 200, headers: { 'Content-Type': 'application/pdf' } }))
})

describe('GET /incidents/[id]/report', () => {
  it('renders the visible view in the reader language', async () => {
    const res = await callRoute(GET as any, { params: { id: 'i1' } })

    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(m.render).toHaveBeenCalledWith({ id: 'i1', alerts: [] }, 'fr')
  })

  it('is a 404 when the caller sees no alert of the incident', async () => {
    m.visible.mockResolvedValue(null)
    const res = await callRoute(GET as any, { params: { id: 'i1' } })

    expect(res.status).toBe(404)
    expect(m.render).not.toHaveBeenCalled()
  })

  it('answers the refusal of the guard as is', async () => {
    m.denied.mockReturnValue(new Response(null, { status: 403 }))
    const res = await callRoute(GET as any, { params: { id: 'i1' } })

    expect(res.status).toBe(403)
    expect(m.render).not.toHaveBeenCalled()
  })
})
