// POST /api/v1/alerts/silence: a scoped caller silences only an alert it sees (roadmap#223).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({ refuse: vi.fn(), upsert: vi.fn() }))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ alertSilence: { upsert: (...a: unknown[]) => m.upsert(...a) } }),
  getCurrentTenantId: async () => 'default',
}))
vi.mock('@/lib/rbac', () => ({ checkPermission: async () => null, PERMISSIONS: { ALERTS_VIEW: 'alerts.view', ALERTS_MANAGE: 'alerts.manage' } }))
vi.mock('@/lib/alerts/silenceScope', () => ({ refuseInvisibleSilence: (...a: unknown[]) => m.refuse(...a) }))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  m.upsert.mockResolvedValue({ fingerprint: 'fp1' })
})

describe('POST /api/v1/alerts/silence', () => {
  it('silences an alert the caller sees', async () => {
    m.refuse.mockResolvedValue(null)
    const res = await callRoute(POST, { body: { fingerprint: 'fp1', duration: '1h' } })
    expect(res.status).toBe(200)
    expect(m.refuse).toHaveBeenCalledWith('fp1')
    expect(m.upsert).toHaveBeenCalled()
  })

  it('writes nothing for an alert outside the caller scope', async () => {
    m.refuse.mockResolvedValue(NextResponse.json({ error: 'Alert not found' }, { status: 404 }))
    const res = await callRoute(POST, { body: { fingerprint: 'fp2', duration: '1h' } })
    expect(res.status).toBe(404)
    expect(m.upsert).not.toHaveBeenCalled()
  })
})
