import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', CONNECTION_MANAGE: 'connection.manage' },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: vi.fn(async (id: string) => ({ id })),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: pveFetchMock,
}))

const { GET } = await import('./route')

describe('GET /api/v1/connections/[id]/cluster/metrics/server/[serverId]', () => {
  beforeEach(() => {
    checkPermissionMock.mockReset()
    pveFetchMock.mockReset()
  })

  it('requires connection.manage, since the config carries the OpenTelemetry headers', async () => {
    checkPermissionMock.mockImplementation(async (perm: string) => (perm === 'connection.manage' ? deniedPermissionResponse() : null))

    const res = await callRoute(GET, { params: { id: 'c1', serverId: 'otel' } })

    expect(res.status).toBe(403)
    expect(checkPermissionMock).toHaveBeenCalledWith('connection.manage', 'connection', 'c1')
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('returns the full config to a manager', async () => {
    checkPermissionMock.mockResolvedValue(null)
    pveFetchMock.mockResolvedValue({ type: 'opentelemetry', server: '10.0.0.5', port: 4318, 'otel-headers': 'e30=' })

    const res = await callRoute(GET, { params: { id: 'c1', serverId: 'otel' } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ data: { type: 'opentelemetry', server: '10.0.0.5', port: 4318, 'otel-headers': 'e30=' } })
    expect(pveFetchMock).toHaveBeenCalledWith({ id: 'c1' }, '/cluster/metrics/server/otel')
  })
})
