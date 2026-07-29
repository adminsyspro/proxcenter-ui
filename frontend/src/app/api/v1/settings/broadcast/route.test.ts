import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { guardMock, listMock, createMock, auditMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  listMock: vi.fn(),
  createMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/broadcast/guard', () => ({ requireBroadcastAdmin: () => guardMock() }))
vi.mock('@/lib/db/broadcasts', () => ({
  listBroadcasts: (...a: any[]) => listMock(...a),
  createBroadcast: (...a: any[]) => createMock(...a),
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

const body = {
  message: 'Maintenance 22:00 UTC',
  bgColor: '#f59e0b',
  fgColor: '#000000',
  targetKind: 'all',
}

beforeEach(() => {
  guardMock.mockReset().mockResolvedValue({ denied: null, userId: 'admin-1' })
  listMock.mockReset().mockResolvedValue([])
  createMock.mockReset().mockImplementation(async (input: any, createdBy: string) => ({ id: 'b1', ...input, createdBy }))
  auditMock.mockReset().mockResolvedValue('audit-1')
})

describe('GET /api/v1/settings/broadcast', () => {
  it('returns the full list for an authorised admin', async () => {
    listMock.mockResolvedValue([{ id: 'b1', message: 'x' }])
    const { GET } = await import('./route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: [{ id: 'b1', message: 'x' }] })
  })

  it('propagates the guard refusal and reads nothing', async () => {
    guardMock.mockResolvedValue({ denied: new Response(null, { status: 403 }) })
    const { GET } = await import('./route')
    expect((await callRoute(GET)).status).toBe(403)
    expect(listMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/v1/settings/broadcast', () => {
  it('creates the banner, stamps the author and audits', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body })
    expect(res.status).toBe(201)
    expect(createMock).toHaveBeenCalledWith(expect.objectContaining({ message: 'Maintenance 22:00 UTC' }), 'admin-1')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', category: 'settings' }))
  })

  it('refuses an unauthorised caller and writes nothing', async () => {
    guardMock.mockResolvedValue({ denied: new Response(null, { status: 403 }) })
    const { POST } = await import('./route')
    expect((await callRoute(POST, { body })).status).toBe(403)
    expect(createMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it.each([
    ['a blank message', { ...body, message: '  ' }],
    ['an invalid colour', { ...body, bgColor: 'orange' }],
    ['a javascript link', { ...body, linkUrl: 'javascript:alert(1)', linkLabel: 'x' }],
    ['a protocol-relative link', { ...body, linkUrl: '//evil.example', linkLabel: 'x' }],
    ['a tenant target with no ids', { ...body, targetKind: 'tenants' }],
    ['an end before the start', { ...body, startsAt: '2026-08-02T00:00:00.000Z', endsAt: '2026-08-01T00:00:00.000Z' }],
  ])('rejects %s with 400', async (_label, payload) => {
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: payload })
    expect(res.status).toBe(400)
    expect(createMock).not.toHaveBeenCalled()
  })
})
