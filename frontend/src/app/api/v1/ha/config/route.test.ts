import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireEnterprise: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/orchestrator/headers', () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => ({ 'X-API-Key': 'test', ...extra }),
}))

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
})

describe('GET /api/v1/ha/config', () => {
  it('proxies config from orchestrator', async () => {
    const mockConfig = {
      enabled: false,
      vip: '',
      vipHostname: '',
      vipInterface: 'eth0',
      deploymentState: 'idle',
      deploymentStep: 0,
      deployedAt: null,
      nodes: [],
    }
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockConfig,
    })

    const { GET } = await import('./route')
    const res = await callRoute(GET as any)
    const body = await readJson(res)

    expect(res.status).toBe(200)
    expect(body).toEqual(mockConfig)
  })

  it('returns 403 when permission denied', async () => {
    const { NextResponse } = await import('next/server')
    checkPermissionMock.mockResolvedValue(
      NextResponse.json({ error: 'Permission denied' }, { status: 403 })
    )

    const { GET } = await import('./route')
    const res = await callRoute(GET as any)

    expect(res.status).toBe(403)
  })

  it('returns 503 when orchestrator unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'))

    const { GET } = await import('./route')
    const res = await callRoute(GET as any)

    expect(res.status).toBe(503)
  })
})

describe('PUT /api/v1/ha/config', () => {
  it('proxies config save to orchestrator', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })

    const { PUT } = await import('./route')
    const body = {
      nodes: [
        { name: 'proxcenter-1', ip: '10.24.24.101', vrrpPriority: 150 },
        { name: 'proxcenter-2', ip: '10.24.24.102', vrrpPriority: 100 },
        { name: 'proxcenter-3', ip: '10.24.24.103', vrrpPriority: 50 },
      ],
      vip: '10.24.24.100',
      vipHostname: 'proxcenter.local',
      vipInterface: 'ens18',
      externalUrl: 'https://proxcenter.local',
      sshPasswords: {
        '10.24.24.101': 'pass1',
        '10.24.24.102': 'pass2',
        '10.24.24.103': 'pass3',
      },
    }
    const res = await callRoute(PUT as any, { body, method: 'PUT' })
    const data = await readJson(res)

    expect(res.status).toBe(200)
    expect(data).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/api/v1/ha/config'),
      expect.objectContaining({ method: 'PUT' })
    )
  })

  it('forwards orchestrator errors', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ ok: false, errors: { '10.24.24.103': 'SSH connection refused' } }),
    })

    const { PUT } = await import('./route')
    const res = await callRoute(PUT as any, { body: {}, method: 'PUT' })

    expect(res.status).toBe(400)
  })
})
