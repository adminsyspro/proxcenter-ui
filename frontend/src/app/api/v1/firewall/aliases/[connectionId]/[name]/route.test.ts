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

// pveDirect is stubbed rather than pveFetch so the assertions can pin down the
// arguments the Community fallback forwards — notably the raw `name` path
// param, which pveDirect (not the route) is responsible for encoding (#616).
const updateAliasMock = vi.fn<(...args: any[]) => Promise<any>>()
const deleteAliasMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  updateAlias: updateAliasMock,
  deleteAlias: deleteAliasMock,
}))

installFirewallRouteMocks()

beforeEach(() => {
  resetFirewallRouteMocks()
  updateAliasMock.mockResolvedValue({ status: 'updated' })
  deleteAliasMock.mockResolvedValue({ status: 'deleted' })
})

describe('PUT /api/v1/firewall/aliases/[connectionId]/[name]', () => {
  const params = { connectionId: 'conn-1', name: 'web-servers' }
  const body = { cidr: '10.0.11.0/24', comment: 'front tier v2' }

  it('returns the orchestrator body unwrapped and never touches PVE', async () => {
    orchestrator.put.mockResolvedValue({ data: { status: 'updated' }, status: 200 })

    const { PUT } = handlersOf(await import('./route'))

    const res = await callRoute(PUT, { params, method: 'PUT', body })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ status: 'updated' })
    expect(orchestrator.put).toHaveBeenCalledWith('/firewall/aliases/conn-1/web-servers', body)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'connection', 'conn-1')
    expect(updateAliasMock).not.toHaveBeenCalled()

    // Lazy connection load: the Enterprise path never reads the credentials.
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('updates through direct PVE when the orchestrator is unavailable (Community, #616)', async () => {
    orchestrator.put.mockRejectedValue(unavailable())

    const { PUT } = handlersOf(await import('./route'))

    const res = await callRoute(PUT, { params, method: 'PUT', body })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ status: 'updated' })
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(updateAliasMock).toHaveBeenCalledWith(CONN, 'web-servers', body)
  })

  it('hands the alias name to pveDirect raw, leaving the encoding to it', async () => {
    orchestrator.put.mockRejectedValue(unavailable())

    const { PUT } = handlersOf(await import('./route'))

    // Next hands over already-decoded path params. pveDirect.updateAlias runs
    // encodeURIComponent on the name, so a route that pre-encoded would write
    // to an alias literally named "dmz%20net".
    const res = await callRoute(PUT, {
      params: { connectionId: 'conn-1', name: 'dmz net' },
      method: 'PUT',
      body,
    })

    expect(res.status).toBe(200)
    expect(updateAliasMock).toHaveBeenCalledWith(CONN, 'dmz net', body)
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never writes to PVE', async () => {
    orchestrator.put.mockRejectedValue(new Error('Orchestrator 400: invalid cidr'))

    const { PUT } = handlersOf(await import('./route'))

    const res = await callRoute(PUT, { params, method: 'PUT', body })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 400: invalid cidr' })
    expect(updateAliasMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('answers a generic message when the rejection carries no message', async () => {
    // A non-Error rejection has no .message, so the route must not answer
    // `{ error: undefined }`.
    orchestrator.put.mockRejectedValue({ status: 504 })

    const { PUT } = handlersOf(await import('./route'))

    const res = await callRoute(PUT, { params, method: 'PUT', body })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to update alias' })
  })

  it('returns the denied Response from RBAC without writing anywhere', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { PUT } = handlersOf(await import('./route'))

    const res = await callRoute(PUT, { params, method: 'PUT', body })

    expect(res.status).toBe(403)
    expect(orchestrator.put).not.toHaveBeenCalled()
    expect(updateAliasMock).not.toHaveBeenCalled()
  })

  it('returns the denied Response from the ownership check without writing anywhere', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(denied(404, 'Not found'))

    const { PUT } = handlersOf(await import('./route'))

    const res = await callRoute(PUT, {
      params: { connectionId: 'conn-other', name: 'web-servers' },
      method: 'PUT',
      body,
    })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.put).not.toHaveBeenCalled()
    expect(updateAliasMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/firewall/aliases/[connectionId]/[name]', () => {
  const params = { connectionId: 'conn-1', name: 'web-servers' }

  it('answers the success literal when the orchestrator handles the delete', async () => {
    orchestrator.delete.mockResolvedValue({ data: { status: 'deleted' }, status: 200 })

    const { DELETE } = handlersOf(await import('./route'))

    const res = await callRoute(DELETE, { params, method: 'DELETE' })

    expect(res.status).toBe(200)

    // The handler discards the backend body and answers its own literal.
    expect(await readJson(res)).toEqual({ success: true })
    expect(orchestrator.delete).toHaveBeenCalledWith('/firewall/aliases/conn-1/web-servers')
    expect(deleteAliasMock).not.toHaveBeenCalled()
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('deletes through direct PVE when the orchestrator is unavailable, same literal', async () => {
    orchestrator.delete.mockRejectedValue(unavailable())

    const { DELETE } = handlersOf(await import('./route'))

    const res = await callRoute(DELETE, { params, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ success: true })
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(deleteAliasMock).toHaveBeenCalledWith(CONN, 'web-servers')
  })

  it('propagates a non-unavailable orchestrator error as a 500 and never deletes on PVE', async () => {
    orchestrator.delete.mockRejectedValue(new Error('Orchestrator 500: alias in use'))

    const { DELETE } = handlersOf(await import('./route'))

    const res = await callRoute(DELETE, { params, method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 500: alias in use' })
    expect(deleteAliasMock).not.toHaveBeenCalled()
  })

  it('answers a generic message when the rejection carries no message', async () => {
    orchestrator.delete.mockRejectedValue('socket hang up')

    const { DELETE } = handlersOf(await import('./route'))

    const res = await callRoute(DELETE, { params, method: 'DELETE' })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Failed to delete alias' })
  })

  it('returns the denied Response from RBAC without deleting anywhere', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { DELETE } = handlersOf(await import('./route'))

    const res = await callRoute(DELETE, { params, method: 'DELETE' })

    expect(res.status).toBe(403)
    expect(orchestrator.delete).not.toHaveBeenCalled()
    expect(deleteAliasMock).not.toHaveBeenCalled()
  })

  it('returns the denied Response from the ownership check without deleting anywhere', async () => {
    verifyConnectionOwnershipMock.mockResolvedValue(denied(404, 'Not found'))

    const { DELETE } = handlersOf(await import('./route'))

    const res = await callRoute(DELETE, {
      params: { connectionId: 'conn-other', name: 'web-servers' },
      method: 'DELETE',
    })

    expect(res.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(orchestrator.delete).not.toHaveBeenCalled()
    expect(deleteAliasMock).not.toHaveBeenCalled()
  })
})
