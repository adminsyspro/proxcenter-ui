// Wiring tests for the security-group delete route (#616). Community installs
// have no orchestrator, so DELETE must fall back to direct PVE — but only on
// ORCHESTRATOR_UNAVAILABLE, and the handler answers its own { success: true }
// whatever the backend returns, so what matters is which backend runs and with
// which arguments.

import { describe, it, expect, vi, beforeEach } from 'vitest'

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

const deleteSecurityGroupMock = vi.fn<(conn: any, name: string) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({ deleteSecurityGroup: deleteSecurityGroupMock }))

installFirewallRouteMocks()

const PARAMS = { connectionId: 'conn-1', groupName: 'web' }

beforeEach(resetFirewallRouteMocks)

describe('DELETE /api/v1/firewall/groups/[connectionId]/[groupName]', () => {
  it('deletes through the orchestrator and never touches PVE', async () => {
    orchestrator.delete.mockResolvedValue({ data: { status: 'deleted' }, status: 200 })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true })
    expect(orchestrator.delete).toHaveBeenCalledWith('/firewall/groups/conn-1/web')
    expect(deleteSecurityGroupMock).not.toHaveBeenCalled()
    // The Enterprise path must not pay for the connection lookup
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('deletes via direct PVE when the orchestrator is unavailable (Community, #616)', async () => {
    orchestrator.delete.mockRejectedValue(unavailable())
    deleteSecurityGroupMock.mockResolvedValue({ status: 'deleted' })

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson<any>(res)).toEqual({ success: true })
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    // The raw path param reaches pveDirect, which escapes it itself
    expect(deleteSecurityGroupMock).toHaveBeenCalledWith(CONN, 'web')
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never touches PVE', async () => {
    orchestrator.delete.mockRejectedValue(new Error('Orchestrator 500: group still referenced'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 500: group still referenced' })
    expect(deleteSecurityGroupMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('falls back to a generic message when the thrown value carries none', async () => {
    // A non-Error rejection (a string from a fetch shim, a bare object) has no
    // .message: the 500 must still say something the UI can render.
    orchestrator.delete.mockRejectedValue('socket hang up')

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to delete security group' })
    expect(deleteSecurityGroupMock).not.toHaveBeenCalled()
  })

  it('returns the ownership denial before calling anything', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(denied(404, 'Connection not found'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: { ...PARAMS, connectionId: 'conn-other' }, method: 'DELETE' })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.delete).not.toHaveBeenCalled()
    expect(deleteSecurityGroupMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial without calling either backend', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { DELETE } = handlersOf(await import('./route'))
    const res = await callRoute(DELETE, { params: PARAMS, method: 'DELETE' })

    expect(res.status).toBe(403)
    expect(orchestrator.delete).not.toHaveBeenCalled()
    expect(deleteSecurityGroupMock).not.toHaveBeenCalled()
  })
})
