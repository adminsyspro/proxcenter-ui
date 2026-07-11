import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
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

beforeEach(() => vi.clearAllMocks())

describe('POST /api/v1/ha/switchover', () => {
  it('triggers switchover', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })

    const { POST } = await import('../switchover/route')
    const res = await callRoute(POST as any, {
      body: { candidate: 'proxcenter-2' },
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/switchover'),
      expect.objectContaining({ method: 'POST' })
    )
  })
})

describe('POST /api/v1/ha/pause', () => {
  it('pauses Patroni', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })

    const { POST } = await import('../pause/route')
    const res = await callRoute(POST as any, { method: 'POST' })

    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/ha/resume', () => {
  it('resumes Patroni', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })

    const { POST } = await import('../resume/route')
    const res = await callRoute(POST as any, { method: 'POST' })

    expect(res.status).toBe(200)
  })
})

describe('POST /api/v1/ha/reinit/[node]', () => {
  it('reinitializes a replica', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })

    const { POST } = await import('../reinit/[node]/route')
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { node: 'proxcenter-3' },
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/reinit/proxcenter-3'),
      expect.any(Object)
    )
  })
})

describe('POST /api/v1/ha/maintenance/[node]', () => {
  it('enters maintenance mode', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })

    const { POST } = await import('../maintenance/[node]/route')
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { node: 'proxcenter-2' },
    })

    expect(res.status).toBe(200)
  })
})

describe('DELETE /api/v1/ha/maintenance/[node]', () => {
  it('exits maintenance mode', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })

    const { DELETE } = await import('../maintenance/[node]/route')
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { node: 'proxcenter-2' },
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/maintenance/proxcenter-2'),
      expect.objectContaining({ method: 'DELETE' })
    )
  })
})
