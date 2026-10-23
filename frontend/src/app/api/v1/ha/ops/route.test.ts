import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

// Every HA write is provider-only (haWriteGuard); the guard is not under test here.
vi.mock('@/lib/tenant/providerGuard', () => ({
  requireProviderAdmin: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/auth/requireEnterprise', () => ({
  requireFeature: vi.fn().mockResolvedValue(null),
}))

vi.mock('@/lib/orchestrator/headers', () => ({
  orchestratorHeaders: (extra: Record<string, string> = {}) => ({ 'X-API-Key': 'test', ...extra }),
}))

// Every HA write is wrapped by withAudit() (#1105); the real audit() would
// reach Prisma and the syslog forwarder.
const auditMock = vi.fn(async () => 'audit-id')
vi.mock('@/lib/audit', () => ({ audit: auditMock }))

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
    // The safety-net row: none of these routes audits itself.
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      category: 'system', action: 'execute', resourceType: 'ha', status: 'success',
      details: expect.objectContaining({ method: 'POST', httpStatus: 200 }),
    })
  })

  it('rejects an unreadable body with 400 instead of blaming the orchestrator', async () => {
    const { POST } = await import('../switchover/route')
    const res = await callRoute(POST as any, { method: 'POST', body: 'not json at all' })

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({ action: 'execute', status: 'failure', errorMessage: 'Invalid JSON body', details: expect.objectContaining({ httpStatus: 400 }) })
  })
})

describe('PUT /api/v1/ha/sync-mode', () => {
  it('forwards the requested sync mode', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ok: true }),
    })

    const { PUT } = await import('../sync-mode/route')
    const res = await callRoute(PUT as any, { method: 'PUT', body: { mode: 'synchronous_mode_strict' } })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/ha/sync-mode'),
      expect.objectContaining({ method: 'PUT', body: '{"mode":"synchronous_mode_strict"}' })
    )
  })

  it('rejects an unreadable body with 400 instead of blaming the orchestrator', async () => {
    const { PUT } = await import('../sync-mode/route')
    const res = await callRoute(PUT as any, { method: 'PUT', body: 'not json at all' })

    expect(res.status).toBe(400)
    expect(fetchMock).not.toHaveBeenCalled()
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
    expect(auditMock).toHaveBeenCalledTimes(1)
    expect(auditMock.mock.calls[0][0]).toMatchObject({
      category: 'system', action: 'delete', resourceType: 'node', resourceId: 'proxcenter-2', status: 'success',
      details: expect.objectContaining({ params: { node: 'proxcenter-2' } }),
    })
  })
})
