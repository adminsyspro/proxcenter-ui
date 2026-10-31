import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({ fetch: vi.fn() }))

vi.mock('@/lib/orchestrator/client', async orig => ({
  ...(await orig<typeof import('@/lib/orchestrator/client')>()),
  orchestratorFetch: (...a: unknown[]) => m.fetch(...a),
}))

import {
  availabilityErrorResponse,
  currentAvailability,
  getRetentionSettings,
  putRetentionSettings,
  queryAvailability,
  upstreamStatus,
} from './orchestrator'

const upstream = (status: number, body: unknown) => new Error(`Orchestrator ${status}: ${JSON.stringify(body)}`)

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  m.fetch.mockResolvedValue({})
})

describe('calls', () => {
  it('posts the query and the current state, reads and writes the retention', async () => {
    const q = { from: 'a', to: 'b', slot_seconds: 60, tenant_id: 't', scope: null, connection_ids: ['c1'] }
    await queryAvailability(q)
    expect(m.fetch).toHaveBeenLastCalledWith('/availability/query', { method: 'POST', body: q })
    const c = { connection_ids: ['c1'], tenant_id: 't', scope: null, include_covered: true }
    await currentAvailability(c)
    expect(m.fetch).toHaveBeenLastCalledWith('/availability/current', { method: 'POST', body: c })
    await getRetentionSettings()
    expect(m.fetch).toHaveBeenLastCalledWith('/availability/settings')
    await putRetentionSettings({ retention_days: 90 })
    expect(m.fetch).toHaveBeenLastCalledWith('/availability/settings', { method: 'PUT', body: { retention_days: 90 } })
  })
})

describe('availabilityErrorResponse', () => {
  async function answer(e: unknown) {
    const res = availabilityErrorResponse(e, 'test')
    return { status: res.status, body: await res.json() }
  }

  it('relays the licence refusal with its feature', async () => {
    // The body of the orchestrator's licence gate (license.Middleware.RequireFeature).
    const gate = { error: 'Your license does not include this feature', code: 'FEATURE_REQUIRED', feature: 'sla_monitoring' }
    expect(await answer(upstream(403, gate))).toEqual({ status: 403, body: { error: 'feature_required', feature: 'sla_monitoring' } })
  })

  it('maps a 404 to not_found and relays a short 400 code', async () => {
    expect(await answer(upstream(404, { error: 'policy_not_found' }))).toEqual({ status: 404, body: { error: 'not_found' } })
    expect(await answer(upstream(400, { error: 'too_many_objects' }))).toEqual({ status: 400, body: { error: 'too_many_objects' } })
  })

  it('never relays a free text', async () => {
    expect(await answer(upstream(400, { error: 'node pve-secret is unknown' }))).toEqual({ status: 400, body: { error: 'invalid_request' } })
    expect(await answer(upstream(500, { error: 'cluster acme-prod failed' }))).toEqual({ status: 503, body: { error: 'orchestrator_unavailable' } })
  })

  it('answers orchestrator_unavailable without an answer, internal_error for our own failure', async () => {
    expect(await answer(Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' })))
      .toEqual({ status: 503, body: { error: 'orchestrator_unavailable' } })
    expect(await answer(new Error('Orchestrator request timeout'))).toEqual({ status: 503, body: { error: 'orchestrator_unavailable' } })
    expect(await answer(new Error('prisma exploded on vm web-01'))).toEqual({ status: 500, body: { error: 'internal_error' } })
  })

  it('upstreamStatus reads the status of a refusal only', () => {
    expect(upstreamStatus(upstream(404, { error: 'policy_not_found' }))).toBe(404)
    expect(upstreamStatus(new Error('fetch failed'))).toBeNull()
  })
})
