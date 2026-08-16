import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: vi.fn<() => Promise<any>>(),
  getCurrentTenantId: vi.fn<() => Promise<string>>(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  PERMISSIONS: {
    ALERTS_VIEW: 'alerts.view',
    ALERTS_MANAGE: 'alerts.manage',
  },
}))

import { POST } from './route'
import { getSessionPrisma, getCurrentTenantId } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

const upsert = vi.fn<(...args: any[]) => Promise<any>>()

const body = {
  severity: 'crit',
  message: 'Node pve1 is down',
  source: 'pve1',
  entityType: 'node',
  entityId: 'conn1:pve1',
  metric: 'status',
}

beforeEach(() => {
  vi.clearAllMocks()
  upsert.mockResolvedValue({ id: 'alert-1' })
  // Structural cast: a hand-rolled stub never satisfies the generated Prisma
  // client type (the delegate methods are generic over their args).
  vi.mocked(getSessionPrisma).mockResolvedValue({ alert: { upsert } } as any)
  vi.mocked(getCurrentTenantId).mockResolvedValue('tenant-1')
  vi.mocked(checkPermission).mockResolvedValue(null)
})

describe('POST /api/v1/alerts', () => {
  it('requires alerts.manage, like the other writes on the resource', async () => {
    await callRoute(POST, { body })

    expect(checkPermission).toHaveBeenCalledWith(PERMISSIONS.ALERTS_MANAGE)
  })

  it('upserts the alert when the permission is granted', async () => {
    const res = await callRoute(POST, { body })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { id: 'alert-1' } })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][0].where.tenantId_fingerprint.tenantId).toBe('tenant-1')
  })

  it('refuses the write and touches nothing when the permission is denied', async () => {
    vi.mocked(checkPermission).mockResolvedValue(
      NextResponse.json({ error: 'Permission denied: alerts.manage' }, { status: 403 }),
    )

    const res = await callRoute(POST, { body })

    expect(res.status).toBe(403)
    expect(upsert).not.toHaveBeenCalled()
  })

  it('checks the permission before reading the body, so an invalid payload still gets a 403', async () => {
    vi.mocked(checkPermission).mockResolvedValue(
      NextResponse.json({ error: 'Permission denied: alerts.manage' }, { status: 403 }),
    )

    const res = await callRoute(POST, { body: { severity: '' } })

    expect(res.status).toBe(403)
  })
})
