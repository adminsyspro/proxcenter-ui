import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { DEMO_AVAILABILITY_CONNECTION_ID } from '../availabilityDemo'
import { demoResponse } from '../demo-api'

const get = async (path: string, method = 'GET') => {
  const res = await demoResponse(new Request(`http://localhost${path}`, { method }))
  return { status: res?.status, body: await res?.json() }
}

describe('demo mode on the availability routes', () => {
  beforeEach(() => {
    process.env.DEMO_MODE = 'true'
  })
  afterEach(() => {
    delete process.env.DEMO_MODE
  })

  it('answers the five paths with the shapes of the real routes', async () => {
    expect((await get('/api/v1/availability/overview?period=7d')).body).toMatchObject({ period: '7d', tiles: { nodesTotal: 3 } })
    expect((await get('/api/v1/sla/policies')).body).toMatchObject({ total: 2, pageSize: 20 })
    expect((await get('/api/v1/sla/policies?fields=names')).body.items).toHaveLength(2)
    expect((await get('/api/v1/sla/policies/demo-sla-web')).body).toMatchObject({ policy: { name: 'Production web' } })
    expect((await get('/api/v1/sla/maintenance-windows')).body).toMatchObject({ total: 1 })
    expect((await get('/api/v1/availability/settings')).body).toEqual({ retentionDays: 400, defaultTarget: 99.9, measuredConnections: [DEMO_AVAILABILITY_CONNECTION_ID], policiesByConnection: {} })
  })

  it('offers the SLA report in the report catalogue', async () => {
    const types = (await get('/api/v1/orchestrator/reports/types')).body as { type: string; sections: { id: string }[] }[]

    expect(types.find(t => t.type === 'sla')?.sections.map(s => s.id)).toEqual(['summary', 'policies', 'incidents', 'maintenance'])
  })

  it('answers the error codes of the real routes with their status', async () => {
    expect(await get('/api/v1/availability/overview?period=2h')).toMatchObject({ status: 400, body: { error: 'invalid_period' } })
    expect(await get('/api/v1/sla/policies/unknown')).toMatchObject({ status: 404, body: { error: 'not_found' } })
  })

  it('answers a settings write with the merged settings', async () => {
    const put = async (body: unknown) => {
      const res = await demoResponse(new Request('http://localhost/api/v1/availability/settings', { method: 'PUT', body: JSON.stringify(body) }))
      return { status: res?.status, body: await res?.json() }
    }
    expect(await put({ retentionDays: 90 })).toEqual({ status: 200, body: { retentionDays: 90, defaultTarget: 99.9, measuredConnections: [DEMO_AVAILABILITY_CONNECTION_ID], policiesByConnection: {} } })
    expect((await put({ retentionDays: 90, defaultTarget: 99.5 })).body).toEqual({ retentionDays: 90, defaultTarget: 99.5, measuredConnections: [DEMO_AVAILABILITY_CONNECTION_ID], policiesByConnection: {} })
    expect((await put('nope')).body).toEqual({ retentionDays: 400, defaultTarget: 99.9, measuredConnections: [DEMO_AVAILABILITY_CONNECTION_ID], policiesByConnection: {} })
  })

  it('handles the other writes like any other demo write', async () => {
    expect(await get('/api/v1/sla/policies', 'POST')).toMatchObject({ status: 200, body: { demo: true } })
  })
})
