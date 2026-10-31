// Wiring tests for the IP-set delete route (#616). Community installs have no
// orchestrator, so DELETE must fall back to direct PVE — but only on
// ORCHESTRATOR_UNAVAILABLE, and the handler answers its own { success: true }
// whatever the backend returns, so what matters is which backend runs and with
// which arguments.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import {
  CONN,
  checkPermissionMock,
  denied,
  getConnectionByIdMock,
  handlersOf,
  installFirewallRouteMocks,
  orchestrator,
  resetFirewallRouteMocks,
  unavailable,
  verifyConnectionOwnershipMock,
} from '@/__tests__/setup/firewall-route-mocks'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const deleteIPSetMock = vi.fn<(conn: any, name: string) => Promise<any>>()
const updateIPSetCommentMock = vi.fn<(conn: any, name: string, comment: string) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({ deleteIPSet: deleteIPSetMock, updateIPSetComment: updateIPSetCommentMock }))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', ipsetName: 'blacklist' }

beforeEach(resetFirewallRouteMocks)

describe('DELETE /api/v1/firewall/ipsets/[connectionId]/[ipsetName]', () => {
  it('deletes through the orchestrator and never touches PVE', async () => {
    orchestrator.delete.mockResolvedValue({ data: { status: 'deleted' }, status: 200 })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true })
    expect(orchestrator.delete).toHaveBeenCalledWith('/firewall/ipsets/conn-1/blacklist')
    expect(deleteIPSetMock).not.toHaveBeenCalled()
    // The Enterprise path must not pay for the connection lookup
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('deletes via direct PVE when the orchestrator is unavailable (Community, #616)', async () => {
    orchestrator.delete.mockRejectedValue(unavailable())
    deleteIPSetMock.mockResolvedValue({ status: 'deleted' })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true })
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    // The raw path param reaches pveDirect, which escapes it itself
    expect(deleteIPSetMock).toHaveBeenCalledWith(CONN, 'blacklist')
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never touches PVE', async () => {
    orchestrator.delete.mockRejectedValue(new Error('Orchestrator 403: license required'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: license required' })
    expect(deleteIPSetMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to a generic message when the thrown value carries none', async () => {
    // A non-Error rejection (a string from a fetch shim, a bare object) has no
    // .message: the 500 must still say something the UI can render.
    orchestrator.delete.mockRejectedValue('socket hang up')

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to delete IP set' })
    expect(deleteIPSetMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial before calling anything', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(denied(404, 'Connection not found'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: { ...PARAMS, connectionId: 'conn-other' }, method: 'DELETE' })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.delete).not.toHaveBeenCalled()
    expect(deleteIPSetMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(403)
    expect(orchestrator.delete).not.toHaveBeenCalled()
    expect(deleteIPSetMock).not.toHaveBeenCalled()
  })
})

describe('PUT /api/v1/firewall/ipsets/[connectionId]/[ipsetName]', () => {

  it('updates the comment on PVE with the raw IP set name', async () => {
    updateIPSetCommentMock.mockResolvedValue({ status: 'updated' })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, method: 'PUT', body: { comment: 'Blocked hosts' } })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true })
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'connection', 'conn-1')
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(updateIPSetCommentMock).toHaveBeenCalledWith(CONN, 'blacklist', 'Blocked hosts')
  })

  it('clears the comment when the body carries none', async () => {
    updateIPSetCommentMock.mockResolvedValue({ status: 'updated' })

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, method: 'PUT', body: {} })

    expect(res.status).toBe(200)
    expect(updateIPSetCommentMock).toHaveBeenCalledWith(CONN, 'blacklist', '')
  })

  it('refuses a comment that is not a string', async () => {
    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, method: 'PUT', body: { comment: 42 } })

    expect(res.status).toBe(400)
    expect(updateIPSetCommentMock).not.toHaveBeenCalled()
  })

  it('answers 500 with the PVE error', async () => {
    updateIPSetCommentMock.mockRejectedValueOnce(new Error("no such IPSet 'blacklist'"))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, method: 'PUT', body: { comment: 'x' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: "no such IPSet 'blacklist'" })
  })

  it('falls back to a generic message when the thrown value carries none', async () => {
    updateIPSetCommentMock.mockRejectedValueOnce('socket hang up')

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, method: 'PUT', body: { comment: 'x' } })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to update IP set' })
  })

  it('returns the ownership denial before calling anything', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(denied(404, 'Connection not found'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: { ...PARAMS, connectionId: 'conn-other' }, method: 'PUT', body: { comment: 'x' } })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(updateIPSetCommentMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without touching PVE', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { PUT } = handlersOf(await import('./route'))
    const res = await callRoute(PUT, { params: PARAMS, method: 'PUT', body: { comment: 'x' } })

    expect(res.status).toBe(403)
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(updateIPSetCommentMock).not.toHaveBeenCalled()
  })
})
