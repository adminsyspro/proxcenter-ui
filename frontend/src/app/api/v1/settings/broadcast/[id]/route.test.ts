import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const { guardMock, updateMock, deleteMock, auditMock } = vi.hoisted(() => ({
  guardMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/broadcast/guard', () => ({ requireBroadcastAdmin: () => guardMock() }))
vi.mock('@/lib/db/broadcasts', () => ({
  updateBroadcast: (...a: any[]) => updateMock(...a),
  deleteBroadcast: (...a: any[]) => deleteMock(...a),
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

const body = { message: 'Changed', bgColor: '#f59e0b', fgColor: '#000000', targetKind: 'all' }

/**
 * callRoute types its handler's ctx as `{ params: Promise<Record<string, string>> }`
 * while an [id] route declares `{ params: Promise<{ id: string }> }`; the narrower
 * handler is not assignable, which is exactly the pre-existing typecheck error nine
 * other [id] route tests carry. This local adapter keeps this file out of that family
 * without touching the shared harness.
 */
const withParams =
  (handler: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>) =>
  (req: Request, ctx: { params: Promise<Record<string, string>> }): Promise<Response> =>
    handler(req, { params: ctx.params as Promise<{ id: string }> })

beforeEach(() => {
  guardMock.mockReset().mockResolvedValue({ denied: null, userId: 'admin-1' })
  updateMock.mockReset().mockResolvedValue({ id: 'b1', ...body, targetIds: [], enabled: true })
  deleteMock.mockReset().mockResolvedValue(true)
  auditMock.mockReset().mockResolvedValue('audit-1')
})

describe('PUT /api/v1/settings/broadcast/[id]', () => {
  it('updates and audits', async () => {
    const { PUT } = await import('./route')
    const res = await callRoute(withParams(PUT), { method: 'PUT', params: { id: 'b1' }, body })
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith('b1', expect.objectContaining({ message: 'Changed' }))
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', category: 'settings' }))
  })

  it('answers 404 for an unknown id instead of 500', async () => {
    updateMock.mockResolvedValue(null)
    const { PUT } = await import('./route')
    expect((await callRoute(withParams(PUT), { method: 'PUT', params: { id: 'nope' }, body })).status).toBe(404)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('refuses an unauthorised caller and writes nothing', async () => {
    guardMock.mockResolvedValue({ denied: new Response(null, { status: 403 }) })
    const { PUT } = await import('./route')
    expect((await callRoute(withParams(PUT), { method: 'PUT', params: { id: 'b1' }, body })).status).toBe(403)
    expect(updateMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('rejects invalid input with 400', async () => {
    const { PUT } = await import('./route')
    const res = await callRoute(withParams(PUT), { method: 'PUT', params: { id: 'b1' }, body: { ...body, fgColor: 'black' } })
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('rejects malformed JSON with 400 and writes nothing', async () => {
    const { PUT } = await import('./route')
    const res = await callRoute(withParams(PUT), { method: 'PUT', params: { id: 'b1' }, body: '{' })
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/settings/broadcast/[id]', () => {
  it('deletes and audits', async () => {
    const { DELETE } = await import('./route')
    const res = await callRoute(withParams(DELETE), { method: 'DELETE', params: { id: 'b1' } })
    expect(res.status).toBe(200)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', category: 'settings' }))
  })

  it('answers 404 for an unknown id', async () => {
    deleteMock.mockResolvedValue(false)
    const { DELETE } = await import('./route')
    expect((await callRoute(withParams(DELETE), { method: 'DELETE', params: { id: 'nope' } })).status).toBe(404)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('refuses an unauthorised caller and deletes nothing', async () => {
    guardMock.mockResolvedValue({ denied: new Response(null, { status: 403 }) })
    const { DELETE } = await import('./route')
    expect((await callRoute(withParams(DELETE), { method: 'DELETE', params: { id: 'b1' } })).status).toBe(403)
    expect(deleteMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})
