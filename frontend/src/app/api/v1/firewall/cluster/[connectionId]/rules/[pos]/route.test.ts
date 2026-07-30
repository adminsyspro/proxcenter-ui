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
} from '@/__tests__/setup/firewall-route-mocks'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

// pveDirect is stubbed here (rather than pveFetch) so the assertions can pin
// down exactly which helper the fallback calls and with which arguments —
// notably the raw `pos` path param (#616).
const updateClusterRuleMock = vi.fn<(...args: any[]) => Promise<any>>()
const deleteClusterRuleMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/firewall/pveDirect', () => ({
  updateClusterRule: updateClusterRuleMock,
  deleteClusterRule: deleteClusterRuleMock,
}))

installFirewallRouteMocks()

beforeEach(() => {
  resetFirewallRouteMocks()
  updateClusterRuleMock.mockResolvedValue({ status: 'updated' })
  deleteClusterRuleMock.mockResolvedValue({ status: 'deleted' })
})

describe('PUT /api/v1/firewall/cluster/[connectionId]/rules/[pos]', () => {
  it('returns the orchestrator body unwrapped and never touches PVE', async () => {
    orchestrator.put.mockResolvedValue({ data: { status: 'updated' }, status: 200 })

    const { PUT } = handlersOf(await import('./route'))

    const res = await callRoute(PUT, {
      params: { connectionId: 'conn-1', pos: '7' },
      method: 'PUT',
      body: { action: 'DROP' },
    })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ status: 'updated' })
    expect(orchestrator.put).toHaveBeenCalledWith('/firewall/cluster/conn-1/rules/7', { action: 'DROP' })
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(updateClusterRuleMock).not.toHaveBeenCalled()
  })

  it('updates the rule at the requested position through the direct-PVE fallback', async () => {
    orchestrator.put.mockRejectedValue(unavailable())

    const { PUT } = handlersOf(await import('./route'))

    const res = await callRoute(PUT, {
      params: { connectionId: 'conn-1', pos: '7' },
      method: 'PUT',
      body: { action: 'DROP', moveto: 2 },
    })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ status: 'updated' })
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
    expect(updateClusterRuleMock).toHaveBeenCalledWith(CONN, '7', { action: 'DROP', moveto: 2 })
  })

  it('propagates a non-unavailable orchestrator error as a 500 without touching PVE', async () => {
    orchestrator.put.mockRejectedValue(new Error('Orchestrator 403: feature not licensed'))

    const { PUT } = handlersOf(await import('./route'))

    const res = await callRoute(PUT, {
      params: { connectionId: 'conn-1', pos: '7' },
      method: 'PUT',
      body: { action: 'DROP' },
    })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 403: feature not licensed' })
    expect(updateClusterRuleMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/firewall/cluster/[connectionId]/rules/[pos]', () => {
  it('answers the deleted literal when the orchestrator handles the delete', async () => {
    orchestrator.delete.mockResolvedValue({ data: null, status: 200 })

    const { DELETE } = handlersOf(await import('./route'))

    const res = await callRoute(DELETE, {
      params: { connectionId: 'conn-1', pos: '3' },
      method: 'DELETE',
    })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ status: 'deleted' })
    expect(orchestrator.delete).toHaveBeenCalledWith('/firewall/cluster/conn-1/rules/3')
    expect(deleteClusterRuleMock).not.toHaveBeenCalled()
  })

  it('deletes through the direct-PVE fallback and keeps the same deleted literal', async () => {
    orchestrator.delete.mockRejectedValue(unavailable())

    const { DELETE } = handlersOf(await import('./route'))

    const res = await callRoute(DELETE, {
      params: { connectionId: 'conn-1', pos: '3' },
      method: 'DELETE',
    })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ status: 'deleted' })
    expect(deleteClusterRuleMock).toHaveBeenCalledWith(CONN, '3')
  })

  it('propagates a non-unavailable orchestrator error as a 500 without touching PVE', async () => {
    orchestrator.delete.mockRejectedValue(new Error('Orchestrator 500: boom'))

    const { DELETE } = handlersOf(await import('./route'))

    const res = await callRoute(DELETE, {
      params: { connectionId: 'conn-1', pos: '3' },
      method: 'DELETE',
    })

    expect(res.status).toBe(500)
    expect(await readJson<any>(res)).toEqual({ error: 'Orchestrator 500: boom' })
    expect(deleteClusterRuleMock).not.toHaveBeenCalled()
  })

  it('returns the denied response when RBAC rejects the caller', async () => {
    checkPermissionMock.mockResolvedValue(denied(403, 'Forbidden'))

    const { DELETE } = handlersOf(await import('./route'))

    const res = await callRoute(DELETE, {
      params: { connectionId: 'conn-1', pos: '3' },
      method: 'DELETE',
    })

    expect(res.status).toBe(403)
    expect(orchestrator.delete).not.toHaveBeenCalled()
    expect(deleteClusterRuleMock).not.toHaveBeenCalled()
  })
})
